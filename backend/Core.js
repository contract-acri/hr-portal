/**
 * ACRI HR Portal — core logic (hr.acriindia.org.in)
 *
 * This file is shared: it runs inside Google Apps Script (as Core.gs) and in the
 * browser demo (public/assets/core.js). It knows nothing about Sheets or Zoho;
 * those are passed in as `deps` by the adapter (Code.gs or the demo).
 */
var HRCore = (function () {
  'use strict';

  var SCHEMA = {
    Settings:     ['key', 'value'],
    Admins:       ['id', 'email', 'name', 'role', 'salt', 'hash', 'active', 'created_at'],
    Facilitators: ['id', 'name', 'email', 'phone', 'salt', 'hash', 'status', 'appointment_ref', 'appointed_on', 'must_change', 'created_at'],
    Programmes:   ['id', 'name', 'school', 'students', 'pay_model', 'rate_per_session', 'pool_per_student', 'planned_sessions', 'acri_cut_pct', 'status', 'created_at'],
    Assignments:  ['id', 'programme_id', 'facilitator_id', 'role', 'from_date', 'status', 'share_pct'],
    Sessions:     ['id', 'programme_id', 'number', 'date', 'group', 'mode', 'topic', 'status', 'extra'],
    Attendance:   ['id', 'session_id', 'facilitator_id', 'status', 'claim_note', 'claimed_at', 'verified_by', 'verified_at', 'remarks'],
    Payments:     ['id', 'facilitator_id', 'session_id', 'programme_id', 'gross', 'acri_cut', 'net', 'status', 'reason', 'paid_ref', 'paid_on', 'updated_at'],
    FundEntries:  ['id', 'programme_id', 'date', 'type', 'head', 'amount', 'note', 'recorded_by', 'created_at'],
    DeductionHeads: ['id', 'name', 'description', 'active'],
    Payouts:      ['id', 'programme_id', 'facilitator_id', 'created_at', 'sessions', 'per_session', 'entitlement', 'previous', 'amount', 'basis', 'status', 'reason', 'paid_ref', 'paid_on', 'updated_at'],
    Queries:      ['id', 'facilitator_id', 'subject', 'message', 'status', 'response', 'created_at', 'updated_at'],
    EmailLog:     ['id', 'at', 'to', 'subject', 'status', 'error'],
    AuditLog:     ['id', 'at', 'actor', 'action', 'details']
  };

  // tbd: rate not set yet · per_session: flat rate · pool: (per-student amount × students) ÷ planned sessions
  // fund: (money received − ACRI deductions) ÷ planned sessions, from the ACRI Abhivyakti Fund
  // share: no rate per session. The lump sum from the school, minus ACRI's locked deductions, is split between
  //        the facilitators (equally, or by share %). Each facilitator's part is reduced in proportion to the
  //        sessions they missed. Worked out again whenever money comes in (see distributeFund).
  var PAY_MODELS = ['share', 'tbd', 'per_session', 'pool', 'fund'];
  var PAYOUT_COUNTED = ['pending', 'approved', 'paid', 'withheld'];
  var FUND_ROLES = ['owner', 'vp'];
  var ATT_STATUS = ['claimed', 'present', 'absent', 'rejected'];
  // Payment statuses an admin can set by hand.
  var PAY_SET = ['pending', 'approved', 'withheld', 'rejected', 'paid', 'pro_bono'];
  // Payments that use up money from the fund.
  var COMMITTED = ['pending', 'approved', 'paid'];
  var TOKEN_TTL = 6 * 60 * 60; // seconds

  function create(deps) {
    var store = deps.store, mail = deps.mail, cache = deps.cache;
    var now = deps.now || function () { return new Date(); };

    function iso() { return now().toISOString(); }
    function today() { return iso().slice(0, 10); }
    function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
    function str(v) { return v == null ? '' : String(v).trim(); }
    function bool(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
    function lower(v) { return str(v).toLowerCase(); }
    function fail(msg) { var e = new Error(msg); e.userFacing = true; throw e; }
    function need(obj, keys) { keys.forEach(function (k) { if (str(obj[k]) === '') fail('Missing field: ' + k); }); }
    function money(n) { return '₹' + Math.round(num(n)).toLocaleString('en-IN'); }
    function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function setting(key, fallback) {
      var row = store.all('Settings').filter(function (r) { return r.key === key; })[0];
      return row && str(row.value) !== '' ? str(row.value) : fallback;
    }
    function roleName(r) { return { owner: 'Owner', vp: 'Vice President', admin: 'Admin' }[r] || r; }
    function fundRole(u) { if (FUND_ROLES.indexOf(u.role) < 0) fail('Only the Vice President or the owner can manage the ACRI Abhivyakti Fund.'); }
    function payLine(p) {
      var m = {
        rate_pending: 'The amount will show once ACRI finalises the rate.',
        pending: 'Payable amount: <b>' + money(p.net) + '</b> (pending approval).',
        awaiting_funds: 'Payable amount: <b>' + money(p.net) + '</b>, to be released when funds are available in the ACRI Abhivyakti Fund.',
        pro_bono: 'This was an extra session and the ACRI Abhivyakti Fund has no money available for it, so it is recorded as <b>pro bono</b>. Thank you for supporting ACRI\'s education-first mission.',
        not_payable: 'No remuneration is payable for this session.',
        eligible: 'This session now counts towards your share of the ACRI Abhivyakti Fund. You will get an email each time ACRI works out the share.'
      };
      return m[p.status] || '';
    }
    function audit(actor, action, details) {
      store.insert('AuditLog', { id: deps.uid(), at: iso(), actor: actor, action: action, details: typeof details === 'string' ? details : JSON.stringify(details) });
    }

    // ---------- email ----------
    function wrap(title, bodyHtml) {
      var portal = setting('PORTAL_URL', 'https://hr.acriindia.org.in');
      return '<div style="background:#f2f5f8;padding:24px 10px;font-family:Arial,Helvetica,sans-serif">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden">' +
        '<tr><td style="height:5px;background:#0b5fa5;font-size:0">&nbsp;</td></tr>' +
        '<tr><td style="padding:22px 28px 6px 28px;font-size:12px;color:#0b5fa5;font-weight:bold;letter-spacing:2px;text-transform:uppercase">ACRI HR Portal</td></tr>' +
        '<tr><td style="padding:0 28px 8px 28px;font-size:20px;font-weight:bold;color:#14212b">' + esc(title) + '</td></tr>' +
        '<tr><td style="padding:6px 28px 20px 28px;font-size:14px;line-height:1.6;color:#1a1a1a">' + bodyHtml + '</td></tr>' +
        '<tr><td style="padding:0 28px 24px 28px"><a href="' + esc(portal) + '" style="display:inline-block;background:#0b5fa5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-size:13px;font-weight:bold">Open HR Portal</a></td></tr>' +
        '<tr><td style="background:#14212b;color:#b9c3cc;font-size:11px;padding:14px 28px">Ahmedabad Centre for Research and Innovation · This is an automated email from hr.acriindia.org.in</td></tr>' +
        '</table></div>';
    }
    function send(to, subject, title, bodyHtml) {
      if (!str(to)) return;
      var rec = { id: deps.uid(), at: iso(), to: to, subject: subject, status: 'sent', error: '' };
      try { mail(to, subject, wrap(title, bodyHtml)); }
      catch (err) { rec.status = 'failed'; rec.error = String(err && err.message || err); }
      store.insert('EmailLog', rec);
    }
    function notifyAdmins(subject, title, html) {
      var to = setting('ADMIN_NOTIFY_EMAIL', '');
      if (to) send(to, subject, title, html);
    }

    // ---------- auth ----------
    function newToken(payload) {
      var t = deps.uid() + deps.uid();
      cache.put('tok_' + t, JSON.stringify(payload), TOKEN_TTL);
      return t;
    }
    function who(token) {
      if (!token) fail('Please log in.');
      var raw = cache.get('tok_' + token);
      if (!raw) fail('Your session has expired. Please log in again.');
      return JSON.parse(raw);
    }
    function checkPw(row, password) { return row && row.hash && deps.hash(str(password), row.salt) === row.hash; }
    function setPw(table, id, password) {
      if (str(password).length < 8) fail('Password must be at least 8 characters.');
      var salt = deps.uid();
      store.update(table, id, { salt: salt, hash: deps.hash(str(password), salt) });
    }
    function tempPassword() { return 'ACRI-' + deps.uid().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8); }

    // ---------- fund ----------
    function fundSummary(progId) {
      var entries = store.all('FundEntries').filter(function (e) { return e.programme_id === progId; });
      var received = 0, deducted = 0, heads = {};
      entries.forEach(function (e) {
        if (e.type === 'credit') received += num(e.amount);
        else { deducted += num(e.amount); heads[e.head] = (heads[e.head] || 0) + num(e.amount); }
      });
      var committed = 0, paid = 0;
      store.all('Payments').forEach(function (p) {
        if (p.programme_id !== progId) return;
        if (COMMITTED.indexOf(p.status) >= 0) committed += num(p.net);
        if (p.status === 'paid') paid += num(p.net);
      });
      store.all('Payouts').forEach(function (p) {
        if (p.programme_id !== progId) return;
        if (COMMITTED.indexOf(p.status) >= 0) committed += num(p.amount);
        if (p.status === 'paid') paid += num(p.amount);
      });
      var pool = received - deducted;
      return { tracked: entries.length > 0, received: received, deducted: deducted, byHead: Object.keys(heads).map(function (h) { return { head: h, amount: heads[h] }; }),
        pool: pool, committed: committed, paid: paid, available: pool - committed };
    }

    // ---------- payments ----------
    function sessionRate(prog) {
      var model = str(prog.pay_model) || 'tbd', planned = num(prog.planned_sessions);
      if (model === 'per_session') return num(prog.rate_per_session) || null;
      if (model === 'pool') return planned ? (Math.round(num(prog.pool_per_student) * num(prog.students) / planned) || null) : null;
      if (model === 'fund') { var f = fundSummary(prog.id); return planned && f.pool > 0 ? Math.floor(f.pool / planned) : null; }
      return null; // tbd
    }
    function amounts(prog) {
      var gross = sessionRate(prog);
      if (gross == null) return { gross: '', acri_cut: '', net: '', priced: false };
      var cut = Math.round(gross * num(prog.acri_cut_pct) / 100);
      return { gross: gross, acri_cut: cut, net: gross - cut, priced: true };
    }
    function paymentFor(fid, sid) {
      return store.all('Payments').filter(function (p) { return p.facilitator_id === fid && p.session_id === sid; })[0];
    }
    // Works out the payable status for a present session, checking the fund when it is being tracked.
    // Regular session + no money yet  → awaiting_funds (paid once the fund is topped up).
    // Extra session  + no money       → pro_bono (ACRI is an education-first institution).
    function priceFor(prog, session, excludeId) {
      if (prog.pay_model === 'share') {
        if (bool(session.extra)) return { gross: 0, acri_cut: 0, net: 0, status: 'pro_bono', reason: 'Extra session; conducted pro bono and not counted in the fund share' };
        return { gross: '', acri_cut: '', net: '', status: 'eligible', reason: '' };
      }
      var a = amounts(prog);
      if (!a.priced) return { gross: '', acri_cut: '', net: '', status: 'rate_pending', reason: 'Rate to be finalised by ACRI' };
      var f = fundSummary(prog.id);
      if (f.tracked || prog.pay_model === 'fund') {
        var mine = excludeId ? store.find('Payments', excludeId) : null;
        var available = f.available + (mine && COMMITTED.indexOf(mine.status) >= 0 ? num(mine.net) : 0);
        if (available < a.net) {
          if (bool(session.extra)) return { gross: 0, acri_cut: 0, net: 0, status: 'pro_bono', reason: 'Extra session with no funds available in the ACRI Abhivyakti Fund; conducted pro bono' };
          return { gross: a.gross, acri_cut: a.acri_cut, net: a.net, status: 'awaiting_funds', reason: 'Awaiting funds in the ACRI Abhivyakti Fund' };
        }
      }
      return { gross: a.gross, acri_cut: a.acri_cut, net: a.net, status: 'pending', reason: '' };
    }
    // Keeps the payment row in line with the attendance result.
    function syncPayment(fid, session, attStatus) {
      var prog = store.find('Programmes', session.programme_id) || {};
      var existing = paymentFor(fid, session.id);
      if (existing && (existing.status === 'paid' || existing.status === 'approved')) return existing; // never silently undo
      var patch;
      if (attStatus === 'present') patch = priceFor(prog, session, existing && existing.id);
      else patch = { gross: 0, acri_cut: 0, net: 0, status: 'not_payable', reason: attStatus === 'absent' ? 'Session not attended' : 'Attendance not verified' };
      patch.updated_at = iso();
      if (existing) { store.update('Payments', existing.id, patch); return store.find('Payments', existing.id); }
      var row = Object.assign({ id: deps.uid(), facilitator_id: fid, session_id: session.id, programme_id: session.programme_id, paid_ref: '', paid_on: '' }, patch);
      store.insert('Payments', row);
      return row;
    }
    // Re-prices open payments in session-date order, so earlier sessions get funds first.
    function recalc(progId) {
      var prog = store.find('Programmes', progId); if (!prog) return 0;
      var open = ['rate_pending', 'pending', 'awaiting_funds', 'eligible'];
      var sessions = store.all('Sessions');
      function sess(id) { return sessions.filter(function (x) { return x.id === id; })[0] || {}; }
      var rows = store.all('Payments').filter(function (p) { return p.programme_id === progId && open.indexOf(p.status) >= 0; })
        .sort(function (a, b) { return str(sess(a.session_id).date) < str(sess(b.session_id).date) ? -1 : 1; });
      // Release them first so their money counts as available again.
      rows.forEach(function (p) { store.update('Payments', p.id, { status: 'rate_pending' }); });
      rows.forEach(function (p) {
        var patch = priceFor(prog, sess(p.session_id), null);
        patch.updated_at = iso();
        store.update('Payments', p.id, patch);
      });
      return rows.length;
    }

    // ---------- fund share ----------
    // Facilitator pool = money received − ACRI deductions.
    // Each facilitator's part = pool × their share % × (sessions attended ÷ sessions held so far).
    // Missed sessions lower the part; the money not paid out stays in the fund for ACRI to decide on later.
    // Extra sessions are pro bono and are not counted either way.
    function shareCalc(prog) {
      var f = fundSummary(prog.id);
      var assigns = store.all('Assignments').filter(function (a) { return a.programme_id === prog.id && a.status !== 'ended'; });
      var setPct = assigns.filter(function (a) { return str(a.share_pct) !== ''; }).reduce(function (t, a) { return t + num(a.share_pct); }, 0);
      var unset = assigns.filter(function (a) { return str(a.share_pct) === ''; }).length;
      var held = store.all('Sessions').filter(function (x) { return x.programme_id === prog.id && x.status !== 'cancelled' && !bool(x.extra) && str(x.date) <= today(); });
      var heldIds = held.map(function (x) { return x.id; });
      var att = store.all('Attendance');
      var facs = store.all('Facilitators');
      var lines = assigns.map(function (a) {
        var pct = str(a.share_pct) !== '' ? num(a.share_pct) : (unset ? Math.max(0, 100 - setPct) / unset : 0);
        var attended = att.filter(function (x) { return x.facilitator_id === a.facilitator_id && x.status === 'present' && heldIds.indexOf(x.session_id) >= 0; }).length;
        var ratio = held.length ? attended / held.length : 0;
        var full = Math.floor(f.pool * pct / 100);
        var entitlement = Math.floor(full * ratio);
        var already = store.all('Payouts').filter(function (o) { return o.programme_id === prog.id && o.facilitator_id === a.facilitator_id && PAYOUT_COUNTED.indexOf(o.status) >= 0; })
          .reduce(function (t, o) { return t + num(o.amount); }, 0);
        var fac = facs.filter(function (x) { return x.id === a.facilitator_id; })[0] || {};
        return { facilitator_id: a.facilitator_id, name: fac.name, share_pct: Math.round(pct * 100) / 100, held: held.length, attended: attended, missed: held.length - attended,
          full: full, absence_cut: full - entitlement, entitlement: entitlement, previous: already, due: Math.max(0, entitlement - already) };
      });
      return { pool: f.pool, held: held.length, lines: lines, totalPct: lines.reduce(function (t, l) { return t + l.share_pct; }, 0) };
    }

    // ---------- views ----------
    function publicFac(f) { return { id: f.id, name: f.name, email: f.email, phone: f.phone, status: f.status, appointment_ref: f.appointment_ref, appointed_on: f.appointed_on, must_change: bool(f.must_change) }; }
    function publicProg(p) { var a = amounts(p); return { share: p.pay_model === 'share' ? shareCalc(p) : null, fund: fundSummary(p.id), id: p.id, name: p.name, school: p.school, students: num(p.students), pay_model: p.pay_model || 'tbd', rate_per_session: num(p.rate_per_session), pool_per_student: num(p.pool_per_student), planned_sessions: num(p.planned_sessions), acri_cut_pct: num(p.acri_cut_pct), status: p.status, session_gross: a.priced ? a.gross : null, session_net: a.priced ? a.net : null }; }

    function facilitatorView(fid) {
      var f = store.find('Facilitators', fid);
      if (!f || f.status !== 'active') fail('Your account is not active. Please contact ACRI.');
      var progIds = store.all('Assignments').filter(function (a) { return a.facilitator_id === fid && a.status !== 'ended'; }).map(function (a) { return a.programme_id; });
      var showFund = setting('SHOW_FUND_TO_FACILITATORS', 'TRUE').toUpperCase() !== 'FALSE';
      var programmes = store.all('Programmes').filter(function (p) { return progIds.indexOf(p.id) >= 0; }).map(publicProg)
        .map(function (p) { if (p.share) p.share = { pool: p.share.pool, held: p.share.held, mine: p.share.lines.filter(function (l) { return l.facilitator_id === fid; })[0] || null };
          if (!showFund) delete p.fund; else p.fund = { tracked: p.fund.tracked, received: p.fund.received, deducted: p.fund.deducted, byHead: p.fund.byHead, pool: p.fund.pool }; return p; });
      var att = store.all('Attendance').filter(function (a) { return a.facilitator_id === fid; });
      var pays = store.all('Payments').filter(function (p) { return p.facilitator_id === fid; });
      var sessions = store.all('Sessions').filter(function (s) { return progIds.indexOf(s.programme_id) >= 0; })
        .sort(function (a, b) { return str(a.date) < str(b.date) ? -1 : 1; })
        .map(function (s) {
          var a = att.filter(function (x) { return x.session_id === s.id; })[0];
          var p = pays.filter(function (x) { return x.session_id === s.id; })[0];
          return { id: s.id, programme_id: s.programme_id, number: s.number, date: s.date, group: s.group, mode: s.mode, topic: s.topic, status: s.status, extra: bool(s.extra),
            attendance: a ? { status: a.status, remarks: a.remarks, claim_note: a.claim_note } : null,
            payment: p ? { id: p.id, gross: p.gross, acri_cut: p.acri_cut, net: p.net, status: p.status, reason: p.reason, paid_ref: p.paid_ref, paid_on: p.paid_on } : null };
        });
      var totals = { paid: 0, approved: 0, pending: 0, present: 0, absent: 0, proBono: 0 };
      sessions.forEach(function (s) {
        if (s.attendance && s.attendance.status === 'present') totals.present++;
        if (s.attendance && s.attendance.status === 'absent') totals.absent++;
        if (s.payment && s.payment.status === 'paid') totals.paid += num(s.payment.net);
        if (s.payment && s.payment.status === 'approved') totals.approved += num(s.payment.net);
        if (s.payment && (s.payment.status === 'pending' || s.payment.status === 'awaiting_funds')) totals.pending += num(s.payment.net);
        if (s.payment && s.payment.status === 'pro_bono') totals.proBono++;
      });
      var payouts = store.all('Payouts').filter(function (o) { return o.facilitator_id === fid; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      payouts.forEach(function (o) {
        if (o.status === 'paid') totals.paid += num(o.amount);
        if (o.status === 'approved') totals.approved += num(o.amount);
        if (o.status === 'pending') totals.pending += num(o.amount);
      });
      var queries = store.all('Queries').filter(function (q) { return q.facilitator_id === fid; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      return { me: publicFac(f), programmes: programmes, sessions: sessions, totals: totals, payouts: payouts, queries: queries };
    }

    function adminView(u) {
      u = u || {};
      var facs = store.all('Facilitators'), progs = store.all('Programmes'), sess = store.all('Sessions');
      var att = store.all('Attendance'), pays = store.all('Payments'), qs = store.all('Queries');
      function nameOf(id) { var f = facs.filter(function (x) { return x.id === id; })[0]; return f ? f.name : id; }
      function sessOf(id) { return sess.filter(function (x) { return x.id === id; })[0] || {}; }
      return {
        me: (function () { var a = store.find('Admins', u.id) || {}; return { name: a.name, email: a.email, role: a.role, canFund: FUND_ROLES.indexOf(a.role) >= 0, isOwner: a.role === 'owner' }; })(),
        admins: store.all('Admins').map(function (a) { return { id: a.id, name: a.name, email: a.email, role: a.role, active: a.active }; }),
        fundEntries: store.all('FundEntries').sort(function (a, b) { return a.date < b.date ? 1 : -1; }),
        deductionHeads: store.all('DeductionHeads'),
        settings: store.all('Settings'),
        facilitators: facs.map(publicFac),
        programmes: progs.map(publicProg),
        assignments: store.all('Assignments'),
        sessions: sess.slice().sort(function (a, b) { return str(a.date) < str(b.date) ? -1 : 1; }),
        attendance: att.map(function (a) { var s = sessOf(a.session_id); return Object.assign({}, a, { facilitator: nameOf(a.facilitator_id), date: s.date, number: s.number }); }),
        payments: pays.map(function (p) { var s = sessOf(p.session_id); return Object.assign({}, p, { facilitator: nameOf(p.facilitator_id), date: s.date, number: s.number }); }),
        payouts: store.all('Payouts').map(function (o) { return Object.assign({}, o, { facilitator: nameOf(o.facilitator_id) }); }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }),
        queries: qs.map(function (q) { return Object.assign({}, q, { facilitator: nameOf(q.facilitator_id) }); }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }),
        emails: store.all('EmailLog').slice(-50).reverse(),
        counts: {
          claims: att.filter(function (a) { return a.status === 'claimed'; }).length,
          pendingPay: pays.filter(function (p) { return p.status === 'pending'; }).length + store.all('Payouts').filter(function (o) { return o.status === 'pending'; }).length,
          awaitingFunds: pays.filter(function (p) { return p.status === 'awaiting_funds'; }).length,
          openQueries: qs.filter(function (q) { return q.status === 'open'; }).length
        }
      };
    }

    // ---------- actions ----------
    var facActions = {
      dashboard: function (u) { return facilitatorView(u.id); },

      claimAttendance: function (u, b) {
        need(b, ['session_id']);
        var s = store.find('Sessions', b.session_id);
        if (!s) fail('Session not found.');
        var assigned = store.all('Assignments').some(function (a) { return a.facilitator_id === u.id && a.programme_id === s.programme_id && a.status !== 'ended'; });
        if (!assigned) fail('You are not assigned to this programme.');
        if (str(s.date) > today()) fail('You can submit attendance only on or after the session date.');
        var existing = store.all('Attendance').filter(function (a) { return a.session_id === s.id && a.facilitator_id === u.id; })[0];
        if (existing && existing.status !== 'rejected') fail('Attendance for this session is already ' + existing.status + '.');
        var row = { session_id: s.id, facilitator_id: u.id, status: 'claimed', claim_note: str(b.note).slice(0, 500), claimed_at: iso(), verified_by: '', verified_at: '', remarks: '' };
        if (existing) store.update('Attendance', existing.id, row); else { row.id = deps.uid(); store.insert('Attendance', row); }
        var f = store.find('Facilitators', u.id);
        notifyAdmins('Attendance submitted: ' + f.name + ' · ' + s.date, 'Attendance to verify',
          '<b>' + esc(f.name) + '</b> submitted attendance for Session ' + esc(s.number) + ' on ' + esc(s.date) + '.' + (row.claim_note ? '<br>Note: ' + esc(row.claim_note) : ''));
        audit(u.email, 'claimAttendance', { session: s.id });
        return facilitatorView(u.id);
      },

      raiseQuery: function (u, b) {
        need(b, ['subject', 'message']);
        var q = { id: deps.uid(), facilitator_id: u.id, subject: str(b.subject).slice(0, 150), message: str(b.message).slice(0, 2000), status: 'open', response: '', created_at: iso(), updated_at: iso() };
        store.insert('Queries', q);
        var f = store.find('Facilitators', u.id);
        notifyAdmins('New query from ' + f.name + ': ' + q.subject, 'New facilitator query', '<b>' + esc(f.name) + '</b> asked:<br><b>' + esc(q.subject) + '</b><br>' + esc(q.message));
        send(f.email, 'We received your query: ' + q.subject, 'Query received', 'Hi ' + esc(f.name) + ',<br>ACRI has received your query <b>“' + esc(q.subject) + '”</b>. You will get an email when we respond.');
        return facilitatorView(u.id);
      },

      changePassword: function (u, b) {
        need(b, ['current', 'next']);
        var f = store.find('Facilitators', u.id);
        if (!checkPw(f, b.current)) fail('Your current password is incorrect.');
        setPw('Facilitators', u.id, b.next);
        store.update('Facilitators', u.id, { must_change: 'FALSE' });
        audit(u.email, 'changePassword', '');
        return facilitatorView(u.id);
      }
    };

    var adminActions = {
      dashboard: function (u) { return adminView(u); },

      saveSettings: function (u, b) {
        (b.settings || []).forEach(function (kv) {
          var row = store.all('Settings').filter(function (r) { return r.key === kv.key; })[0];
          if (row) store.update('Settings', row.key, { value: str(kv.value) }); else store.insert('Settings', { key: str(kv.key), value: str(kv.value) });
        });
        audit(u.email, 'saveSettings', b.settings);
        return adminView(u);
      },

      saveFacilitator: function (u, b) {
        need(b, ['name', 'email']);
        var email = lower(b.email);
        var clash = store.all('Facilitators').filter(function (f) { return lower(f.email) === email && f.id !== b.id; })[0];
        if (clash) fail('Another facilitator already uses this email.');
        var data = { name: str(b.name), email: email, phone: str(b.phone), appointment_ref: str(b.appointment_ref), appointed_on: str(b.appointed_on) };
        var fid = b.id;
        if (fid) {
          store.update('Facilitators', fid, data);
        } else {
          fid = deps.uid();
          var pw = tempPassword(), salt = deps.uid();
          store.insert('Facilitators', Object.assign({ id: fid, salt: salt, hash: deps.hash(pw, salt), status: 'active', must_change: 'TRUE', created_at: iso() }, data));
          if (b.send_welcome !== false) {
            send(email, 'Your ACRI HR Portal account', 'Welcome to the ACRI HR Portal',
              'Hi ' + esc(data.name) + ',<br>Your facilitator account is ready. Use the details below to log in, then set your own password.' +
              '<br><br>Email: <b>' + esc(email) + '</b><br>Temporary password: <b>' + esc(pw) + '</b>' +
              '<br><br>On the portal you can view your sessions, submit attendance, track payments and raise queries.');
          }
        }
        if (b.programme_id) {
          var has = store.all('Assignments').some(function (a) { return a.facilitator_id === fid && a.programme_id === b.programme_id && a.status !== 'ended'; });
          if (!has) store.insert('Assignments', { id: deps.uid(), programme_id: b.programme_id, facilitator_id: fid, role: 'Facilitator', from_date: str(b.appointed_on) || today(), status: 'active' });
        }
        audit(u.email, 'saveFacilitator', { id: fid });
        return adminView(u);
      },

      setFacilitatorStatus: function (u, b) {
        need(b, ['id', 'status']);
        if (['active', 'inactive'].indexOf(b.status) < 0) fail('Status must be active or inactive.');
        store.update('Facilitators', b.id, { status: b.status });
        audit(u.email, 'setFacilitatorStatus', b);
        return adminView(u);
      },

      resetFacilitatorPassword: function (u, b) {
        need(b, ['id']);
        var f = store.find('Facilitators', b.id); if (!f) fail('Facilitator not found.');
        var pw = tempPassword();
        setPw('Facilitators', f.id, pw);
        store.update('Facilitators', f.id, { must_change: 'TRUE' });
        send(f.email, 'Your ACRI HR Portal password was reset', 'Password reset', 'Hi ' + esc(f.name) + ',<br>Your temporary password is <b>' + esc(pw) + '</b>. Please log in and set a new password.');
        audit(u.email, 'resetFacilitatorPassword', { id: f.id });
        return adminView(u);
      },

      saveProgramme: function (u, b) {
        need(b, ['name']);
        if (b.pay_model && PAY_MODELS.indexOf(b.pay_model) < 0) fail('Unknown payment model.');
        var cut = num(b.acri_cut_pct); if (cut < 0 || cut > 100) fail('ACRI cut must be between 0 and 100%.');
        var data = { name: str(b.name), school: str(b.school), students: num(b.students), pay_model: b.pay_model || 'tbd', rate_per_session: num(b.rate_per_session), pool_per_student: num(b.pool_per_student), planned_sessions: num(b.planned_sessions), acri_cut_pct: cut, status: b.status || 'active' };
        var id = b.id;
        if (id) store.update('Programmes', id, data); else { id = deps.uid(); store.insert('Programmes', Object.assign({ id: id, created_at: iso() }, data)); }
        audit(u.email, 'saveProgramme', { id: id });
        if (b.recalculate) return adminActions.recalculatePayments(u, { programme_id: id });
        return adminView(u);
      },

      saveSession: function (u, b) {
        need(b, ['programme_id', 'date']);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str(b.date))) fail('Date must be YYYY-MM-DD.');
        var data = { programme_id: b.programme_id, number: str(b.number), date: str(b.date), group: str(b.group), mode: b.mode === 'offline' ? 'offline' : 'online', topic: str(b.topic), status: ['scheduled', 'held', 'cancelled'].indexOf(b.status) >= 0 ? b.status : 'scheduled', extra: b.extra === true || b.extra === 'TRUE' ? 'TRUE' : 'FALSE' };
        var id = b.id;
        if (id) store.update('Sessions', id, data); else { id = deps.uid(); store.insert('Sessions', Object.assign({ id: id }, data)); }
        audit(u.email, 'saveSession', { id: id });
        return adminView(u);
      },

      // Admin records or overrides attendance directly (present / absent).
      markAttendance: function (u, b) {
        need(b, ['session_id', 'facilitator_id', 'status']);
        if (['present', 'absent'].indexOf(b.status) < 0) fail('Status must be present or absent.');
        var s = store.find('Sessions', b.session_id); if (!s) fail('Session not found.');
        var f = store.find('Facilitators', b.facilitator_id); if (!f) fail('Facilitator not found.');
        var existing = store.all('Attendance').filter(function (a) { return a.session_id === s.id && a.facilitator_id === f.id; })[0];
        var patch = { status: b.status, verified_by: u.email, verified_at: iso(), remarks: str(b.remarks) };
        if (existing) store.update('Attendance', existing.id, patch);
        else store.insert('Attendance', Object.assign({ id: deps.uid(), session_id: s.id, facilitator_id: f.id, claim_note: '', claimed_at: '' }, patch));
        var p = syncPayment(f.id, s, b.status);
        if (b.notify !== false) {
          send(f.email, 'Attendance recorded: Session ' + s.number + ' (' + s.date + ')', 'Attendance recorded',
            'Hi ' + esc(f.name) + ',<br>Your attendance for Session ' + esc(s.number) + ' on ' + esc(s.date) + ' has been recorded as <b>' + esc(b.status) + '</b>.' +
            '<br>' + payLine(p) +
            (patch.remarks ? '<br>Remarks: ' + esc(patch.remarks) : ''));
        }
        audit(u.email, 'markAttendance', b);
        return adminView(u);
      },

      // Admin verifies a facilitator's own submission.
      verifyClaim: function (u, b) {
        need(b, ['attendance_id', 'decision']);
        var a = store.find('Attendance', b.attendance_id); if (!a) fail('Attendance record not found.');
        if (a.status !== 'claimed') fail('This attendance is already ' + a.status + '.');
        var map = { approve: 'present', absent: 'absent', reject: 'rejected' };
        var status = map[b.decision]; if (!status) fail('Decision must be approve, absent or reject.');
        if (status === 'rejected' && !str(b.remarks)) fail('Please give a reason for rejecting.');
        store.update('Attendance', a.id, { status: status, verified_by: u.email, verified_at: iso(), remarks: str(b.remarks) });
        var s = store.find('Sessions', a.session_id), f = store.find('Facilitators', a.facilitator_id);
        var p = syncPayment(f.id, s, status);
        var line = status === 'present' ? 'verified as <b>present</b>. ' + payLine(p) :
          status === 'absent' ? 'recorded as <b>absent</b>. ' + payLine(p) :
          '<b>rejected</b> because of a discrepancy. No payment will be made unless it is resolved.';
        send(f.email, 'Attendance ' + (status === 'present' ? 'verified' : status) + ': Session ' + s.number + ' (' + s.date + ')', 'Attendance update',
          'Hi ' + esc(f.name) + ',<br>Your attendance for Session ' + esc(s.number) + ' on ' + esc(s.date) + ' was ' + line + (str(b.remarks) ? '<br>Remarks: ' + esc(b.remarks) : ''));
        audit(u.email, 'verifyClaim', b);
        return adminView(u);
      },

      setPaymentStatus: function (u, b) {
        need(b, ['payment_id', 'status']);
        if (PAY_SET.indexOf(b.status) < 0) fail('Unknown payment status.');
        var p = store.find('Payments', b.payment_id); if (!p) fail('Payment not found.');
        if (p.status === 'not_payable') fail('This session is not payable.');
        if (p.status === 'rate_pending' && ['rejected', 'withheld', 'pro_bono'].indexOf(b.status) < 0) fail('Set the programme rate first, then recalculate.');
        if (p.status === 'awaiting_funds' && ['approved', 'paid'].indexOf(b.status) >= 0) fail('There are not enough funds in the ACRI Abhivyakti Fund for this payment yet.');
        if ((b.status === 'rejected' || b.status === 'withheld') && !str(b.reason)) fail('Please give a reason.');
        if (b.status === 'paid' && !str(b.paid_ref)) fail('Enter the payment reference (UTR).');
        var patch = { status: b.status, reason: str(b.reason), updated_at: iso() };
        if (b.status === 'paid') { patch.paid_ref = str(b.paid_ref); patch.paid_on = str(b.paid_on) || today(); }
        if (b.status === 'pro_bono') { patch.gross = 0; patch.acri_cut = 0; patch.net = 0; patch.reason = str(b.reason) || 'Conducted pro bono'; }
        store.update('Payments', p.id, patch);
        var f = store.find('Facilitators', p.facilitator_id), s = store.find('Sessions', p.session_id) || {};
        var words = { pending: 'moved back to pending', approved: 'approved', withheld: 'withheld', rejected: 'rejected', paid: 'paid', pro_bono: 'recorded as pro bono' };
        send(f.email, 'Payment ' + words[b.status] + ': Session ' + s.number + ' (' + s.date + ')', 'Payment update',
          'Hi ' + esc(f.name) + ',<br>' + (b.status === 'pro_bono' ? 'Session ' + esc(s.number) + ' on ' + esc(s.date) + ' has been <b>recorded as pro bono</b>, as there are no funds for it in the ACRI Abhivyakti Fund. Thank you for supporting ACRI\'s education-first mission.' :
            'Your payment of <b>' + money(p.net) + '</b> for Session ' + esc(s.number) + ' on ' + esc(s.date) + ' has been <b>' + words[b.status] + '</b>.') +
          (patch.reason ? '<br>Reason: ' + esc(patch.reason) : '') + (b.status === 'paid' ? '<br>Reference: ' + esc(patch.paid_ref) : ''));
        audit(u.email, 'setPaymentStatus', b);
        return adminView(u);
      },

      recalculatePayments: function (u, b) {
        need(b, ['programme_id']);
        if (!store.find('Programmes', b.programme_id)) fail('Programme not found.');
        var changed = recalc(b.programme_id);
        audit(u.email, 'recalculatePayments', { programme: b.programme_id, changed: changed });
        return adminView(u);
      },

      // ---- fund share payouts ----
      previewDistribution: function (u, b) {
        need(b, ['programme_id']);
        var prog = store.find('Programmes', b.programme_id); if (!prog) fail('Programme not found.');
        var view = adminView(u); view.preview = shareCalc(prog); return view;
      },

      setShare: function (u, b) {
        fundRole(u);
        need(b, ['programme_id', 'facilitator_id']);
        var a = store.all('Assignments').filter(function (x) { return x.programme_id === b.programme_id && x.facilitator_id === b.facilitator_id && x.status !== 'ended'; })[0];
        if (!a) fail('This facilitator is not assigned to the programme.');
        var v = str(b.share_pct);
        if (v !== '' && (num(v) < 0 || num(v) > 100)) fail('Share must be between 0 and 100%.');
        store.update('Assignments', a.id, { share_pct: v });
        audit(u.email, 'setShare', b);
        return adminView(u);
      },

      distributeFund: function (u, b) {
        fundRole(u);
        need(b, ['programme_id']);
        var prog = store.find('Programmes', b.programme_id); if (!prog) fail('Programme not found.');
        if (prog.pay_model !== 'share') fail('Set the payment model to "Lump sum split between facilitators" first.');
        var sc = shareCalc(prog);
        if (sc.pool <= 0) fail('There is nothing for facilitators yet. Record the money received and ACRI\'s deductions first.');
        if (sc.totalPct > 100.01) fail('Facilitator shares add up to more than 100%. Fix them first.');
        var made = 0;
        sc.lines.forEach(function (l) {
          if (l.due <= 0) return;
          var basis = 'Pool ' + money(sc.pool) + ' × ' + l.share_pct + '% × ' + l.attended + '/' + l.held + ' sessions attended';
          store.insert('Payouts', { id: deps.uid(), programme_id: prog.id, facilitator_id: l.facilitator_id, created_at: iso(), sessions: l.attended + '/' + l.held, per_session: '', entitlement: l.entitlement, previous: l.previous, amount: l.due, basis: basis, status: 'pending', reason: '', paid_ref: '', paid_on: '', updated_at: iso() });
          made++;
          var f = store.find('Facilitators', l.facilitator_id);
          send(f.email, 'Your share from the ACRI Abhivyakti Fund: ' + money(l.due), 'Your share from the ACRI Abhivyakti Fund',
            'Hi ' + esc(f.name) + ',<br>ACRI has worked out your share for ' + esc(prog.name) + '.<br><br>' +
            'Amount available for facilitators (after ACRI deductions): <b>' + money(sc.pool) + '</b><br>' +
            'Your share: <b>' + l.share_pct + '%</b> = ' + money(l.full) + '<br>' +
            'Sessions attended: <b>' + l.attended + ' of ' + l.held + '</b>' + (l.missed ? ' (' + l.missed + ' missed, ' + money(l.absence_cut) + ' less)' : '') + '<br>' +
            'Your share so far: <b>' + money(l.entitlement) + '</b><br>Already paid or in process: ' + money(l.previous) + '<br>' +
            'This payment: <b>' + money(l.due) + '</b> (pending approval)');
        });
        audit(u.email, 'distributeFund', { programme: prog.id, pool: sc.pool, payouts: made });
        if (!made) fail('Nothing new to pay. Everyone has already received their share of the current fund.');
        return adminView(u);
      },

      setPayoutStatus: function (u, b) {
        need(b, ['payout_id', 'status']);
        if (['pending', 'approved', 'withheld', 'rejected', 'paid'].indexOf(b.status) < 0) fail('Unknown status.');
        var o = store.find('Payouts', b.payout_id); if (!o) fail('Payment not found.');
        if (o.status === 'paid') fail('This payment is already paid.');
        if ((b.status === 'rejected' || b.status === 'withheld') && !str(b.reason)) fail('Please give a reason.');
        if (b.status === 'paid' && !str(b.paid_ref)) fail('Enter the payment reference (UTR).');
        var patch = { status: b.status, reason: str(b.reason), updated_at: iso() };
        if (b.status === 'paid') { patch.paid_ref = str(b.paid_ref); patch.paid_on = str(b.paid_on) || today(); }
        store.update('Payouts', o.id, patch);
        var f = store.find('Facilitators', o.facilitator_id);
        var words = { pending: 'moved back to pending', approved: 'approved', withheld: 'withheld', rejected: 'rejected', paid: 'paid' };
        send(f.email, 'Payment ' + words[b.status] + ': ' + money(o.amount), 'Payment update',
          'Hi ' + esc(f.name) + ',<br>Your payment of <b>' + money(o.amount) + '</b> from the ACRI Abhivyakti Fund (' + esc(o.sessions) + ' verified sessions) has been <b>' + words[b.status] + '</b>.' +
          (patch.reason ? '<br>Reason: ' + esc(patch.reason) : '') + (b.status === 'paid' ? '<br>Reference: ' + esc(patch.paid_ref) : ''));
        audit(u.email, 'setPayoutStatus', b);
        return adminView(u);
      },

      // ---- ACRI Abhivyakti Fund (Vice President / owner only) ----
      addFundEntry: function (u, b) {
        fundRole(u);
        need(b, ['programme_id', 'type', 'amount', 'date']);
        if (['credit', 'deduction'].indexOf(b.type) < 0) fail('Type must be credit or deduction.');
        var amt = num(b.amount); if (amt <= 0) fail('Amount must be more than zero.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str(b.date))) fail('Date must be YYYY-MM-DD.');
        if (b.type === 'deduction') {
          need(b, ['head']);
          var head = store.all('DeductionHeads').filter(function (h) { return h.name === b.head && bool(h.active); })[0];
          if (!head) fail('Choose an active deduction head.');
        }
        // Fund entries are final: there is no edit or delete. A mistake is corrected with a new entry.
        store.insert('FundEntries', { id: deps.uid(), programme_id: b.programme_id, date: str(b.date), type: b.type, head: b.type === 'credit' ? (str(b.head) || 'Fees received') : b.head, amount: amt, note: str(b.note).slice(0, 300), recorded_by: u.email, created_at: iso() });
        recalc(b.programme_id); // money in or out changes what is payable
        audit(u.email, 'addFundEntry', b);
        return adminView(u);
      },

      saveDeductionHead: function (u, b) {
        fundRole(u);
        need(b, ['name']);
        var clash = store.all('DeductionHeads').filter(function (h) { return lower(h.name) === lower(b.name) && h.id !== b.id; })[0];
        if (clash) fail('A head with this name already exists.');
        var data = { name: str(b.name), description: str(b.description), active: b.active === false || b.active === 'FALSE' ? 'FALSE' : 'TRUE' };
        if (b.id) store.update('DeductionHeads', b.id, data); else store.insert('DeductionHeads', Object.assign({ id: deps.uid() }, data));
        audit(u.email, 'saveDeductionHead', data);
        return adminView(u);
      },

      // ---- admins (owner only) ----
      saveAdmin: function (u, b) {
        if (u.role !== 'owner') fail('Only the portal owner can manage admins.');
        need(b, ['name', 'email', 'role']);
        if (['owner', 'vp', 'admin'].indexOf(b.role) < 0) fail('Role must be owner, vp or admin.');
        var email = lower(b.email);
        var ex = store.all('Admins').filter(function (a) { return lower(a.email) === email; })[0];
        if (ex) { store.update('Admins', ex.id, { name: str(b.name), role: b.role, active: b.active === false ? 'FALSE' : 'TRUE' }); }
        else {
          var pw = tempPassword(), salt = deps.uid();
          store.insert('Admins', { id: deps.uid(), email: email, name: str(b.name), role: b.role, salt: salt, hash: deps.hash(pw, salt), active: 'TRUE', created_at: iso() });
          send(email, 'Your ACRI HR Portal admin account', 'Admin access to the ACRI HR Portal',
            'Hi ' + esc(b.name) + ',<br>You have been given <b>' + esc(roleName(b.role)) + '</b> access to the ACRI HR Portal admin console.<br><br>Email: <b>' + esc(email) + '</b><br>Temporary password: <b>' + esc(pw) + '</b><br><br>Please log in at /admin and change your password.');
        }
        audit(u.email, 'saveAdmin', { email: email, role: b.role });
        return adminView(u);
      },

      // ---- send an email by hand ----
      sendEmail: function (u, b) {
        need(b, ['to', 'subject', 'message']);
        var list = b.to === 'all' ? store.all('Facilitators').filter(function (f) { return f.status === 'active'; }) : [store.find('Facilitators', b.to)].filter(Boolean);
        if (!list.length) fail('No recipients found.');
        list.forEach(function (f) {
          send(f.email, str(b.subject), str(b.subject), 'Hi ' + esc(f.name) + ',<br>' + esc(b.message).replace(/\n/g, '<br>'));
        });
        audit(u.email, 'sendEmail', { to: b.to, subject: b.subject, count: list.length });
        return adminView(u);
      },

      answerQuery: function (u, b) {
        need(b, ['query_id', 'response']);
        var q = store.find('Queries', b.query_id); if (!q) fail('Query not found.');
        store.update('Queries', q.id, { response: str(b.response), status: b.close ? 'closed' : 'answered', updated_at: iso() });
        var f = store.find('Facilitators', q.facilitator_id);
        send(f.email, 'Response to your query: ' + q.subject, 'ACRI has responded', 'Hi ' + esc(f.name) + ',<br>On your query <b>“' + esc(q.subject) + '”</b>, ACRI says:<br><br>' + esc(b.response).replace(/\n/g, '<br>'));
        audit(u.email, 'answerQuery', { id: q.id });
        return adminView(u);
      },

      changePassword: function (u, b) {
        need(b, ['current', 'next']);
        var a = store.find('Admins', u.id);
        if (!checkPw(a, b.current)) fail('Your current password is incorrect.');
        setPw('Admins', u.id, b.next);
        return adminView(u);
      }
    };

    function handle(req) {
      try {
        var b = req || {};
        var action = str(b.action);
        if (action === 'login') {
          need(b, ['email', 'password']);
          var role = b.role === 'admin' ? 'admin' : 'facilitator';
          var table = role === 'admin' ? 'Admins' : 'Facilitators';
          var row = store.all(table).filter(function (r) { return lower(r.email) === lower(b.email); })[0];
          if (!checkPw(row, b.password)) fail('Incorrect email or password.');
          if (role === 'admin' && !bool(row.active)) fail('This admin account is disabled.');
          if (role === 'facilitator' && row.status !== 'active') fail('Your account is not active. Please contact ACRI.');
          var token = newToken({ role: role === 'admin' ? (row.role || 'admin') : 'facilitator', kind: role, id: row.id, email: row.email });
          audit(row.email, 'login', role);
          return { ok: true, token: token, role: role, data: role === 'admin' ? adminView({ id: row.id, role: row.role || 'admin', email: row.email }) : facilitatorView(row.id) };
        }
        if (action === 'logout') { if (b.token) cache.remove('tok_' + b.token); return { ok: true }; }
        var u = who(b.token);
        var table2 = (u.kind || (u.role === 'facilitator' ? 'facilitator' : 'admin')) === 'admin' ? adminActions : facActions;
        var fn = table2[action];
        if (!fn) fail('Unknown action.');
        var data = deps.withLock ? deps.withLock(function () { return fn(u, b); }) : fn(u, b);
        return { ok: true, data: data };
      } catch (err) {
        if (err && err.userFacing) return { ok: false, error: err.message };
        if (deps.log) deps.log(err);
        return { ok: false, error: 'Something went wrong. Please try again.' };
      }
    }

    return { handle: handle, amounts: amounts, syncPayment: syncPayment, audit: audit };
  }

  return { create: create, SCHEMA: SCHEMA };
})();

if (typeof module !== 'undefined') module.exports = HRCore;
