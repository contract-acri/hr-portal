const HRCore = require('../backend/Core.js'); const assert = require('assert');
const tables = {}; Object.keys(HRCore.SCHEMA).forEach(n => tables[n] = []);
const key = n => HRCore.SCHEMA[n][0];
const toStr = (o, n) => { const r = {}; HRCore.SCHEMA[n].forEach(h => r[h] = o[h] == null ? '' : String(o[h])); return r; };
const store = { all: n => tables[n].map(r => ({ ...r })), find: (n, id) => { const r = tables[n].find(x => x[key(n)] === String(id)); return r ? { ...r } : null; },
  insert: (n, o) => tables[n].push(toStr(o, n)), update: (n, id, p) => { const r = tables[n].find(x => x[key(n)] === String(id)); Object.assign(r, toStr({ ...r, ...p }, n)); } };
const mem = {}; let i = 0; const mails = [];
const core = HRCore.create({ store, cache: { get: k => mem[k] || null, put: (k, v) => mem[k] = v, remove: k => delete mem[k] }, uid: () => 'id' + (++i), hash: (p, s) => s + ':' + p, mail: (t, s) => mails.push(s), now: () => new Date('2026-11-21T10:00:00Z'), log: e => { throw e; } });
const ok = r => { if (!r.ok) throw new Error(r.error); return r; };
store.insert('Admins', { id: 'a1', email: 'vp@a', name: 'VP', role: 'vp', salt: 's', hash: 's:password1', active: 'TRUE' });
store.insert('Programmes', { id: 'p1', name: 'Abhivyakti', students: 18, pay_model: 'share', planned_sessions: 25, acri_cut_pct: 0, status: 'active' });
store.insert('DeductionHeads', { id: 'h1', name: 'Books', active: 'TRUE' });
const T = ok(core.handle({ action: 'login', role: 'admin', email: 'vp@a', password: 'password1' })).token;
ok(core.handle({ action: 'saveFacilitator', token: T, name: 'Yashvi', email: 'y@x', programme_id: 'p1' }));
const fid = tables.Facilitators[0].id;
const S = (d, extra) => { ok(core.handle({ action: 'saveSession', token: T, programme_id: 'p1', number: d, date: d, extra })); return tables.Sessions.at(-1).id; };
const ss = ['2026-10-17', '2026-10-24', '2026-10-31'].map(d => S(d));
ss.forEach(s => ok(core.handle({ action: 'markAttendance', token: T, session_id: s, facilitator_id: fid, status: 'present' })));
assert.ok(tables.Payments.every(p => p.status === 'eligible'));
const sx = S('2026-11-14', true); ok(core.handle({ action: 'markAttendance', token: T, session_id: sx, facilitator_id: fid, status: 'present' }));
assert.equal(tables.Payments.at(-1).status, 'pro_bono');
// second facilitator, equal split by default
ok(core.handle({ action: 'saveFacilitator', token: T, name: 'Fenil', email: 'f@x', programme_id: 'p1' }));
const f2 = tables.Facilitators[1].id;
ss.forEach(s => ok(core.handle({ action: 'markAttendance', token: T, session_id: s, facilitator_id: f2, status: 'present' })));
// Yashvi misses one more held session (Nov 7)
const s4 = S('2026-11-07'); ok(core.handle({ action: 'markAttendance', token: T, session_id: s4, facilitator_id: f2, status: 'present' }));
ok(core.handle({ action: 'markAttendance', token: T, session_id: s4, facilitator_id: fid, status: 'absent' }));
assert.equal(core.handle({ action: 'distributeFund', token: T, programme_id: 'p1' }).ok, false, 'empty pool');
// lump sum 45,000; locked deductions 18,000 + 9,000 => pool 18,000
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'credit', amount: 45000, date: '2026-12-01' }));
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'deduction', head: 'Books', amount: 18000, date: '2026-12-01' }));
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'deduction', head: 'Books', amount: 9000, date: '2026-12-01' }));
let pv = ok(core.handle({ action: 'previewDistribution', token: T, programme_id: 'p1' })).data.preview;
const ly = pv.lines.find(l => l.facilitator_id === fid), lf = pv.lines.find(l => l.facilitator_id === f2);
// held = 4 (extra excluded); 50% each = 9,000; Yashvi 3/4 = 6,750 ; Fenil 4/4 = 9,000
assert.equal(pv.held, 4); assert.equal(ly.full, 9000); assert.equal(ly.entitlement, 6750); assert.equal(ly.absence_cut, 2250); assert.equal(lf.entitlement, 9000);
ok(core.handle({ action: 'distributeFund', token: T, programme_id: 'p1' }));
assert.equal(tables.Payouts.find(o => o.facilitator_id === fid).amount, '6750');
assert.equal(core.handle({ action: 'distributeFund', token: T, programme_id: 'p1' }).ok, false, 'nothing new');
// custom shares: Yashvi 60, Fenil 40 -> top-up for Yashvi: 18000*.6*.75=8100-6750=1350; Fenil 7200 < 9000 -> 0
ok(core.handle({ action: 'setShare', token: T, programme_id: 'p1', facilitator_id: fid, share_pct: 60 }));
ok(core.handle({ action: 'setShare', token: T, programme_id: 'p1', facilitator_id: f2, share_pct: 40 }));
ok(core.handle({ action: 'distributeFund', token: T, programme_id: 'p1' }));
assert.equal(tables.Payouts.at(-1).amount, '1350');
// shares over 100% blocked
ok(core.handle({ action: 'setShare', token: T, programme_id: 'p1', facilitator_id: f2, share_pct: 50 }));
assert.equal(core.handle({ action: 'distributeFund', token: T, programme_id: 'p1' }).ok, false);
ok(core.handle({ action: 'setShare', token: T, programme_id: 'p1', facilitator_id: f2, share_pct: 40 }));
// pay it
const py = tables.Payouts[0].id;
ok(core.handle({ action: 'setPayoutStatus', token: T, payout_id: py, status: 'approved' }));
assert.equal(core.handle({ action: 'setPayoutStatus', token: T, payout_id: py, status: 'paid' }).ok, false);
ok(core.handle({ action: 'setPayoutStatus', token: T, payout_id: py, status: 'paid', paid_ref: 'UTR1' }));
// second lump sum later: +20,000 => pool 38,000; Yashvi 60% × 3/4 = 17,100 - 8,100 = 9,000
ok(core.handle({ action: 'addFundEntry', token: T, programme_id: 'p1', type: 'credit', amount: 20000, date: '2027-02-15' }));
ok(core.handle({ action: 'distributeFund', token: T, programme_id: 'p1' }));
assert.equal(tables.Payouts.filter(o => o.facilitator_id === fid).at(-1).amount, '9000');
const fund = ok(core.handle({ action: 'dashboard', token: T })).data.programmes[0].fund;
assert.equal(fund.pool, 38000);
store.update('Facilitators', fid, { salt: 'q', hash: 'q:yashvi123' });
const FD = ok(core.handle({ action: 'login', email: 'y@x', password: 'yashvi123' })).data;
assert.equal(FD.totals.paid, 6750); assert.equal(FD.payouts.length, 3);
console.log('Lump-sum share tests passed.', mails.length, 'emails');
