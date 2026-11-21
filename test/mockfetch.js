// Test-only: serves the API from Core.js inside the page.
(function () {
  window.HR_CONFIG = { API_URL: 'https://mock/exec' };
  Object.defineProperty(window, 'HR_CONFIG', { value: { API_URL: 'https://mock/exec' }, writable: false });
  var T = {}; Object.keys(HRCore.SCHEMA).forEach(function (n) { T[n] = []; });
  function key(n) { return HRCore.SCHEMA[n][0]; }
  function S(o, n) { var r = {}; HRCore.SCHEMA[n].forEach(function (h) { r[h] = o[h] == null ? '' : String(o[h]); }); return r; }
  var store = { all: function (n) { return T[n].map(function (r) { return Object.assign({}, r); }); },
    find: function (n, id) { var r = T[n].filter(function (x) { return x[key(n)] === String(id); })[0]; return r ? Object.assign({}, r) : null; },
    insert: function (n, o) { T[n].push(S(o, n)); }, update: function (n, id, p) { var r = T[n].filter(function (x) { return x[key(n)] === String(id); })[0]; Object.assign(r, S(Object.assign({}, r, p), n)); } };
  var saved = JSON.parse(localStorage.getItem('mockT') || 'null'); if (saved) T = saved;
  var mem = JSON.parse(localStorage.getItem('mockC') || '{}');
  var cache = { get: function (k) { return mem[k] || null; }, put: function (k, v) { mem[k] = v; }, remove: function (k) { delete mem[k]; } };
  var n = 0; function uid() { return 'u' + Date.now().toString(36) + (++n) + Math.random().toString(36).slice(2, 5); }
  var core = HRCore.create({ store: store, cache: cache, uid: uid, hash: function (p, s) { return s + ':' + p; }, mail: function () {} });
  if (!saved) {
    store.insert('Settings', { key: 'PORTAL_URL', value: 'https://hr.acriindia.org.in' });
    store.insert('Admins', { id: 'a1', email: 'president@acriindia.org', name: 'Fenil Pritesh Shah', role: 'owner', salt: 's', hash: 's:admin1234', active: 'TRUE' });
    store.insert('Admins', { id: 'a2', email: 'vice-president@acriindia.org', name: 'Prashant Pareek', role: 'vp', salt: 's', hash: 's:vp123456', active: 'TRUE' });
    ['Student Book Development', 'Programme Resources & Session Material', 'ACRI Service Charge'].forEach(function (h, i) { store.insert('DeductionHeads', { id: 'h' + i, name: h, active: 'TRUE' }); });
    store.insert('Programmes', { id: 'p1', name: 'Abhivyakti 2026–27', school: 'Apple Global School', students: 18, pay_model: 'share', planned_sessions: 25, status: 'active' });
    store.insert('Facilitators', { id: 'f1', name: 'Yashvi Ramesh Mehta', email: 'yashvi.mehta07@gmail.com', salt: 's', hash: 's:yashvi123', status: 'active', appointment_ref: 'ACRI/HR/APT/2026-27/001', must_change: 'FALSE' });
    store.insert('Facilitators', { id: 'f2', name: 'Fenil Pritesh Shah', email: 'fenil@fenilpshah.com', salt: 's', hash: 's:fenil1234', status: 'active', must_change: 'FALSE' });
    store.insert('Assignments', { id: 'as1', programme_id: 'p1', facilitator_id: 'f1', status: 'active' });
    store.insert('Assignments', { id: 'as2', programme_id: 'p1', facilitator_id: 'f2', status: 'active' });
    [['1', '2026-10-17'], ['2', '2026-10-24'], ['3', '2026-10-31'], ['4', '2026-11-07'], ['5', '2026-11-21'], ['6', '2026-11-28']].forEach(function (x, i) {
      var sess = { id: 's' + i, programme_id: 'p1', number: x[0], date: x[1], group: 'All groups', mode: i === 4 ? 'offline' : 'online', status: i < 5 ? 'held' : 'scheduled', extra: 'FALSE' };
      store.insert('Sessions', sess);
      if (i < 5) {
        var y = i === 3 || i === 4 ? 'absent' : 'present';
        [['f1', y], ['f2', 'present']].forEach(function (z) { store.insert('Attendance', { id: 'at' + i + z[0], session_id: sess.id, facilitator_id: z[0], status: z[1] }); core.syncPayment(z[0], sess, z[1]); });
      }
    });
  }
  window.fetch = function (url, opts) {
    var res = core.handle(JSON.parse(opts.body));
    localStorage.setItem('mockT', JSON.stringify(T)); localStorage.setItem('mockC', JSON.stringify(mem));
    return Promise.resolve({ json: function () { return Promise.resolve(JSON.parse(JSON.stringify(res))); } });
  };
})();
