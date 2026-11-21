const HRCore = require('../backend/Core.js');
const assert = require('assert');
const tables = {}; Object.keys(HRCore.SCHEMA).forEach(n => tables[n] = []);
const key = n => HRCore.SCHEMA[n][0];
const toStr = (o, n) => { const r = {}; HRCore.SCHEMA[n].forEach(h => r[h] = o[h] == null ? '' : String(o[h])); return r; };
const store = {
  all: n => tables[n].map(r => ({ ...r })),
  find: (n, id) => { const r = tables[n].find(x => x[key(n)] === String(id)); return r ? { ...r } : null; },
  insert: (n, o) => tables[n].push(toStr(o, n)),
  update: (n, id, p) => { const r = tables[n].find(x => x[key(n)] === String(id)); Object.assign(r, toStr({ ...r, ...p }, n)); }
};
const mem = {}; const cache = { get: k => mem[k] || null, put: (k, v) => mem[k] = v, remove: k => delete mem[k] };
let i = 0; const uid = () => 'id' + (++i);
const mails = [];
const core = HRCore.create({ store, cache, uid, hash: (p, s) => s + ':' + p, mail: (to, sub) => mails.push([to, sub]), now: () => new Date('2026-11-21T10:00:00Z'), log: e => { throw e; } });

store.insert('Admins', { id: 'a1', email: 'own@acri.org', name: 'Fenil', role: 'owner', salt: 's', hash: 's:password1', active: 'TRUE' });
store.insert('Programmes', { id: 'p1', name: 'Abhivyakti', students: 18, pay_model: 'tbd', pool_per_student: 1500, planned_sessions: 25, acri_cut_pct: 0, status: 'active' });
['Student Book Development', 'ACRI Service Charge'].forEach(n => store.insert('DeductionHeads', { id: uid(), name: n, active: 'TRUE' }));
function ok(r) { if (!r.ok) throw new Error(r.error); return r; }

const L = ok(core.handle({ action: 'login', role: 'admin', email: 'own@acri.org', password: 'password1' }));
const T = L.token;
ok(core.handle({ action: 'saveFacilitator', token: T, name: 'Yashvi', email: 'y@x.com', programme_id: 'p1', appointed_on: '2026-10-17' }));
const fid = tables.Facilitators[0].id;
const S = (n, d, extra) => { ok(core.handle({ action: 'saveSession', token: T, programme_id: 'p1', number: n, date: d, extra })); return tables.Sessions.at(-1).id; };
const s1 = S('1', '2026-10-17'), s2 = S('2', '2026-10-24'), s3 = S('3', '2026-10-31'), sx = S('X', '2026-11-14', true), s5 = S('5', '2026-11-21');

// rate TBD: attendance present -> rate_pending
ok(core.handle({ action: 'markAttendance', token: T, session_id: s1, facilitator_id: fid, status: 'present' }));
assert.equal(tables.Payments[0].status, 'rate_pending');
// absent -> not payable
ok(core.handle({ action: 'markAttendance', token: T, session_id: s5, facilitator_id: fid, status: 'absent' }));
assert.equal(tables.Payments.find(p => p.session_id === s5).status, 'not_payable');

// switch to fund model: no money yet
ok(core.handle({ action: 'saveProgramme', token: T, id: 'p1', name: 'Abhivyakti', students: 18, pay_model: 'fund', planned_sessions: 25, acri_cut_pct: 0, recalculate: true }));
assert.equal(tables.Payments[0].status, 'rate_pending', 'no fund money -> no rate');

