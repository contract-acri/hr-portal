/**
 * ACRI HR Portal — Apps Script backend (hr.acriindia.org.in)
 *
 * Files in the Apps Script project:
 *   Core.gs  ← paste backend/Core.js
 *   Code.gs  ← paste this file
 *
 * Emails and names are set in CONFIG below. Zoho Mail is connected by pasting three values into
 * ZOHO_SETUP and running connectZoho() once; it saves the Script Properties it needs by itself.
 * Optional: SHEET_ID (not needed when Apps Script is opened from the Sheet), ADMIN_PASSWORD.
 */

var PROPS = PropertiesService.getScriptProperties();
var ABHIVYAKTI_GROUPS = ['Group 1 (Grades 9–12)', 'Group 2 (Grades 6–8)', 'Group 3 (Grades 3–5)'];

// ---------------- ACRI settings (edit here) ----------------
// Script properties with the same name override these, but nothing has to be set there.
var CONFIG = {
  ADMIN_EMAIL: 'president@acriindia.org',
  ADMIN_NAME: 'Fenil Pritesh Shah',
  VP_EMAIL: 'vice-president@acriindia.org',
  VP_NAME: 'Prashant Pareek',
  YASHVI_EMAIL: 'yashvi.mehta07@gmail.com',
  ADMIN_NOTIFY_EMAIL: 'president@acriindia.org',   // gets new attendance submissions and queries
  PORTAL_URL: 'https://hr.acriindia.org.in',
  ZOHO_FROM_ADDRESS: 'contact@acriindia.org',      // Zoho mailbox that sends the portal's emails
  ZOHO_ACCOUNTS_HOST: 'accounts.zoho.in',
  ZOHO_MAIL_HOST: 'mail.zoho.in'
};
function cfg_(key) {
  var v = PROPS.getProperty(key);
  return v != null && String(v).trim() !== '' ? String(v).trim() : (CONFIG[key] || '');
}

// ---------------- Sheet store ----------------
// Uses SHEET_ID if it is set; otherwise the Google Sheet this script is attached to.
function openSheet_() {
  var id = String(PROPS.getProperty('SHEET_ID') || '').trim();
  if (id) {
    var m = id.match(/\/d\/([a-zA-Z0-9-_]+)/); // accepts a full Sheet URL too
    return SpreadsheetApp.openById(m ? m[1] : id);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Set SHEET_ID in Project Settings → Script properties, or open Apps Script from inside the Google Sheet.');
  return active;
}

function SheetStore_() {
  var ss = openSheet_();
  var memo = {};

  function sheet(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Missing sheet ' + name + '. Run setup() first.');
    return sh;
  }
  function load(name) {
    if (memo[name]) return memo[name];
    var values = sheet(name).getDataRange().getDisplayValues();
    var head = values.shift();
    var rows = values.filter(function (r) { return r.join('') !== ''; }).map(function (r, i) {
      var o = {}; head.forEach(function (h, j) { o[h] = r[j]; });
      Object.defineProperty(o, '__row', { value: i + 2, enumerable: false });
      return o;
    });
    memo[name] = { head: head, rows: rows };
    return memo[name];
  }
  function key(name) { return HRCore.SCHEMA[name][0]; }

  return {
    all: function (name) { return load(name).rows.map(function (r) { return Object.assign({}, r); }); },
    find: function (name, id) {
      var k = key(name);
      var r = load(name).rows.filter(function (x) { return String(x[k]) === String(id); })[0];
      return r ? Object.assign({}, r) : null;
    },
    insert: function (name, obj) {
      var t = load(name);
      var row = t.head.map(function (h) { return obj[h] == null ? '' : String(obj[h]); });
      var sh = sheet(name), at = sh.getLastRow() + 1;
      // Plain-text format first, so dates and IDs are stored exactly as written.
      sh.getRange(at, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      delete memo[name];
    },
    update: function (name, id, patch) {
      var t = load(name), k = key(name);
      var r = t.rows.filter(function (x) { return String(x[k]) === String(id); })[0];
      if (!r) throw new Error(name + ' ' + id + ' not found');
      var merged = Object.assign({}, r, patch);
      var row = t.head.map(function (h) { return merged[h] == null ? '' : String(merged[h]); });
      sheet(name).getRange(r.__row, 1, 1, row.length).setValues([row]);
      delete memo[name];
    }
  };
}

// ---------------- Zoho Mail (self client) ----------------
function zohoAccessToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('zoho_access');
  if (t) return t;
  var host = cfg_('ZOHO_ACCOUNTS_HOST') || 'accounts.zoho.in';
  var res = UrlFetchApp.fetch('https://' + host + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: {
      refresh_token: PROPS.getProperty('ZOHO_REFRESH_TOKEN'),
      client_id: PROPS.getProperty('ZOHO_CLIENT_ID'),
      client_secret: PROPS.getProperty('ZOHO_CLIENT_SECRET'),
      grant_type: 'refresh_token'
    }
  });
  var json = JSON.parse(res.getContentText());
  if (!json.access_token) throw new Error('Zoho token error: ' + res.getContentText());
  cache.put('zoho_access', json.access_token, 3300); // tokens last 1 hour
  return json.access_token;
}

