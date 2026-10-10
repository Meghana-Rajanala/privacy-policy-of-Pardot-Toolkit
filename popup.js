const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const send = m => chrome.runtime.sendMessage(m);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
    else e.setAttribute(k, props[k]);
  }
  kids.flat().forEach(c => e.append(c)); return e;
}
const download = (name, text) => {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.append(a); a.click(); a.remove();
};

let S, fields = [], queue = [], mode = 'new', editing = null, req = 'no', sub = 'edit', picked = new Set(), batchRows = [];

/* ---------- tabs ---------- */
$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('on', x === b));
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.tab));
});
function seg(el, onPick) {
  el.querySelectorAll('button').forEach(b => b.onclick = () => { setSeg(el, b.dataset.v); onPick(b.dataset.v); });
}
const setSeg = (el, v) => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));

/* ---------- 1 · FIELDS ---------- */
const hid = () => $('#hid').value.trim().replace(/\D/g, '');
const log = (lines) => { const l = $('#log'); l.className = 'log'; l.replaceChildren(...lines.map(([cls, t]) => h('div', { class: cls }, t))); };

function setSub(v) {
  sub = v;
  $('#sub-edit').classList.toggle('on', v === 'edit');
  $('#sub-rm').classList.toggle('on', v === 'rm'); $('#sub-rm').classList.add('rm');
  $('#v-edit').hidden = v !== 'edit'; $('#v-rm').hidden = v !== 'rm';
  renderFooter();
}
function renderFooter() {
  const p = $('#primary');
  if (sub === 'rm') { p.textContent = `Remove ${picked.size} field${picked.size === 1 ? '' : 's'}`; p.classList.add('red'); p.disabled = !picked.size; }
  else { p.textContent = 'Save changes'; p.classList.remove('red'); p.disabled = false; }
}
function setMode(m, name) {
  mode = m; editing = m === 'edit' ? name : null;
  setSeg($('#modeSeg'), m);
  $('#reqLeave').hidden = m === 'new';
  if (m === 'new') {
    $('#editHint').textContent = 'Adding a new field to this form handler.';
    $('#fname').value = ''; $('#pfield').value = ''; $('#fmt').value = '';
    setReq(S.defaultRequired === 'yes' ? 'yes' : 'no');
  } else {
    const f = fields.find(x => x.name === name) || {};
    $('#editHint').innerHTML = ''; $('#editHint').append('Editing: ', h('b', {}, name || '(pick a field above)'), '. Only changed values are saved.');
    $('#fname').value = name || ''; $('#pfield').value = f.target || ''; $('#fmt').value = '';
    setReq('leave');
  }
}
const setReq = v => { req = v; setSeg($('#reqSeg'), v); };

function renderFields() {
  $('#flist').replaceChildren(...(fields.length ? fields.map(f =>
    h('div', { class: 'card' }, h('div', { class: 'grow' }, h('b', {}, f.name), h('div', { class: 'mut' }, `${f.target || '?'} · ${f.required ? 'Required' : 'Optional'}`)),
      h('button', { class: 'pill', onclick: () => setMode('edit', f.name) }, 'Edit'))) : [h('div', { class: 'mut' }, 'No fields loaded yet.')]));
  $('#rmHint').textContent = fields.length ? `Fields loaded from handler ${hid()}. Tick the ones to remove.` : 'Load a form handler to see its fields.';
  const all = h('label', { class: 'card' }, h('input', { type: 'checkbox', class: 'check', onchange: e => { picked = new Set(e.target.checked ? fields.map(f => f.name) : []); renderFields(); } }),
    h('b', {}, `Select all (${fields.length})`), h('span', { class: 'mut', style: 'margin-left:auto' }, `${picked.size} selected`));
  all.querySelector('input').checked = fields.length > 0 && picked.size === fields.length;
  $('#rmlist').replaceChildren(...(fields.length ? [all] : []), ...fields.map(f => {
    const c = h('input', { type: 'checkbox', class: 'check', onchange: e => { e.target.checked ? picked.add(f.name) : picked.delete(f.name); renderFields(); } });
    c.checked = picked.has(f.name);
    return h('label', { class: 'card' }, c, h('div', {}, h('b', {}, f.name), h('div', { class: 'mut' }, `${f.target || '?'} · ${f.required ? 'Required' : 'Optional'}`)));
  }));
  renderFooter();
}

