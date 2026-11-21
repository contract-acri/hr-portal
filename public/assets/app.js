/* ACRI HR Portal — shared front-end helpers (API, demo backend, UI bits). */
(function () {
  'use strict';
  var cfg = window.HR_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var DEMO = !cfg.API_URL || params.has('demo');

  // ---------- demo backend: the real Core logic over an in-memory store ----------
  function demoBackend() {
    var tables = {};
    Object.keys(HRCore.SCHEMA).forEach(function (n) { tables[n] = []; });
    function key(n) { return HRCore.SCHEMA[n][0]; }
    function toStr(o, n) { var r = {}; HRCore.SCHEMA[n].forEach(function (h) { r[h] = o[h] == null ? '' : String(o[h]); }); return r; }
    var store = {
      all: function (n) { return tables[n].map(function (r) { return Object.assign({}, r); }); },
      find: function (n, id) { var r = tables[n].filter(function (x) { return x[key(n)] === String(id); })[0]; return r ? Object.assign({}, r) : null; },
      insert: function (n, o) { tables[n].push(toStr(o, n)); },
      update: function (n, id, p) { var r = tables[n].filter(function (x) { return x[key(n)] === String(id); })[0]; if (!r) throw new Error('not found'); Object.assign(r, toStr(Object.assign({}, r, p), n)); }
    };
    var mem = {};
    var cache = { get: function (k) { return mem[k] || null; }, put: function (k, v) { mem[k] = v; }, remove: function (k) { delete mem[k]; } };
    function hash(pw, salt) { var h = 5381, s = salt + '|' + pw; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'd' + h.toString(16); }
    var n = 0; function uid() { n++; return 'x' + Date.now().toString(36).slice(-4) + n.toString(36) + Math.random().toString(36).slice(2, 6); }
    var core = HRCore.create({ store: store, cache: cache, hash: hash, uid: uid, mail: function (to, subject) { console.log('[demo email]', to, subject); } });

    // seed
    var now = new Date().toISOString();
    [['PORTAL_URL', 'https://hr.acriindia.org.in'], ['ADMIN_NOTIFY_EMAIL', 'president@acriindia.org']].forEach(function (kv) { store.insert('Settings', { key: kv[0], value: kv[1] }); });
    var s1 = uid(); store.insert('Admins', { id: uid(), email: 'admin@acriindia.org', name: 'Fenil Shah', role: 'owner', salt: s1, hash: hash('admin1234', s1), active: 'TRUE', created_at: now });
    var vs = uid(); store.insert('Admins', { id: uid(), email: 'vp@acriindia.org', name: 'Prashant Pareek', role: 'vp', salt: vs, hash: hash('vp123456', vs), active: 'TRUE', created_at: now });
    ['Student Book Development', 'Programme Resources & Session Material', 'ACRI Service Charge', 'Printing & Logistics', 'Events & Showcase Support', 'ACRI Development Reserve']
      .forEach(function (h) { store.insert('DeductionHeads', { id: uid(), name: h, description: '', active: 'TRUE' }); });
    var pid = uid();
    store.insert('Programmes', { id: pid, name: 'Abhivyakti 2026–27', school: 'Apple Global School', students: 18, pay_model: 'tbd', rate_per_session: 0, pool_per_student: 1500, planned_sessions: 25, acri_cut_pct: 0, status: 'active', created_at: now });
    var fid = uid(), s2 = uid();
    store.insert('Facilitators', { id: fid, name: 'Yashvi Ramesh Mehta', email: 'yashvi@example.com', phone: '', salt: s2, hash: hash('demo1234', s2), status: 'active', appointment_ref: 'ACRI/HR/APT/2026-27/001', appointed_on: '2026-10-17', must_change: 'FALSE', created_at: now });
    store.insert('Assignments', { id: uid(), programme_id: pid, facilitator_id: fid, role: 'Facilitator', from_date: '2026-10-17', status: 'active' });
    var plan = [['1', '2026-10-17', 'Grades 3–5, 6–8', 'online', 'held', 'present'], ['2', '2026-10-24', 'Grades 3–5, 6–8', 'online', 'held', 'present'], ['3', '2026-10-31', 'All groups', 'online', 'held', 'present'],
      ['4', '2026-11-07', 'All groups', 'online', 'held', null], ['5', '2026-11-21', 'All groups', 'offline', 'held', null], ['6', '2026-11-28', 'All groups', 'online', 'scheduled', null]];
    plan.forEach(function (p) {
      var sid = uid(), sess = { id: sid, programme_id: pid, number: p[0], date: p[1], group: p[2], mode: p[3], topic: '', status: p[4] };
      store.insert('Sessions', sess);
      if (p[5]) { store.insert('Attendance', { id: uid(), session_id: sid, facilitator_id: fid, status: 'present', verified_by: 'setup', verified_at: now, remarks: 'Confirmed in appointment letter' }); core.syncPayment(fid, sess, 'present'); }
    });
    return function (body) { return Promise.resolve(JSON.parse(JSON.stringify(core.handle(body)))); };
  }

  var demo = DEMO ? demoBackend() : null;

  function call(body) {
    if (demo) return demo(body);
    return fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; });
  }

  // ---------- UI helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { if (v === '' || v == null) return '—'; return '₹' + Math.round(Number(v)).toLocaleString('en-IN'); }
  function date(d) { if (!d) return '—'; var x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  var ATT = { present: ['Present', 'green'], absent: ['Absent', 'red'], claimed: ['Awaiting verification', 'amber'], rejected: ['Rejected', 'red'] };
  var PAY = { rate_pending: ['Rate to be finalised', 'blue'], pending: ['Pending approval', 'amber'], approved: ['Approved', 'green'], withheld: ['Withheld', 'red'], rejected: ['Rejected', 'red'], paid: ['Paid', 'dark'], not_payable: ['Not payable', ''] };
  function pill(map, k) { var m = map[k]; return m ? '<span class="pill ' + m[1] + '">' + m[0] + '</span>' : '<span class="pill">' + esc(k || '—') + '</span>'; }

  function toast(msg) {
    document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // fields: [{name,label,type,options,value,help,required}]
  function form(title, fields, submitLabel, onSubmit) {
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" role="dialog" aria-label="' + esc(title) + '"><div class="hd">' + esc(title) + '</div><form><div class="bd"><div class="err"></div>' +
      fields.map(function (f) {
        var v = f.value == null ? '' : f.value, input;
        if (f.type === 'select') input = '<select class="i" name="' + f.name + '">' + f.options.map(function (o) { var val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (String(val) === String(v) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join('') + '</select>';
        else if (f.type === 'textarea') input = '<textarea class="i" name="' + f.name + '"' + (f.required ? ' required' : '') + '>' + esc(v) + '</textarea>';
        else if (f.type === 'checkbox') return '<label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="' + f.name + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
        else input = '<input class="i" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' + (f.required ? ' required' : '') + (f.step ? ' step="' + f.step + '"' : '') + '>';
        return '<label class="f">' + esc(f.label) + (f.help ? '<span class="h">' + esc(f.help) + '</span>' : '') + input + '</label>';
      }).join('') +
      '</div><div class="ft"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn" type="submit">' + esc(submitLabel || 'Save') + '</button></div></form></div>';
    document.body.appendChild(bg);
    var fm = bg.querySelector('form'), err = bg.querySelector('.err');
    function close() { bg.remove(); }
    bg.querySelector('[data-x]').onclick = close;
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    fm.onsubmit = function (e) {
      e.preventDefault();
      var data = {};
      fields.forEach(function (f) { var el = fm.elements[f.name]; data[f.name] = f.type === 'checkbox' ? el.checked : el.value; });
      var btn = fm.querySelector('[type=submit]'); btn.disabled = true;
      Promise.resolve(onSubmit(data)).then(function (res) {
        btn.disabled = false;
        if (res && res.ok === false) { err.innerHTML = '<div class="note err">' + esc(res.error) + '</div>'; return; }
        close();
      });
    };
    var first = fm.querySelector('input,select,textarea'); if (first) first.focus();
  }

  window.HR = { call: call, DEMO: DEMO, esc: esc, money: money, date: date, pill: pill, ATT: ATT, PAY: PAY, toast: toast, form: form };
})();
