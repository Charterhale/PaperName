const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const C = require('../extension/lib/core.js'), D = require('../extension/lib/download.js');
const read = file => fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8');
test('Safari 后台没有 downloads / storage.session 时仍可启动、识别和纠正', async () => {
  let listener; const local = {};
  const browser = {
    runtime: {getURL: p => 'safari-web-extension://test/' + p, onMessage: {addListener(fn) {listener = fn;}}},
    storage: {local: {get: async keys => Object.fromEntries([].concat(keys).filter(k => k in local).map(k => [k, local[k]])), set: async v => Object.assign(local,v)}},
    tabs: {onRemoved: {addListener() {}}, query: async () => [{id:1,url:'https://journal.test/a'}],
      sendMessage: async () => ({title:'Article',year:'2024',journal:'Nature Medicine'}), get: async () => ({id:1,url:'https://journal.test/a'})}
  };
  const ctx = vm.createContext({browser, PaperCore:C, URL, structuredClone, setTimeout, clearTimeout, AbortController,
    fetch: async () => ({json: async () => ({titles: {naturemedicine:'Nat Med'}, issns:{}})})});
  for (const f of ['lib/platform.js','lib/download.js','background.js']) vm.runInContext(read(f),ctx);
  const send = (message,sender) => Promise.resolve(listener(message,sender));
  const state = await send({type:'STATE'},{url:browser.runtime.getURL('popup.html')});
  assert.equal(state.nativeDownloads,false); assert.equal(state.meta.abbreviation,'Nat Med');
  const sender={url:'https://journal.test/a',tab:{id:1}};
  const prepared=await send({type:'PREPARE_PDF',pageUrl:sender.url,targetUrl:'https://journal.test/a.pdf',meta:{title:'Article',year:'2024',journal:'Nature Medicine'}},sender);
  assert.equal(prepared.filename,'Nat Med-2024-Article.pdf');
  assert.ok((await send({type:'PREPARE_PDF',pageUrl:sender.url,targetUrl:'https://other.test/a.pdf'},sender)).error);
  assert.ok((await send({type:'PREPARE_PDF',pageUrl:'https://journal.test/other',targetUrl:'https://journal.test/a.pdf'},sender)).error);
  assert.equal(await send({type:'SETTINGS',config:{enabled:false}},sender),undefined);
});
test('Safari 只接受同源 HTTP PDF，不发送跨域 Cookie、不接管附件', () => {
  const page='https://journal.test/article';
  for(const url of ['https://cdn.test/a.pdf','data:application/pdf,x','javascript:alert(1)','https://u:p@journal.test/a.pdf','https://journal.test/supplement.pdf']) assert.equal(D.eligible(url,page),false);
  assert.equal(D.eligible('/a.pdf',page),true);
  const a=(url,text='PDF',attr='')=>({href:url,textContent:text,getAttribute:()=>attr});
  assert.equal(D.directPdf(a('https://journal.test/a.pdf'),page),true);
  assert.equal(D.directPdf(a('https://journal.test/download','PDF','article.pdf'),page),true);
  assert.equal(D.directPdf(a('https://journal.test/view'),page),false);
  assert.equal(D.directPdf(a('https://journal.test/a.pdf','补充材料'),page),false);
});
test('Safari 校验实际 PDF 字节，拒绝登录 HTML、伪 PDF 和超大响应', async () => {
  const blob=await D.readPdf(new Response('%PDF-1.4\nfixture',{headers:{'content-type':'application/pdf'}}));
  assert.equal(await blob.text(),'%PDF-1.4\nfixture');
  await assert.rejects(D.readPdf(new Response('<html>Login</html>',{headers:{'content-type':'text/html'}})),/不是 PDF/);
  await assert.rejects(D.readPdf(new Response('Fake PDF',{headers:{'content-type':'application/pdf'}})),/PDF 标识/);
  await assert.rejects(D.readPdf(new Response('x',{headers:{'content-length':String(D.MAX_BYTES+1)}})),/50 MB/);
});