function zohoSend_(to, subject, html) {
  var host = cfg_('ZOHO_MAIL_HOST') || 'mail.zoho.in';
  var res = UrlFetchApp.fetch('https://' + host + '/api/accounts/' + PROPS.getProperty('ZOHO_ACCOUNT_ID') + '/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Zoho-oauthtoken ' + zohoAccessToken_() },
    payload: JSON.stringify({
      fromAddress: cfg_('ZOHO_FROM_ADDRESS'),
      toAddress: to,
      subject: subject,
      content: html,
      mailFormat: 'html'
    })
  });
  if (res.getResponseCode() >= 300) throw new Error('Zoho send failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
}

// ================= ZOHO MAIL: ONE-STEP CONNECT =================
// 1. Run showZohoScope() and copy the scope from the log into Zoho → Self Client → Generate Code.
// 2. Paste your Client ID, Client Secret and the generated code below (inside the quotes).
// 3. Run connectZoho(). It saves everything, finds the mailbox, and sends you a test email.
// 4. Afterwards, clear the three values below again and save.
var ZOHO_SETUP = {
  CLIENT_ID: '1000.4T1XLOBT18HIAAWM8OBO3GFWHHDQMY',
  CLIENT_SECRET: '2e4ca1d3c6c9de24a243dc2a9a7438d2eb52b552f1',
  CODE: '1000.c360fcaa288bbfaa75f6a453a2421f96.783933cf2af82f53ab15b86592e0dcdc'   // a fresh code from Generate Code, or a refresh token
};
var ZOHO_SCOPE = 'ZohoMail.messages.CREATE,ZohoMail.accounts.READ';

function showZohoScope() {
  Logger.log('Copy this into the Scope box in Zoho (api-console.zoho.in → Self Client → Generate Code):');
  Logger.log(ZOHO_SCOPE);
}

