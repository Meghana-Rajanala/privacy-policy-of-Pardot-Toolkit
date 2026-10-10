#!/usr/bin/env python3
"""Mock Pardot for testing the Pardot Toolkit extension. Run:  python3 server.py   then open http://localhost:8080/formHandler/edit/id/48213"""
import json, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
PROSPECT_FIELDS = ["Email", "First Name", "Last Name", "Company", "Job Title", "Lead Source", "Phone", "Website", "Country", "Industry"]
FORMATS = ["Text", "Number", "Date", "Boolean", "Email"]
STATE = {}   # handler id -> list of {name, target, fmt, req}

def fields_for(hid):
    if hid not in STATE:
        STATE[hid] = [
            {"name": "email", "target": "Email", "fmt": "Text", "req": True},
            {"name": "company_name", "target": "Company", "fmt": "Text", "req": False},
            {"name": "lead_source", "target": "Lead Source", "fmt": "Text", "req": False},
        ]
    return STATE[hid]

SAMPLE = {
    "prospect": [(101, "Dana Acme"), (102, "Sam Rivers"), (103, "Priya Acme")],
    "visitor": [(201, "Visitor 7731 acme.example"), (202, "Visitor 7790 rivers.example")],
    "campaign": [(301, "Acme Spring Campaign"), (302, "Webinar Q4")],
    "formHandler": [(48213, "Acme Webinar Handler"), (48219, "Newsletter Handler")],
    "form": [(401, "Acme Contact Form"), (402, "Demo Request Form")],
}

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Edit Form Handler {hid}</title>
<style>
body{{font:14px Arial,sans-serif;margin:24px;max-width:760px}}
li.row{{list-style:none;padding:8px 10px;border:1px solid #ddd;margin:4px 0;display:flex;gap:10px;align-items:center}}
.icon{{display:inline-block;width:18px;height:18px;cursor:pointer;background:#ccd;border-radius:3px}}
.icon-trash{{background:#f3b9aa}}
.btn{{display:inline-block;padding:6px 12px;background:#0176d3;color:#fff;border-radius:4px;cursor:pointer;text-decoration:none;border:0}}
.modal{{display:none;position:fixed;top:60px;left:50%;margin-left:-220px;width:440px;background:#fff;border:1px solid #888;padding:16px;box-shadow:0 4px 20px rgba(0,0,0,.3)}}
.modal.show{{display:block}} .modal label{{display:block;margin-top:10px;font-weight:bold}}
.error{{color:#b00;margin-top:8px}}
</style></head><body>
<h2>Edit Form Handler</h2><p>Handler ID {hid}</p>
<ul id="rows"></ul>
<a class="btn" id="addnew" href="#">+Add New Field</a>
<div class="modal" id="modal" role="dialog">
  <h3 id="mtitle">Add Field</h3>
  <label for="ext">External Field Name</label><input id="ext" type="text" style="width:100%">
  <label for="pf">Prospect Field</label><select id="pf">{popts}</select>
  <label for="df">Data Format</label><select id="df">{fopts}</select>
  <label><input type="checkbox" id="req"> Required</label>
  <div class="error" id="err" style="display:none"></div>
  <p><button class="btn" id="save">Save changes</button> <button class="btn" id="cancel" style="background:#888">Cancel</button></p>
</div>
<script>
const HID="{hid}", RELOAD=location.search.includes('reload=1'), SLOW=location.search.includes('slow=1');
let fields=[], editing=null;
const $=s=>document.querySelector(s);
async function load(){{ fields=await (await fetch('/api/'+HID)).json(); render(); }}
function render(){{
  $('#rows').innerHTML='';
  fields.forEach(f=>{{
    const li=document.createElement('li'); li.className='row';
    li.innerHTML='<span class="txt">"'+f.name+'" maps to Default Field: '+f.target+(f.req?' (r)':'')+'</span>'+
      '<span class="icon icon-pencil" title="Edit"></span><span class="icon icon-trash" title="Delete"></span>';
    li.querySelector('.icon-pencil').onclick=()=>openModal(f);
    li.querySelector('.icon-trash').onclick=async()=>{{
      if(!confirm('Are you sure you want to delete "'+f.name+'"?')) return;
      await fetch('/api/'+HID+'/'+encodeURIComponent(f.name),{{method:'DELETE'}}); after();
    }};
    $('#rows').appendChild(li);
  }});
}}
function openModal(f){{
  editing=f?f.name:null; $('#mtitle').textContent=f?'Edit Field':'Add Field'; $('#err').style.display='none';
  $('#ext').value=f?f.name:''; $('#pf').selectedIndex=0; $('#df').selectedIndex=0; $('#req').checked=false;
  if(f){{ [...$('#pf').options].forEach((o,i)=>{{ if(o.text===f.target) $('#pf').selectedIndex=i; }}); [...$('#df').options].forEach((o,i)=>{{ if(o.text===f.fmt) $('#df').selectedIndex=i; }}); $('#req').checked=f.req; }}
  $('#modal').classList.add('show');
}}
function after(){{ if(RELOAD) location.reload(); else load(); }}
$('#addnew').onclick=e=>{{e.preventDefault(); openModal(null);}};
$('#cancel').onclick=()=>$('#modal').classList.remove('show');
$('#save').onclick=async()=>{{
  const body={{old:editing,name:$('#ext').value.trim(),target:$('#pf').selectedOptions[0].text,fmt:$('#df').selectedOptions[0].text,req:$('#req').checked}};
  if(SLOW) await new Promise(r=>setTimeout(r,1500));
  const r=await fetch('/api/'+HID,{{method:'POST',body:JSON.stringify(body)}}); const j=await r.json();
  if(!j.ok){{ $('#err').textContent=j.error; $('#err').style.display='block'; return; }}
  $('#modal').classList.remove('show'); after();
}};
load();
</script></body></html>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path); p = u.path
        m = re.match(r"^/formHandler/edit/id/(\d+)/?$", p)
        if m:
            if m.group(1) == "404": return self.out(200, "<h2>Form handler not found</h2>")
            popts = "".join(f'<option value="{x.lower().replace(" ","_")}">{x}</option>' for x in PROSPECT_FIELDS)
            fopts = "".join(f'<option>{x}</option>' for x in FORMATS)
            return self.out(200, PAGE.format(hid=m.group(1), popts=popts, fopts=fopts))
        m = re.match(r"^/api/(\d+)$", p)
        if m: return self.out(200, json.dumps(fields_for(m.group(1))), "application/json")
        m = re.match(r"^/(prospect|visitor|campaign|formHandler|form)/search$", p)
        if m:
            kind = m.group(1); q = (parse_qs(u.query).get("query", [""])[0]).lower()
            links = "".join(f'<tr><td><a href="/{kind}/read/id/{i}">{n}</a></td></tr>' for i, n in SAMPLE[kind] if q in n.lower())
            return self.out(200, f"<h2>{kind} search</h2><table>{links}</table>")
        m = re.match(r"^/(prospect|visitor|campaign|formHandler|form)/read/id/(\d+)$", p)
        if m: return self.out(200, f"<h2>{m.group(1)} {m.group(2)} (mock detail page)</h2>")
        return self.out(200, "<h3>Mock Pardot</h3><p>Try <a href='/formHandler/edit/id/48213'>/formHandler/edit/id/48213</a></p>")

    def do_POST(self):
        m = re.match(r"^/api/(\d+)$", urlparse(self.path).path)
        d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        fs = fields_for(m.group(1))
        if not d.get("name"): return self.out(200, json.dumps({"ok": False, "error": "External field name can't be blank"}), "application/json")
        if any(f["name"].lower() == d["name"].lower() and f["name"] != d.get("old") for f in fs):
            return self.out(200, json.dumps({"ok": False, "error": "External field name has already been taken"}), "application/json")
        row = {"name": d["name"], "target": d["target"], "fmt": d["fmt"], "req": d["req"]}
        i = next((i for i, f in enumerate(fs) if f["name"] == d.get("old")), None)
        if i is None: fs.append(row)
        else: fs[i] = row
        return self.out(200, json.dumps({"ok": True}), "application/json")

    def do_DELETE(self):
        m = re.match(r"^/api/(\d+)/(.+)$", urlparse(self.path).path)
        from urllib.parse import unquote
        fs = fields_for(m.group(1)); STATE[m.group(1)] = [f for f in fs if f["name"] != unquote(m.group(2))]
        return self.out(200, json.dumps({"ok": True}), "application/json")

if __name__ == "__main__":
    print(f"Mock Pardot running at http://localhost:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("localhost", PORT), H).serve_forever()
