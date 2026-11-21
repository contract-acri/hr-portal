/**
 * ACRI HR Portal — Apps Script backend (hr.acriindia.org.in)
 *
 * Files in the Apps Script project:
 *   Core.gs  ← paste backend/Core.js
 *   Code.gs  ← paste this file
 *
 * Emails and names are set in CONFIG below. Only these Script Properties are needed,
 * and they are filled for you by running exchangeZohoCode() and findZohoAccountId():
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET   (paste from Zoho API Console → Self Client)
 *   ZOHO_REFRESH_TOKEN, ZOHO_ACCOUNT_ID  (saved automatically)
 * Optional: SHEET_ID (not needed when Apps Script is opened from the Sheet), ADMIN_PASSWORD.
 */

var PROPS = PropertiesService.getScriptProperties();

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

/** Step 1 of Zoho setup: paste the code from the Self Client and run this once. */
function exchangeZohoCode() {
  var code = 'PASTE_THE_GENERATED_CODE_HERE';
  var host = cfg_('ZOHO_ACCOUNTS_HOST') || 'accounts.zoho.in';
  var res = UrlFetchApp.fetch('https://' + host + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { code: code, client_id: PROPS.getProperty('ZOHO_CLIENT_ID'), client_secret: PROPS.getProperty('ZOHO_CLIENT_SECRET'), grant_type: 'authorization_code' }
  });
  var json = JSON.parse(res.getContentText());
  if (!json.refresh_token) throw new Error('No refresh token returned: ' + res.getContentText());
  PROPS.setProperty('ZOHO_REFRESH_TOKEN', json.refresh_token);
  Logger.log('Saved ZOHO_REFRESH_TOKEN.');
}

/** Step 2 of Zoho setup: finds the mailbox account ID and saves it. */
function findZohoAccountId() {
  var host = cfg_('ZOHO_MAIL_HOST') || 'mail.zoho.in';
  var res = UrlFetchApp.fetch('https://' + host + '/api/accounts', { headers: { Authorization: 'Zoho-oauthtoken ' + zohoAccessToken_() }, muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  var from = (cfg_('ZOHO_FROM_ADDRESS') || '').toLowerCase();
  (json.data || []).forEach(function (a) {
    Logger.log(a.accountId + '  ' + a.primaryEmailAddress);
    if (String(a.primaryEmailAddress).toLowerCase() === from) PROPS.setProperty('ZOHO_ACCOUNT_ID', String(a.accountId));
  });
  Logger.log('ZOHO_ACCOUNT_ID = ' + PROPS.getProperty('ZOHO_ACCOUNT_ID'));
}

/** Step 3: send yourself a test email. */
function testEmail() {
  zohoSend_(cfg_('ADMIN_EMAIL'), 'ACRI HR Portal test', '<p>Zoho Mail is connected to the ACRI HR Portal.</p>');
  Logger.log('Sent.');
}

// ---------------- wiring ----------------
function hash_(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function core_() {
  var cache = CacheService.getScriptCache();
  return HRCore.create({
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

  Logger.log('Setup complete. Temporary logins (copy these now, they are not shown again):');
  logins.forEach(function (l) { Logger.log(l); });
  Logger.log('Everyone should change their password after the first login.');
}

// Abhivyakti 2026–27 with Yashvi's confirmed attendance (17, 24, 31 Oct 2026).
// The rate is left "to be decided"; set it in Admin → Programmes, then Recalculate.
function seedAbhivyakti_(store, uid, now, yashviPw) {
  var pid = uid();
  store.insert('Programmes', { id: pid, name: 'Abhivyakti 2026–27', school: 'Apple Global School', students: 18, pay_model: 'share', rate_per_session: 0, pool_per_student: 1500, planned_sessions: 25, acri_cut_pct: 0, status: 'active', created_at: now });

  var core = HRCore.create({ store: store, mail: function () {}, hash: hash_, uid: uid, cache: { get: function () {}, put: function () {}, remove: function () {} } });

  var email = cfg_('YASHVI_EMAIL').toLowerCase();
  var fid = uid(), salt = uid();
  store.insert('Facilitators', { id: fid, name: 'Yashvi Ramesh Mehta', email: email, phone: '', salt: salt, hash: hash_(yashviPw, salt), status: 'active', appointment_ref: 'ACRI/HR/APT/2026-27/001', appointed_on: '2026-10-17', must_change: 'TRUE', created_at: now });
  store.insert('Assignments', { id: uid(), programme_id: pid, facilitator_id: fid, role: 'Facilitator', from_date: '2026-10-17', status: 'active' });

  [['1', '2026-10-17', 'Grades 3–5, 6–8'], ['2', '2026-10-24', 'Grades 3–5, 6–8'], ['3', '2026-10-31', 'All groups']].forEach(function (s) {
    var sid = uid();
    var session = { id: sid, programme_id: pid, number: s[0], date: s[1], group: s[2], mode: 'online', topic: '', status: 'held' };
    store.insert('Sessions', session);
    store.insert('Attendance', { id: uid(), session_id: sid, facilitator_id: fid, status: 'present', claim_note: '', claimed_at: '', verified_by: 'setup', verified_at: now, remarks: 'Confirmed in appointment letter ACRI/HR/APT/2026-27/001' });
    core.syncPayment(fid, session, 'present');
  });
  return 'FACILITATOR  ' + email + '  password: ' + yashviPw + '   → home page';
}