function connectZoho() {
  var id = String(ZOHO_SETUP.CLIENT_ID).trim(), secret = String(ZOHO_SETUP.CLIENT_SECRET).trim(), code = String(ZOHO_SETUP.CODE).trim();
  if (!id || !secret || !code) throw new Error('Paste CLIENT_ID, CLIENT_SECRET and CODE into ZOHO_SETUP at the top of this section, save, then run connectZoho again.');

  // 1. Swap the code for a long-lasting refresh token.
  var host = cfg_('ZOHO_ACCOUNTS_HOST') || 'accounts.zoho.in';
  var res = UrlFetchApp.fetch('https://' + host + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { code: code, client_id: id, client_secret: secret, grant_type: 'authorization_code' }
  });
  var json = JSON.parse(res.getContentText());
  // If the value is a refresh token rather than a fresh code, use it directly.
  if (!json.refresh_token && json.error === 'invalid_code') {
    var r2 = UrlFetchApp.fetch('https://' + host + '/oauth/v2/token', { method: 'post', muteHttpExceptions: true,
      payload: { refresh_token: code, client_id: id, client_secret: secret, grant_type: 'refresh_token' } });
    var j2 = JSON.parse(r2.getContentText());
    if (j2.access_token) json = { access_token: j2.access_token, refresh_token: code };
  }
  if (!json.refresh_token) {
    var why = json.error === 'invalid_code' ? 'The code has expired or was already used. Generate a new one in Zoho and run again within 10 minutes.'
      : json.error === 'invalid_client' ? 'The Client ID or Client Secret is wrong, or the Self Client is on another Zoho data centre (this uses ' + host + ').'
      : 'Zoho said: ' + res.getContentText();
    throw new Error(why);
  }
  PROPS.setProperty('ZOHO_CLIENT_ID', id);
  PROPS.setProperty('ZOHO_CLIENT_SECRET', secret);
  PROPS.setProperty('ZOHO_REFRESH_TOKEN', json.refresh_token);
  CacheService.getScriptCache().put('zoho_access', json.access_token, 3300);
  Logger.log('✓ Connected to Zoho and saved the keys.');

  // 2. Find the mailbox that sends the portal's emails.
  var mailHost = cfg_('ZOHO_MAIL_HOST') || 'mail.zoho.in';
  var acc = JSON.parse(UrlFetchApp.fetch('https://' + mailHost + '/api/accounts', { headers: { Authorization: 'Zoho-oauthtoken ' + json.access_token }, muteHttpExceptions: true }).getContentText());
  var list = acc.data || [];
  if (!list.length) throw new Error('Connected, but no Zoho Mail mailbox was found for this Zoho user. Log in to Zoho with the account that owns ' + cfg_('ZOHO_FROM_ADDRESS') + ' and start again.');
  var from = cfg_('ZOHO_FROM_ADDRESS').toLowerCase(), pick = null;
  list.forEach(function (a) {
    var addrs = [String(a.primaryEmailAddress || '').toLowerCase()];
    (a.emailAddress || []).forEach(function (e) { addrs.push(String(e.mailId || '').toLowerCase()); });
    (a.sendMailDetails || []).forEach(function (e) { addrs.push(String(e.fromAddress || '').toLowerCase()); });
    Logger.log('  mailbox ' + a.accountId + ': ' + addrs.filter(String).join(', '));
    if (!pick && addrs.indexOf(from) >= 0) pick = a;
  });
  if (!pick) {
    pick = list[0];
    PROPS.setProperty('ZOHO_FROM_ADDRESS', String(pick.primaryEmailAddress));
    Logger.log('! ' + from + ' was not found in this Zoho account, so emails will be sent from ' + pick.primaryEmailAddress + ' instead.');
  }
  PROPS.setProperty('ZOHO_ACCOUNT_ID', String(pick.accountId));
  Logger.log('✓ Sending from ' + cfg_('ZOHO_FROM_ADDRESS') + ' (mailbox ' + pick.accountId + ').');

  // 3. Test email.
  zohoSend_(cfg_('ADMIN_EMAIL'), 'ACRI HR Portal: Zoho Mail connected', '<p>Zoho Mail is connected to the ACRI HR Portal. Automatic emails will now be sent.</p>');
  Logger.log('✓ Test email sent to ' + cfg_('ADMIN_EMAIL') + '. Now clear CLIENT_ID, CLIENT_SECRET and CODE in ZOHO_SETUP and save.');
}

/** Send another test email at any time. */
function testEmail() {
  zohoSend_(cfg_('ADMIN_EMAIL'), 'ACRI HR Portal test', '<p>Zoho Mail is connected to the ACRI HR Portal.</p>');
  Logger.log('Sent to ' + cfg_('ADMIN_EMAIL') + '.');
}