function buildOp() {
  const name = $('#fname').value.trim(); if (!name) return null;
  const pf = $('#pfield').value.trim(), fmt = $('#fmt').value.trim(), rq = req === 'yes' ? 'yes' : req === 'no' ? 'no' : '';
  if (mode === 'new') return { action: 'add', external_field: name, prospect_field: pf, data_format: fmt, required: rq };
  const cur = fields.find(f => f.name === editing) || {};
  return { action: 'edit', external_field: editing, new_external_field: name !== editing ? name : '', prospect_field: pf !== cur.target ? pf : '', data_format: fmt, required: rq };
}
function renderQueue() { $('#qinfo').textContent = queue.length ? `${queue.length} queued` : ''; }

async function loadFields() {
  if (!hid()) return log([['er', 'Enter a form handler ID first.']]);
  $('#load').disabled = true; log([['', 'Opening the form handler in a background tab…']]);
  const r = await send({ type: 'PT_FIELDS_LOAD', id: hid() });
  $('#load').disabled = false;
  if (!r.ok) return log([['er', r.message]]);
  fields = r.fields; picked.clear(); queue = []; renderQueue(); renderFields(); setMode('new');
  log([['ok', `Loaded ${fields.length} field${fields.length === 1 ? '' : 's'}.`]]);
}
async function apply(ops) {
  if (!hid()) return log([['er', 'Enter a form handler ID first.']]);
  if (!ops.length) return log([['er', 'Nothing to save yet.']]);
  $('#primary').disabled = true; log([['', `Applying ${ops.length} change${ops.length === 1 ? '' : 's'}…`]]);
  const r = await send({ type: 'PT_FIELDS_APPLY', id: hid(), ops });
  $('#primary').disabled = false;
  if (!r.ok) return log([['er', r.message]]);
  fields = r.fields.length ? r.fields : fields; picked.clear(); queue = []; renderQueue(); renderFields(); setMode('new');
  log(r.results.map(x => [x.ok ? 'ok' : 'er', `${x.ok ? '✓' : '✗'} ${x.op.action} ${x.op.external_field}: ${x.message || ''}`]));
}

$('#load').onclick = loadFields;
$('#sub-edit').onclick = () => setSub('edit');
$('#sub-rm').onclick = () => setSub('rm');
seg($('#modeSeg'), v => setMode(v, v === 'edit' ? (editing || (fields[0] && fields[0].name)) : null));
seg($('#reqSeg'), v => { req = v; });
$('#queue').onclick = () => { const op = buildOp(); if (!op) return log([['er', 'Enter an external field name.']]); queue.push(op); renderQueue(); setMode('new'); };
$('#discard').onclick = () => { queue = []; picked.clear(); renderQueue(); renderFields(); setMode('new'); log([]); };
$('#primary').onclick = () => {
  if (sub === 'rm') return apply([...picked].map(n => ({ action: 'remove', external_field: n })));
  const ops = [...queue]; const cur = buildOp(); if (cur) ops.push(cur); apply(ops);
};

/* ---------- 2 · BATCH ---------- */
const TEMPLATE = 'form_handler_id,action,external_field,prospect_field,data_format,required,new_external_field\r\n' +
  '48213,add,job_title,Job Title,Text,no,\r\n48213,edit,email,,,yes,\r\n48213,remove,lead_source,,,,\r\n';
const RESULT_COLS = ['form_handler_id', 'action', 'external_field', 'new_external_field', 'prospect_field', 'data_format', 'required', 'status', 'message'];

