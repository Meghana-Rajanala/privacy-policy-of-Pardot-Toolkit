importScripts('common.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = u => String(u || '').split(/[?#]/)[0];

function tabComplete(tabId, timeout = 30000) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); };
    const t = setTimeout(done, timeout);
    const l = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId).then(tb => { if (tb.status === 'complete') done(); }).catch(done);
  });
}

// Reuse an already-open tab for this handler, otherwise open one in the background.
async function ensureTab(id, s) {
  const url = PT.buildUrl(s, id);
  const tabs = await chrome.tabs.query({});
  const found = tabs.find(t => clean(t.url) === clean(url));
  if (found) return { tabId: found.id, created: false };
  const tab = await chrome.tabs.create({ url, active: false });
  await tabComplete(tab.id);
  return { tabId: tab.id, created: true };
}

async function pingEdit(tabId, timeout = 15000) {
  const start = Date.now(); let injected = false;
  while (Date.now() - start < timeout) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'PT_PING' });
      if (r && r.ok) return true;
    } catch (e) {
      if (!injected) {
        injected = true;
        try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['common.js', 'content.js'] }); } catch (_) {}
      }
    }
    await sleep(500);
  }
  return false;
}

// One operation. If the page reloads after saving, the reply is lost, so verify by re-reading the list.
async function runOp(tabId, op, s) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PT_OP', op, opts: { delay: s.delay, defaultRequired: s.defaultRequired } });
    if (r) return r;
    throw new Error('no response');
  } catch (e) {
    await sleep(800);
    await tabComplete(tabId, 20000);
    if (!(await pingEdit(tabId, 15000))) return { ok: false, message: 'Lost contact with the page after saving' };
    let names = [];
    try { const f = await chrome.tabs.sendMessage(tabId, { type: 'PT_READ' }); names = ((f && f.fields) || []).map(x => x.name.toLowerCase()); } catch (_) {}
    const n = (op.external_field || '').toLowerCase(), nn = (op.new_external_field || '').toLowerCase();
    if (op.action === 'add' && names.includes(n)) return { ok: true, message: 'Field added (page reloaded)' };
    if (op.action === 'remove' && names.length && !names.includes(n)) return { ok: true, message: 'Field removed (page reloaded)' };
    if (op.action === 'edit' && names.includes(nn || n)) return { ok: true, message: 'Field updated (page reloaded)' };
    return { ok: false, message: 'Could not confirm the result after the page reloaded' };
  }
}

async function readFields(tabId) {
  const f = await chrome.tabs.sendMessage(tabId, { type: 'PT_READ' });
  return (f && f.fields) || [];
}

// ---------- batch ----------
let run = null, keepAlive = null;
const saveRun = () => chrome.storage.local.set({ ptRun: run });

async function processHandler(id, rows, s) {
  const out = [];
  const fail = (r, message) => out.push({ ...r, status: 'Error', message });
  let tab;
  try {
    tab = await ensureTab(id, s);
    if (!(await pingEdit(tab.tabId))) {
      rows.forEach(r => fail(r, 'Form handler page not recognised (check the ID and that you are logged in)'));
      if (tab.created && s.closeTabs) chrome.tabs.remove(tab.tabId).catch(() => {});
      return out;
    }
    for (const r of rows) {
      if (run.cancel) { fail(r, 'Cancelled'); continue; }
      const op = { action: r.action, external_field: r.external_field, new_external_field: r.new_external_field,
        prospect_field: r.prospect_field, data_format: r.data_format, required: r.required };
      const res = await runOp(tab.tabId, op, s);
      const a = res.applied || {};
      out.push({
        ...r,
        prospect_field: a.prospect_field || r.prospect_field,
        data_format: a.data_format || r.data_format,
        required: a.required || (r.action === 'remove' ? '' : r.required),
        status: res.ok ? 'Saved' : 'Error',
        message: res.message || ''
      });
    }
  } catch (e) {
    rows.filter(r => !out.some(o => o.line === r.line)).forEach(r => fail(r, e.message));
  }
  if (tab && tab.created && s.closeTabs) chrome.tabs.remove(tab.tabId).catch(() => {});
  return out;
}

async function startBatch(rows) {
  if (run && run.running) throw new Error('A batch is already running');
  const s = await PT.getSettings();
  const groups = new Map();
  rows.forEach(r => { if (!groups.has(r.form_handler_id)) groups.set(r.form_handler_id, []); groups.get(r.form_handler_id).push(r); });
  const list = [...groups.entries()];
  run = {
    running: true, paused: false, cancel: false, total: list.length, done: 0, startedAt: Date.now(),
    handlers: list.map(([id, rs]) => ({ id, count: rs.length, status: 'Queued', message: '' })), results: []
  };
  await saveRun();
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let next = 0;
  const worker = async () => {
    for (;;) {
      while (run.paused && !run.cancel) await sleep(300);
      if (run.cancel) return;
      const i = next++;
      if (i >= list.length) return;
      const [id, rs] = list[i];
      run.handlers[i].status = 'Running'; await saveRun();
      const res = await processHandler(id, rs, s);
      const errs = res.filter(r => r.status === 'Error');
      run.handlers[i].status = errs.length ? (errs.length === res.length ? 'Error' : 'Partial') : 'Saved';
      run.handlers[i].message = errs.length ? errs[0].message : '';
      run.results.push(...res); run.done++;
      await saveRun();
    }
  };
  (async () => {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(+s.parallel || 3, 10)) }, worker));
    run.handlers.forEach(h => { if (h.status === 'Queued') h.status = 'Cancelled'; });
    run.running = false; run.paused = false;
    clearInterval(keepAlive);
    await saveRun();
    if (s.notifyOnEnd) {
      const bad = run.results.filter(r => r.status === 'Error').length;
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon128.png', title: 'Pardot Toolkit: batch finished',
        message: `${run.results.length - bad} saved, ${bad} with errors across ${run.total} form handlers.`
      });
    }
  })();
}

// ---------- messages from the popup ----------
chrome.runtime.onMessage.addListener((m, _s, send) => {
  (async () => {
    try {
      const s = await PT.getSettings();
      switch (m.type) {
        case 'PT_FIELDS_LOAD': {
          const tab = await ensureTab(m.id, s);
          if (!(await pingEdit(tab.tabId))) return send({ ok: false, message: 'Could not read the form handler page. Check the ID and that you are logged in to Pardot.' });
          return send({ ok: true, fields: await readFields(tab.tabId) });
        }
        case 'PT_FIELDS_APPLY': {
          const tab = await ensureTab(m.id, s);
          if (!(await pingEdit(tab.tabId))) return send({ ok: false, message: 'Could not read the form handler page.' });
          const results = [];
          for (const op of m.ops) { const r = await runOp(tab.tabId, op, s); results.push({ op, ...r }); }
          let fields = []; try { fields = await readFields(tab.tabId); } catch (_) {}
          return send({ ok: true, results, fields });
        }
        case 'PT_BATCH_START': await startBatch(m.rows); return send({ ok: true });
        case 'PT_BATCH_PAUSE': if (run) { run.paused = !run.paused; await saveRun(); } return send({ ok: true, paused: run && run.paused });
        case 'PT_BATCH_CANCEL': if (run) { run.cancel = true; await saveRun(); } return send({ ok: true });
        default: return send({ ok: false, message: 'Unknown request' });
      }
    } catch (e) { send({ ok: false, message: e.message }); }
  })();
  return true;
});
