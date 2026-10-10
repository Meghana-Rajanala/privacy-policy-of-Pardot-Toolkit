// Runs inside Pardot pages. Reads form handler fields and performs ONE operation per message.
(() => {
  if (window.__ptLoaded) return;
  window.__ptLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const fire = el => ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  async function waitFor(fn, timeout = 8000, step = 100) {
    const t = Date.now();
    while (Date.now() - t < timeout) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }

  // ---------- reading the field list ----------
  const sig = el => {
    const c = el.className;
    return [typeof c === 'string' ? c : (c && c.baseVal) || '', el.getAttribute('title'), el.getAttribute('aria-label'),
      el.getAttribute('data-original-title'), el.getAttribute('href'), el.getAttribute('onclick'),
      el.getAttribute('data-icon'), el.getAttribute('data-action')].filter(Boolean).join(' ').toLowerCase();
  };

  // Icons can be <a>, <button>, <i>, <svg> or <span>, so classify by their own attributes.
  function iconsOf(row) {
    const found = [], seen = new Set();
    for (const el of row.querySelectorAll('a,button,i,svg,span,img,[role=button]')) {
      const s = sig(el);
      const kind = /trash|delete|remove|destroy|fa-times|fa-close/.test(s) ? 'delete'
        : /edit|pencil|fa-pen|modify/.test(s) ? 'edit' : null;
      if (!kind) continue;
      const target = el.closest('a,button,[role=button]') || el;
      if (seen.has(target)) continue;
      seen.add(target); found.push({ kind, target });
    }
    if (!found.length) {
      const c = [...row.querySelectorAll('a,button')];
      if (c.length >= 2) return [{ kind: 'edit', target: c[0] }, { kind: 'delete', target: c[1] }];
    }
    return found;
  }

  // Rows look like:  "email" maps to Default Field: Email (r)
  function readRows() {
    const re = /"([^"]+)"\s*maps to\s*(.+)/i;
    const all = [...document.body.querySelectorAll('li,tr,div,p,span,td')].filter(el => re.test(txt(el)));
    const leaves = all.filter(el => !all.some(o => o !== el && el.contains(o)));
    const rows = [];
    for (const leaf of leaves) {
      const m = txt(leaf).match(re);
      if (!m) continue;
      let row = leaf;
      while (row && row !== document.body && !iconsOf(row).length) row = row.parentElement;
      const icons = row && row !== document.body && !leaves.some(o => o !== leaf && row.contains(o)) ? iconsOf(row) : [];
      rows.push({
        name: m[1],
        target: m[2].replace(/\(r\)/i, '').replace(/^.*?:\s*/, '').trim(),
        required: /\(r\)/i.test(m[2]),
        edit: (icons.find(i => i.kind === 'edit') || {}).target,
        del: (icons.find(i => i.kind === 'delete') || {}).target
      });
    }
    return rows;
  }
  const findRow = name => readRows().find(r => r.name.toLowerCase() === String(name).toLowerCase());

  function addBtn() {
    const c = [...document.querySelectorAll('a,button,span,div,input')]
      .filter(e => vis(e) && /^\+?\s*add new field$/i.test((e.value || txt(e)).trim()));
    return c.find(e => !c.some(o => o !== e && e.contains(o)));
  }
  const isHandlerPage = () => /formhandler/i.test(location.pathname) || !!addBtn() || readRows().length > 0;

  // ---------- dialog helpers ----------
  const findSave = () => [...document.querySelectorAll('button,input[type=submit],input[type=button],a')]
    .find(b => vis(b) && /^save changes$/i.test((b.value || txt(b)).trim()));

  function dialogRoot(btn) {
    let root = btn;
    while (root.parentElement && !root.querySelector('select,input[type=text],input:not([type])')) root = root.parentElement;
    return root;
  }

  function ctl(root, labelRe, sel) {
    for (const l of root.querySelectorAll('label')) {
      if (!labelRe.test(txt(l))) continue;
      const id = l.getAttribute('for');
      let c = id && root.querySelector('#' + CSS.escape(id));
      if (!c) c = l.querySelector(sel) || (l.parentElement && l.parentElement.querySelector(sel));
      if (c && c.matches(sel)) return c;
    }
    return null;
  }

  function setText(el, v) {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    fire(el);
  }

  function setSelect(sel, val) {
    const t = norm(val), opts = [...sel.options];
    const o = opts.find(o => o.value === val || o.text.trim() === val) ||
      opts.find(o => norm(o.value) === t || norm(o.text) === t) ||
      (t.length > 2 && opts.find(o => norm(o.text).includes(t)));
    if (!o) return false;
    sel.value = o.value; fire(sel); return true;
  }
  const selText = s => (s.options[s.selectedIndex] ? s.options[s.selectedIndex].text.trim() : '');

  // Sets the checkbox to an exact state. Never toggles blindly.
  function setChecked(cb, want) {
    if (cb.checked !== want) cb.click();
    if (cb.checked !== want) { cb.checked = want; fire(cb); }
    return cb.checked === want;
  }

  // Blank "required" never ticks the box. Edits leave it untouched unless a value is given.
  function resolveRequired(value, defaultRequired, isEdit) {
    const r = PT.parseRequired(value);
    if (r !== null) return r;
    if (isEdit) return null;
    if (defaultRequired === 'yes') return true;
    if (defaultRequired === 'no') return false;
    return null;
  }

  const errorText = root => [...root.querySelectorAll('.error,.errors,.alert,.alert-danger,.has-error,[class*=error]')]
    .filter(vis).map(txt).filter(Boolean)[0];

  function cancel(root) {
    const b = [...root.querySelectorAll('button,a,input[type=button]')]
      .find(x => /^cancel$/i.test((x.value || txt(x)).trim()));
    if (b) b.click();
  }

  async function fillAndSave(op, o, isEdit) {
    const btn = await waitFor(findSave, 7000);
    if (!btn) throw new Error('Field dialog did not open');
    const root = dialogRoot(btn);
    const nameEl = ctl(root, /external field name/i, 'input') || root.querySelector('input[type=text],input:not([type]):not([type=hidden])');
    const sels = [...root.querySelectorAll('select')];
    const pSel = ctl(root, /prospect field/i, 'select') || sels[0];
    const fSel = ctl(root, /data format/i, 'select') || sels[1];
    const cb = ctl(root, /required/i, 'input[type=checkbox]') || root.querySelector('input[type=checkbox]');

    const newName = isEdit ? (op.new_external_field || '') : op.external_field;
    if (newName && nameEl) setText(nameEl, newName);

    if (op.prospect_field) {
      if (!pSel || !setSelect(pSel, op.prospect_field)) { cancel(root); throw new Error(`Prospect field "${op.prospect_field}" not found in the list`); }
    } else if (!isEdit) { cancel(root); throw new Error('Prospect field is needed to add a field'); }

    if (op.data_format && (!fSel || !setSelect(fSel, op.data_format))) {
      cancel(root); throw new Error(`Data format "${op.data_format}" not found in the list`);
    }

    const want = resolveRequired(op.required, o.defaultRequired, isEdit);
    if (want !== null && cb) setChecked(cb, want);

    const applied = {
      external_field: nameEl ? nameEl.value : newName,
      prospect_field: pSel ? selText(pSel) : '',
      data_format: fSel ? selText(fSel) : '',
      required: cb ? (cb.checked ? 'yes' : 'no') : ''
    };

    btn.click();
    await sleep(350);
    const result = await waitFor(() => {
      if (!document.contains(btn) || !vis(btn) || !vis(root)) return 'closed';
      const e = errorText(root); return e ? 'err:' + e : null;
    }, 9000);
    if (result !== 'closed') {
      const msg = result && result.startsWith('err:') ? result.slice(4) : 'Save did not complete';
      cancel(root); throw new Error(msg);
    }
    await sleep(o.delay || 400);
    return { message: isEdit ? 'Field updated' : 'Field added', applied };
  }

  // ---------- operations ----------
  async function addField(op, o) {
    if (!op.external_field) throw new Error('external_field is missing');
    if (findRow(op.external_field)) throw new Error('Field already exists on this form handler');
    const b = addBtn();
    if (!b) throw new Error('"+Add New Field" button not found');
    b.click();
    return fillAndSave(op, o, false);
  }

  async function editField(op, o) {
    const row = findRow(op.external_field);
    if (!row) throw new Error(`Field "${op.external_field}" not found`);
    if (!row.edit) throw new Error('Edit icon not found for this field');
    row.edit.click();
    return fillAndSave(op, o, true);
  }

  async function removeField(op) {
    const row = findRow(op.external_field);
    if (!row) throw new Error(`Field "${op.external_field}" not found`);
    if (!row.del) throw new Error('Delete icon not found for this field');
    document.documentElement.dataset.ptAutoConfirm = '1';
    try {
      row.del.click();
      await sleep(500);
      const confirm = [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')]
        .find(b => vis(b) && !row.del.contains(b) && /^(ok|yes|yes, delete|delete|confirm|remove)$/i.test((b.value || txt(b)).trim()));
      if (confirm) confirm.click();
      const gone = await waitFor(() => !findRow(op.external_field), 8000);
      if (!gone) throw new Error('Field is still listed after delete');
    } finally { delete document.documentElement.dataset.ptAutoConfirm; }
    return { message: 'Field removed', applied: { external_field: op.external_field } };
  }

  const runOp = (op, o) => op.action === 'add' ? addField(op, o)
    : op.action === 'edit' ? editField(op, o)
    : op.action === 'remove' ? removeField(op, o)
    : Promise.reject(new Error('Unknown action ' + op.action));

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (!msg || !String(msg.type).startsWith('PT_')) return;
    if (!isHandlerPage()) return;            // only the frame that holds the form handler answers
    if (msg.type === 'PT_PING') { send({ ok: true }); return; }
    (async () => {
      try {
        if (msg.type === 'PT_READ') {
          send({ ok: true, fields: readRows().map(({ name, target, required }) => ({ name, target, required })) });
        } else if (msg.type === 'PT_OP') {
          const r = await runOp(msg.op, msg.opts || {});
          send({ ok: true, message: r.message, applied: r.applied });
        }
      } catch (e) { send({ ok: false, message: e.message }); }
    })();
    return true;
  });
})();
