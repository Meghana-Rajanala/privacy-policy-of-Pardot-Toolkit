// Shared by popup, background service worker and content script.
var PT = globalThis.PT || (() => {
  const DEFAULTS = {
    baseUrl: 'https://pi.pardot.com',
    template: '/formHandler/edit/id/{ID}',
    parallel: 3,
    delay: 400,
    defaultRequired: 'no',   // 'no' | 'yes' | 'leave'
    notifyOnEnd: true,
    closeTabs: true,
    search: {
      prospects: '/prospect/search?query={Q}',
      visitors: '/visitor/search?query={Q}',
      campaigns: '/campaign/search?query={Q}',
      formHandlers: '/formHandler/search?query={Q}',
      forms: '/form/search?query={Q}'
    }
  };

  async function getSettings() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    return { ...DEFAULTS, ...settings, search: { ...DEFAULTS.search, ...(settings.search || {}) } };
  }
  const saveSettings = settings => chrome.storage.local.set({ settings });

  function buildUrl(s, id) {
    return s.baseUrl.replace(/\/+$/, '') + s.template.replace('{ID}', encodeURIComponent(id));
  }

  // "yes"/"required" -> true, "no"/"not required" -> false, blank/unknown -> null
  function parseRequired(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return null;
    if (/^(no|n|false|0|optional|not[ _-]?required|unchecked)$/.test(s)) return false;
    if (/^(yes|y|true|1|required|checked)$/.test(s)) return true;
    return null;
  }

  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!text) return [];
    const d = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += c;
    }
    row.push(cur); rows.push(row);
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }

  function toCsv(rows, cols) {
    const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  }

  const ALIAS = {
    form_handler_id: ['form_handler_id', 'formhandler_id', 'handler_id', 'form_handler', 'id'],
    action: ['action', 'operation'],
    external_field: ['external_field', 'external_field_name', 'field', 'field_name'],
    prospect_field: ['prospect_field', 'prospect_field_api_name', 'prospect', 'api_name'],
    data_format: ['data_format', 'format'],
    required: ['required', 'is_required'],
    new_external_field: ['new_external_field', 'new_external_field_name', 'new_name']
  };

  function normalizeAction(a) {
    const s = String(a || '').trim().toLowerCase();
    if (!s || /^(add|new|create)$/.test(s)) return 'add';
    if (/^(edit|update|change)$/.test(s)) return 'edit';
    if (/^(remove|delete|del)$/.test(s)) return 'remove';
    return 'invalid:' + s;
  }

  // Returns { rows, errors }
  function normalizeRows(text) {
    const table = parseCsv(text);
    if (!table.length) return { rows: [], errors: [] };
    const head = table[0].map(h => h.trim().toLowerCase().replace(/[\s\-]+/g, '_'));
    const idx = {};
    for (const k in ALIAS) idx[k] = head.findIndex(h => ALIAS[k].includes(h));
    if (idx.form_handler_id < 0) return { rows: [], errors: ['Header row needs a form_handler_id column.'] };
    const rows = [], errors = [];
    table.slice(1).forEach((r, i) => {
      const get = k => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      const idm = get('form_handler_id').match(/(\d+)\D*$/);
      const row = {
        line: i + 2,
        form_handler_id: idm ? idm[1] : '',
        action: normalizeAction(get('action')),
        external_field: get('external_field'),
        prospect_field: get('prospect_field'),
        data_format: get('data_format'),
        required: get('required'),
        new_external_field: get('new_external_field')
      };
      if (!row.form_handler_id) errors.push(`Line ${row.line}: missing form handler ID`);
      else if (row.action.startsWith('invalid:')) errors.push(`Line ${row.line}: unknown action "${row.action.slice(8)}"`);
      else if (!row.external_field) errors.push(`Line ${row.line}: missing external_field`);
      else if (row.action === 'add' && !row.prospect_field) errors.push(`Line ${row.line}: prospect_field needed to add a field`);
      else rows.push(row);
    });
    return { rows, errors };
  }

  return { DEFAULTS, getSettings, saveSettings, buildUrl, parseRequired, parseCsv, toCsv, normalizeRows };
})();
