const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const sheets={};
function Sheet(name){ this.name=name; this.data=[]; }
Sheet.prototype={
  getLastRow(){return this.data.length;}, getLastColumn(){return this.data[0]?this.data[0].length:0;}, getMaxRows(){return Math.max(1000,this.data.length);}, setFrozenRows(){},
  getRange(r,c,nr,nc){ const sh=this; return {
    setValues(v){ v.forEach((row,i)=>{ const cur=sh.data[r-1+i]||[]; row.forEach((x,j)=>{cur[c-1+j]=String(x);}); sh.data[r-1+i]=cur;}); return this;},
    setNumberFormat(){return this;}, setFontWeight(){return this;}, setBackground(){return this;}, setFontColor(){return this;} };},
  getDataRange(){ const sh=this; return { getDisplayValues(){ return sh.data.map(r=>r.slice()); } }; }
};
const ss={ getSheetByName:n=>sheets[n]||null, insertSheet:n=>(sheets[n]=new Sheet(n)), getSheets:()=>Object.values(sheets), deleteSheet(){} };
const props={}; const logs=[];
const ctx={ console,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},
  SpreadsheetApp:{openById:()=>{throw new Error('Invalid argument: id')},getActiveSpreadsheet:()=>ss},
  Utilities:{getUuid:()=>crypto.randomUUID(),computeDigest:(a,s)=>Array.from(crypto.createHash('sha256').update(s).digest()).map(b=>b>127?b-256:b),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1}},
  CacheService:(()=>{const m={};const c={get:k=>m[k]||null,put:(k,v)=>m[k]=v,remove:k=>delete m[k]};return{getScriptCache:()=>c}})(),
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  Logger:{log:m=>logs.push(m)}, ContentService:{createTextOutput:t=>({setMimeType(){return t}}),MimeType:{JSON:1}}, UrlFetchApp:{fetch(){throw new Error('no net')}}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('backend/Core.js','utf8').replace("if (typeof module","if (false && typeof module"),ctx);
vm.runInContext(fs.readFileSync('backend/Code.js','utf8'),ctx);
ctx.setup();
console.log(logs.join('\n'));
const own=logs.find(l=>l.startsWith('OWNER')).match(/password: (\S+)/)[1];
const yash=logs.find(l=>l.startsWith('FACILITATOR')).match(/password: (\S+)/)[1];
let r=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'login',role:'admin',email:'president@acriindia.org',password:own})}}));
console.log('owner login', r.ok, r.data && r.data.payments.length, 'payments', r.data && r.data.deductionHeads.length,'heads', r.data && r.data.admins.map(a=>a.email+':'+a.role).join(','));
r=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'login',email:'yashvi.mehta07@gmail.com',password:yash})}}));
console.log('yashvi login', r.ok, r.data && r.data.sessions.map(s=>s.date+':'+s.attendance.status+':'+s.payment.status).join(' '));
// old tab without share_pct column -> setup adds it
sheets.Assignments.data[0]=sheets.Assignments.data[0].slice(0,6); sheets.Assignments.data[1]=sheets.Assignments.data[1].slice(0,6);
ctx.setup(); console.log('second setup ok, admins:', sheets.Admins.data.length-1, 'assignment cols:', sheets.Assignments.data[0].join(','));
r=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'login',role:'admin',email:'president@acriindia.org',password:own})}}));
const tok=r.token; r=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'dashboard',token:tok})}})); console.log('admin dashboard reload', r.ok, r.error||'');