// ---------------- wiring ----------------
function hash_(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// Proof files (absence screenshots) are kept private in a Drive folder owned by the script's account.
function proofFolder_() {
  var id = PROPS.getProperty('PROOF_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('ACRI HR Portal – Absence Proofs');
  PROPS.setProperty('PROOF_FOLDER_ID', folder.getId());
  return folder;
}
function saveFile_(name, mime, base64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
  return proofFolder_().createFile(blob).getId();
}
function readFile_(id) {
  return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes());
}

function core_() {
  var cache = CacheService.getScriptCache();
  return HRCore.create({
    saveFile: saveFile_,
    readFile: readFile_,
    store: SheetStore_(),
    mail: zohoSend_,
    hash: hash_,
    uid: function () { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); },
    cache: { get: function (k) { return cache.get(k); }, put: function (k, v, s) { cache.put(k, v, s); }, remove: function (k) { cache.remove(k); } },
    withLock: function (fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } },
    log: function (e) { console.error(e && e.stack || e); }
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// The site sends POST with Content-Type text/plain, so no CORS preflight is needed.
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  return json_(core_().handle(body));
}

function doGet() { return json_({ ok: true, service: 'ACRI HR Portal API' }); }

// ---------------- one-time setup ----------------
function setup() {
  var ss = openSheet_();
  Object.keys(HRCore.SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var head = HRCore.SCHEMA[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0b5fa5').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    } else {
      // Add any new columns to a tab made by an earlier version.
      var have = sh.getDataRange().getDisplayValues()[0];
      head.filter(function (h) { return have.indexOf(h) < 0; }).forEach(function (h) {
        var col = sh.getLastColumn() + 1;
        sh.getRange(1, col, 1, 1).setValues([[h]]).setFontWeight('bold').setBackground('#0b5fa5').setFontColor('#ffffff');
      });
    }
    // Store everything as plain text so Sheets never turns dates or IDs into something else.
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(head.length, sh.getLastColumn())).setNumberFormat('@');
  });
  var first = ss.getSheetByName('Sheet1'); if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  var store = SheetStore_();
  var uid = function () { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); };
  var now = new Date().toISOString();

  if (store.all('Settings').length === 0) {
    [['PORTAL_URL', cfg_('PORTAL_URL')], ['ADMIN_NOTIFY_EMAIL', cfg_('ADMIN_NOTIFY_EMAIL')], ['ORG_NAME', 'Ahmedabad Centre for Research and Innovation']]
      .forEach(function (kv) { store.insert('Settings', { key: kv[0], value: kv[1] }); });
  }

  var logins = [];
  function tempPw() { return 'ACRI-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

  if (store.all('Admins').length === 0) {
    var pw = PROPS.getProperty('ADMIN_PASSWORD') || tempPw();
    var salt = uid();
    store.insert('Admins', { id: uid(), email: cfg_('ADMIN_EMAIL').toLowerCase(), name: cfg_('ADMIN_NAME'), role: 'owner', salt: salt, hash: hash_(pw, salt), active: 'TRUE', created_at: now });
    logins.push('OWNER  ' + cfg_('ADMIN_EMAIL') + '  password: ' + pw + '   → /admin');
  }

  var vpEmail = (cfg_('VP_EMAIL') || '').toLowerCase();
  if (vpEmail && !store.all('Admins').some(function (a) { return a.email === vpEmail; })) {
    // Vice President: manages the ACRI Abhivyakti Fund.
    var vs = uid(), vpw = tempPw();
    store.insert('Admins', { id: uid(), email: vpEmail, name: cfg_('VP_NAME') || 'Prashant Pareek', role: 'vp', salt: vs, hash: hash_(vpw, vs), active: 'TRUE', created_at: now });
    logins.push('VICE PRESIDENT  ' + vpEmail + '  password: ' + vpw + '   → /admin');
  }

  if (store.all('DeductionHeads').length === 0) {
    [['Student Book Development', 'Design, development and printing of the student books'],
     ['Programme Resources & Session Material', 'Session plans, presentations and activity design'],
     ['ACRI Service Charge', 'ACRI programme management and administration'],
     ['Printing & Logistics', 'Printing, materials and delivery'],
     ['Events & Showcase Support', 'ACRI costs for events not covered by the School'],
     ['ACRI Development Reserve', 'Set aside for ACRI\'s projected institutional use']]
      .forEach(function (h) { store.insert('DeductionHeads', { id: uid(), name: h[0], description: h[1], active: 'TRUE' }); });
  }

  if (store.all('Programmes').length === 0) logins.push(seedAbhivyakti_(store, uid, now, tempPw()));
  proofFolder_(); // creates the private Drive folder for absence proofs (and asks for Drive permission)
  var split = migrateGroups_(store, uid);
  if (split) Logger.log('Split ' + split + ' session(s) into one session per group. Check attendance per group in Admin → Attendance.');

  Logger.log('Setup complete. Temporary logins (copy these now, they are not shown again):');
  logins.forEach(function (l) { Logger.log(l); });
  Logger.log('Everyone should change their password after the first login.');
}

// Abhivyakti 2026–27 with Yashvi's confirmed attendance (17, 24, 31 Oct 2026).
// The rate is left "to be decided"; set it in Admin → Programmes, then Recalculate.
function seedAbhivyakti_(store, uid, now, yashviPw) {
  var pid = uid();
  store.insert('Programmes', { id: pid, name: 'Abhivyakti 2026–27', school: 'Apple Global School', students: 18, pay_model: 'share', rate_per_session: 0, pool_per_student: 1500, planned_sessions: 25, acri_cut_pct: 0, status: 'active', created_at: now, groups: ABHIVYAKTI_GROUPS.join('|') });

  var core = HRCore.create({ store: store, mail: function () {}, hash: hash_, uid: uid, cache: { get: function () {}, put: function () {}, remove: function () {} } });

  var email = cfg_('YASHVI_EMAIL').toLowerCase();
  var fid = uid(), salt = uid();
  store.insert('Facilitators', { id: fid, name: 'Yashvi Ramesh Mehta', email: email, phone: '', salt: salt, hash: hash_(yashviPw, salt), status: 'active', appointment_ref: 'ACRI/HR/APT/2026-27/001', appointed_on: '2026-10-17', must_change: 'TRUE', created_at: now });
  store.insert('Assignments', { id: uid(), programme_id: pid, facilitator_id: fid, role: 'Facilitator', from_date: '2026-10-17', status: 'active', groups: '' });

  // Group 2 and Group 3 started on 17 Oct; Group 1 started on 31 Oct.
  var plan = [
    [ABHIVYAKTI_GROUPS[1], '1', '2026-10-17'], [ABHIVYAKTI_GROUPS[2], '1', '2026-10-17'],
    [ABHIVYAKTI_GROUPS[1], '2', '2026-10-24'], [ABHIVYAKTI_GROUPS[2], '2', '2026-10-24'],
    [ABHIVYAKTI_GROUPS[0], '1', '2026-10-31'], [ABHIVYAKTI_GROUPS[1], '3', '2026-10-31'], [ABHIVYAKTI_GROUPS[2], '3', '2026-10-31']
  ];
  plan.forEach(function (p) {
    var session = { id: uid(), programme_id: pid, number: p[1], date: p[2], group: p[0], mode: 'online', topic: '', status: 'held', extra: 'FALSE', time: '', venue: '' };
    store.insert('Sessions', session);
    store.insert('Attendance', { id: uid(), session_id: session.id, facilitator_id: fid, status: 'present', claim_note: '', claimed_at: '', verified_by: 'setup', verified_at: now, remarks: 'Confirmed in appointment letter ACRI/HR/APT/2026-27/001' });
    core.syncPayment(fid, session, 'present');
  });
  return 'FACILITATOR  ' + email + '  password: ' + yashviPw + '   → home page';
}