function parseBatch() {
  const { rows, errors } = PT.normalizeRows($('#csvtext').value);
  batchRows = rows;
  const ids = new Set(rows.map(r => r.form_handler_id)), box = $('#bsum');
  box.hidden = !rows.length && !errors.length;
  box.style.flexDirection = 'column'; box.style.alignItems = 'flex-start';
  box.replaceChildren(h('b', {}, `${rows.length} rows · ${ids.size} form handlers`),
    h('div', { class: 'mut' }, 'Grouped by ID: one visit per handler, all its fields saved in one go.'),
    ...errors.slice(0, 5).map(e => h('div', { class: 'mut', style: 'color:#8A2410' }, e)),
    errors.length > 5 ? h('div', { class: 'mut' }, `…and ${errors.length - 5} more problems`) : '');
  $('#bstart').disabled = !rows.length;
}
$('#csvtext').oninput = parseBatch;
$('#csvfile').onchange = async e => { const f = e.target.files[0]; if (f) { $('#csvtext').value = await f.text(); parseBatch(); } };
$('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
$('#drop').ondragleave = () => $('#drop').classList.remove('over');
$('#drop').ondrop = async e => { e.preventDefault(); $('#drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) { $('#csvtext').value = await f.text(); parseBatch(); } };
$('#tpl').onclick = () => download('pardot-batch-template.csv', TEMPLATE);
$('#bstart').onclick = async () => {
  const r = await send({ type: 'PT_BATCH_START', rows: batchRows });
  if (!r.ok) $('#bsum').append(h('div', { class: 'mut', style: 'color:#8A2410' }, r.message));
};
$('#bpause').onclick = () => send({ type: 'PT_BATCH_PAUSE' });

function renderRun(run) {
  if (!run) { $('#bstart').disabled = !batchRows.length; $('#bpause').disabled = true; $('#bdl').disabled = true; return; }
  $('#bprog').hidden = false;
  $('#bplabel').textContent = `${run.done} of ${run.total} form handlers done${run.running ? (run.paused ? ' · paused' : '') : ' · finished'}`;
  $('#bfill').style.width = (run.total ? Math.round(run.done / run.total * 100) : 0) + '%';
  $('#blist').replaceChildren(...run.handlers.map(x => h('div', { class: 'card' }, h('b', {}, x.id),
    h('span', { class: 'mut' }, x.message || `${x.count} row${x.count === 1 ? '' : 's'}`),
    h('span', { class: 'pill ' + (x.status === 'Saved' ? 'ok' : /Error|Partial/.test(x.status) ? 'er' : '') }, x.status))));
  $('#bpause').textContent = run.paused ? 'Resume' : 'Pause';
  $('#bpause').disabled = !run.running; $('#bstart').disabled = run.running || !batchRows.length; $('#bdl').disabled = !run.results.length;
}
$('#bdl').onclick = async () => {
  const { ptRun } = await chrome.storage.local.get('ptRun');
  if (ptRun) download('pardot-batch-result.csv', PT.toCsv(ptRun.results, RESULT_COLS));
};
chrome.storage.onChanged.addListener(c => { if (c.ptRun) renderRun(c.ptRun.newValue); });

/* ---------- 3 · SEARCH ---------- */
let stype = 'all';
const KINDS = [
  ['prospects', /\/prospect\/(?:read|view|edit)\/id\/(\d+)/i, 'Prospect'],
  ['visitors', /\/visitor\/(?:read|view|edit)\/id\/(\d+)/i, 'Visitor'],
  ['campaigns', /\/campaign\/(?:read|view|edit)\/id\/(\d+)/i, 'Campaign'],
  ['formHandlers', /\/formHandler\/(?:read|view|edit)\/id\/(\d+)/i, 'Form handler'],
  ['forms', /\/form\/(?:read|view|edit)\/id\/(\d+)/i, 'Form']
];
$$('#chips .chip').forEach(c => c.onclick = () => { stype = c.dataset.v; $$('#chips .chip').forEach(x => x.classList.toggle('on', x === c)); });

async function searchType(key, q) {
  const url = S.baseUrl.replace(/\/+$/, '') + S.search[key].replace('{Q}', encodeURIComponent(q));
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok || /login/i.test(res.url)) throw new Error(res.ok ? 'not logged in' : 'HTTP ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const kind = KINDS.find(k => k[0] === key), out = [], seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(kind[1]);
    if (!m || seen.has(m[1])) continue;
    const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    seen.add(m[1]); out.push({ kind: kind[2], label, id: m[1], href: new URL(a.getAttribute('href'), url).href });
    if (out.length >= 25) break;
  }
  return out;
}
async function doSearch() {
  const q = $('#q').value.trim(); if (!q) return;
  const keys = stype === 'all' ? KINDS.map(k => k[0]) : [stype];
  $('#sres').replaceChildren(h('div', { class: 'mut' }, 'Searching…'));
  const settled = await Promise.allSettled(keys.map(k => searchType(k, q)));
  const items = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
  const fails = settled.map((s, i) => s.status === 'rejected' ? `${keys[i]}: ${s.reason.message}` : null).filter(Boolean);
  $('#sres').replaceChildren(
    ...(items.length ? items.map(i => h('a', { class: 'res', onclick: () => chrome.tabs.create({ url: i.href }) },
      h('div', { class: 'card' }, h('div', { class: 'grow' }, h('b', {}, i.label), h('div', { class: 'mut' }, `${i.kind} · ID ${i.id}`))))) : [h('div', { class: 'mut' }, 'No results found.')]),
    ...(fails.length ? [h('div', { class: 'mut', style: 'color:#8A2410' }, 'Could not search: ' + fails.join('; ') + '. Check the search URLs in Settings.')] : []));
}
$('#go').onclick = doSearch;
$('#q').onkeydown = e => { if (e.key === 'Enter') doSearch(); };

/* ---------- 4 · SETTINGS ---------- */
const SEARCH_LABELS = { prospects: 'Prospects', visitors: 'Visitors', campaigns: 'Campaigns', formHandlers: 'Form handlers', forms: 'Forms' };
let sreq = 'no';
function fillSettings() {
  $('#s-base').value = S.baseUrl; $('#s-tpl').value = S.template; $('#s-par').value = S.parallel; $('#s-del').value = S.delay;
  sreq = S.defaultRequired; setSeg($('#s-req'), sreq);
  $('#s-notify').checked = S.notifyOnEnd; $('#s-close').checked = S.closeTabs;
  $('#s-search').replaceChildren(...Object.keys(SEARCH_LABELS).map(k =>
    h('div', {}, h('label', { class: 'lb', for: 's-q-' + k }, SEARCH_LABELS[k]), h('input', { class: 'in', id: 's-q-' + k, value: S.search[k] }))));
}
seg($('#s-req'), v => { sreq = v; });
$('#s-save').onclick = async () => {
  const search = {}; Object.keys(SEARCH_LABELS).forEach(k => search[k] = $('#s-q-' + k).value.trim());
  await PT.saveSettings({
    baseUrl: $('#s-base').value.trim(), template: $('#s-tpl').value.trim(), parallel: +$('#s-par').value || 3, delay: +$('#s-del').value || 400,
    defaultRequired: sreq, notifyOnEnd: $('#s-notify').checked, closeTabs: $('#s-close').checked, search
  });
  S = await PT.getSettings(); $('#s-save').textContent = 'Saved'; setTimeout(() => $('#s-save').textContent = 'Save settings', 1200);
  if (mode === 'new') setMode('new');
};
$('#s-reset').onclick = async () => { await chrome.storage.local.remove('settings'); S = await PT.getSettings(); fillSettings(); };

/* ---------- init ---------- */
(async () => {
  S = await PT.getSettings(); fillSettings();
  renderFields(); setMode('new'); setSub('edit'); parseBatch();
  const { ptRun } = await chrome.storage.local.get('ptRun'); renderRun(ptRun);
})();