// VP records fund: 45,000 received, 18,000 + 9,000 deducted -> pool 18,000 -> 720 / session
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'credit', amount: 45000, date: '2026-11-20', note: 'AGS fees' }));
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'deduction', head: 'Student Book Development', amount: 18000, date: '2026-11-20' }));
const bad = core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'deduction', head: 'Nope', amount: 5, date: '2026-11-20' });
assert.equal(bad.ok, false);
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'deduction', head: 'ACRI Service Charge', amount: 26280, date: '2026-11-20' }));
// pool = 45000-18000-26280 = 720 -> rate = floor(720/25)=28 ; set per_session instead for clarity
ok(core.handle({ action: 'saveProgramme', token: T, id: 'p1', name: 'Abhivyakti', students: 18, pay_model: 'per_session', rate_per_session: 500, planned_sessions: 25, acri_cut_pct: 0, recalculate: true }));
// available = 720 -> session1 500 pending
assert.equal(tables.Payments[0].status, 'pending');
ok(core.handle({ action: 'markAttendance', token: T, session_id: s2, facilitator_id: fid, status: 'present' }));
assert.equal(tables.Payments.find(p => p.session_id === s2).status, 'awaiting_funds', 'regular session, no money');
ok(core.handle({ action: 'markAttendance', token: T, session_id: sx, facilitator_id: fid, status: 'present' }));
assert.equal(tables.Payments.find(p => p.session_id === sx).status, 'pro_bono', 'extra session, no money');
// cannot approve awaiting funds
assert.equal(core.handle({ action: 'setPaymentStatus', token: T, payment_id: tables.Payments.find(p => p.session_id === s2).id, status: 'approved' }).ok, false);
// top up fund -> recalculation releases session 2
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'credit', amount: 1000, date: '2026-11-21' }));
assert.equal(tables.Payments.find(p => p.session_id === s2).status, 'pending');
// approve and pay session 1
const p1 = tables.Payments[0].id;
ok(core.handle({ action: 'setPaymentStatus', token: T, payment_id: p1, status: 'approved' }));
assert.equal(core.handle({ action: 'setPaymentStatus', token: T, payment_id: p1, status: 'paid' }).ok, false, 'needs UTR');
ok(core.handle({ action: 'setPaymentStatus', token: T, payment_id: p1, status: 'paid', paid_ref: 'UTR123' }));

// facilitator flow
const f = tables.Facilitators[0]; store.update('Facilitators', f.id, { salt: 'q', hash: 'q:yashvi123' });
const FL = ok(core.handle({ action: 'login', email: 'Y@X.com', password: 'yashvi123' }));
let d = FL.data;
assert.equal(d.totals.paid, 500); assert.equal(d.totals.proBono, 1);
assert.ok(d.programmes[0].fund.byHead.length === 2);
// claim future session blocked, claim s3 ok
const sfut = S('7', '2026-12-05');
assert.equal(core.handle({ action: 'claimAttendance', token: FL.token, session_id: sfut }).ok, false);
d = ok(core.handle({ action: 'claimAttendance', token: FL.token, session_id: s3, note: 'Took group 1' })).data;
assert.equal(d.sessions.find(x => x.id === s3).attendance.status, 'claimed');
// facilitator cannot call admin action
assert.equal(core.handle({ action: 'addFundEntry', token: FL.token }).ok, false);
// admin rejects claim without reason -> fail; with reason ok
const att = tables.Attendance.find(a => a.session_id === s3);
assert.equal(core.handle({ action: 'verifyClaim', token: T, attendance_id: att.id, decision: 'reject' }).ok, false);
ok(core.handle({ action: 'verifyClaim', token: T, attendance_id: att.id, decision: 'reject', remarks: 'Not in Meet log' }));
assert.equal(tables.Payments.find(p => p.session_id === s3).status, 'not_payable');
// re-claim after rejection allowed
ok(core.handle({ action: 'claimAttendance', token: FL.token, session_id: s3 }));
// admin-only VP rule: plain admin can't add fund
ok(core.handle({ action: 'saveAdmin', token: T, name: 'Prashant', email: 'vp@acri.org', role: 'admin' }));
const ad = tables.Admins.find(a => a.email === 'vp@acri.org'); store.update('Admins', ad.id, { salt: 'z', hash: 'z:password2' });
const AL = ok(core.handle({ action: 'login', role: 'admin', email: 'vp@acri.org', password: 'password2' }));
assert.equal(core.handle({ action: 'addFundEntry', token: AL.token, programme_id: 'p1', type: 'credit', amount: 1, date: '2026-11-21' }).ok, false);
// manual email
ok(core.handle({ action: 'sendEmail', token: T, to: 'all', subject: 'Hello', message: 'Line1\nLine2' }));
ok(core.handle({ action: 'raiseQuery', token: FL.token, subject: 'Pay?', message: 'When?' }));
ok(core.handle({ action: 'answerQuery', token: T, query_id: tables.Queries[0].id, response: 'Soon' }));
// password change
ok(core.handle({ action: 'changePassword', token: FL.token, current: 'yashvi123', next: 'newpass123' }));
console.log('All tests passed.', mails.length, 'emails queued');
console.log(tables.EmailLog.map(e => e.status).every(s => s === 'sent'));
