/* ACRI HR Portal — shared front-end helpers (API calls and UI bits). */
(function () {
  'use strict';
  var cfg = window.HR_CONFIG || {};

  function call(body) {
    if (!cfg.API_URL) return Promise.resolve({ ok: false, error: 'The portal is not connected yet. Add the Apps Script URL to config.js.' });
    return fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; });
  }

  // ---------- UI helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { if (v === '' || v == null) return '—'; return '₹' + Math.round(Number(v)).toLocaleString('en-IN'); }
  function date(d) { if (!d) return '—'; var x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  var PAYOUT = { pending: ['Pending approval', 'amber'], approved: ['Approved', 'green'], withheld: ['Withheld', 'red'], rejected: ['Rejected', 'red'], paid: ['Paid', 'dark'] };
  var ATT = { paid_leave: ['Paid leave', 'green'], leave: ['Authorised absence (not paid)', 'blue'], present: ['Present', 'green'], absent: ['Absent', 'red'], claimed: ['Awaiting verification', 'amber'], rejected: ['Rejected', 'red'] };
  var PAY = { rate_pending: ['Rate to be finalised', 'blue'], pending: ['Pending approval', 'amber'], approved: ['Approved', 'green'], withheld: ['Withheld', 'red'], rejected: ['Rejected', 'red'], paid: ['Paid', 'dark'], not_payable: ['Not payable', ''], eligible: ['Counts for your share', 'blue'] };
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
        else if (f.type === 'file') input = '<input class="i" name="' + f.name + '" type="file" accept="' + esc(f.accept || 'image/*,application/pdf') + '">';
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
      var data = {}, waits = [];
      fields.forEach(function (f) {
        var el = fm.elements[f.name];
        if (f.type === 'file') { data[f.name] = null; if (el.files && el.files[0]) waits.push(readFile(el.files[0]).then(function (v) { data[f.name] = v; })); }
        else data[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      });
      var btn = fm.querySelector('[type=submit]'); btn.disabled = true;
      Promise.all(waits).then(function () { return onSubmit(data); }, function (e) { return { ok: false, error: e.message || 'Could not read the file.' }; }).then(function (res) {
        btn.disabled = false;
        if (res && res.ok === false) { err.innerHTML = '<div class="note err">' + esc(res.error) + '</div>'; return; }
        close();
      });
    };
    var first = fm.querySelector('input,select,textarea'); if (first) first.focus();
  }

  // Reads an uploaded file as base64. Images are resized (max 1600px) and saved as JPEG to keep them small.
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var isImg = /^image\//.test(file.type), isPdf = file.type === 'application/pdf';
      if (!isImg && !isPdf) return reject(new Error('Please choose an image (JPG, PNG) or a PDF.'));
      if (isPdf && file.size > 4 * 1024 * 1024) return reject(new Error('The PDF is too large. Please keep it under 4 MB.'));
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Could not read the file.')); };
      r.onload = function () {
        if (isPdf) return resolve({ name: file.name, mime: 'application/pdf', data: String(r.result).split(',')[1] });
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not open the image.')); };
        img.onload = function () {
          var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function showProof(p) {
    var src = 'data:' + p.mime + ';base64,' + p.data;
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" style="max-width:760px"><div class="hd">' + esc(p.name || 'Proof') + '</div><div class="bd" style="padding:12px">' +
      (p.mime === 'application/pdf' ? '<iframe src="' + src + '" style="width:100%;height:70vh;border:0"></iframe>' : '<img src="' + src + '" style="max-width:100%;display:block;margin:0 auto">') +
      '</div><div class="ft"><a class="btn ghost" download="' + esc(p.name || 'proof') + '" href="' + src + '">Download</a><button class="btn" data-x>Close</button></div></div>';
    document.body.appendChild(bg);
    bg.querySelector('[data-x]').onclick = function () { bg.remove(); };
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });
  }

  window.HR = { showProof: showProof, call: call, DEMO: false, esc: esc, money: money, date: date, pill: pill, ATT: ATT, PAY: PAY, PAYOUT: PAYOUT, toast: toast, form: form };
})();