// Converts a sheet made before groups existed: gives Abhivyakti its three groups, splits any session that
// covered several groups into one session per group (copying its attendance), and numbers sessions per group by date.
function migrateGroups_(store, uid) {
  var core = HRCore.create({ store: store, mail: function () {}, hash: hash_, uid: uid, cache: { get: function () {}, put: function () {}, remove: function () {} } });
  var changed = 0;
  store.all('Programmes').forEach(function (prog) {
    var groups = String(prog.groups || '').split('|').filter(String);
    if (!groups.length) {
      if (!/abhivyakti/i.test(prog.name)) return;
      groups = ABHIVYAKTI_GROUPS;
      store.update('Programmes', prog.id, { groups: groups.join('|') });
      prog = store.find('Programmes', prog.id);
    }
    function targets(text) {
      text = String(text || '');
      if (groups.indexOf(text) >= 0) return null; // already fine
      if (!text || /all/i.test(text)) return groups.slice();
      var t = [];
      if (/9\s*[–-]\s*12/.test(text)) t.push(groups[0]);
      if (/6\s*[–-]\s*8/.test(text)) t.push(groups[1]);
      if (/3\s*[–-]\s*5/.test(text)) t.push(groups[2]);
      return t.length ? t : groups.slice();
    }
    var touched = false;
    store.all('Sessions').filter(function (x) { return x.programme_id === prog.id; }).forEach(function (sess) {
      var t = targets(sess.group); if (!t) return;
      touched = true; changed++;
      var att = store.all('Attendance').filter(function (a) { return a.session_id === sess.id; });
      store.update('Sessions', sess.id, { group: t[0] });
      t.slice(1).forEach(function (g) {
        var copy = Object.assign({}, sess, { id: uid(), group: g });
        store.insert('Sessions', copy);
        att.forEach(function (a) {
          store.insert('Attendance', Object.assign({}, a, { id: uid(), session_id: copy.id, remarks: (a.remarks ? a.remarks + ' · ' : '') + 'Copied when sessions were split by group' }));
          if (a.status === 'present' || a.status === 'absent') core.syncPayment(a.facilitator_id, copy, a.status);
        });
      });
    });
    if (!touched) return;
    groups.forEach(function (g) {
      store.all('Sessions').filter(function (x) { return x.programme_id === prog.id && x.group === g; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
        .forEach(function (x, i) { if (String(x.number) !== String(i + 1)) store.update('Sessions', x.id, { number: String(i + 1) }); });
    });
  });
  return changed;
}

// ---------------- admin password ----------------
/** Sets a new password for an admin. Edit the two lines below, run it once, then remove the password from here. */
function setAdminPassword() {
  var email = 'president@acriindia.org';
  var newPassword = 'TYPE-YOUR-NEW-PASSWORD';   // 8+ characters
  if (newPassword.length < 8 || newPassword === 'TYPE-YOUR-NEW-PASSWORD') throw new Error('Type a new password (8+ characters) in setAdminPassword() first.');
  var store = SheetStore_();
  var admin = store.all('Admins').filter(function (a) { return String(a.email).toLowerCase() === email.toLowerCase(); })[0];
  if (!admin) throw new Error('No admin with email ' + email + '. Run setup() first.');
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  store.update('Admins', admin.id, { salt: salt, hash: hash_(newPassword, salt), active: 'TRUE' });
  Logger.log('Password updated for ' + email + '. Now delete the password from this function and save.');
}
