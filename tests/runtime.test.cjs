const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const C = require('../extension/lib/core.js'), db = require('../extension/data/journals.json');
const apiFixture = {message: {DOI: '10.1037/0003-066x.59.1.29', title: ['How the Mind Hurts and Heals the Body.'], 'container-title': ['American Psychologist'], 'short-container-title': ['American Psychologist'], 'published-online': {'date-parts': [[2004]]}, ISSN: ['0003-066X']}};
function environment(remote = async () => ({ok: true, json: async () => apiFixture})) {
  const listeners = {}, stores = {local: {}, session: {}}, requests = [];
  const event = name => ({addListener: fn => listeners[name] = fn});
  const area = name => ({get: async keys => {const s = stores[name]; return Object.fromEntries([].concat(keys).filter(k => k in s).map(k => [k, structuredClone(s[k])]));}, set: async values => Object.assign(stores[name], structuredClone(values)), remove: async keys => [].concat(keys).forEach(k => delete stores[name][k])});
  const chrome = {
    runtime: {getURL: value => 'chrome-extension://test/' + value, onMessage: event('message')},
    storage: {local: area('local'), session: area('session')},
    downloads: {onDeterminingFilename: event('download'), onChanged: event('changed')},
    tabs: {onRemoved: event('removed'), query: async () => [{id: 1, url: 'https://journal.test/article'}], sendMessage: async () => ({title: 'Page article', year: '2024', journal: 'Nature Medicine'}), get: async () => ({id: 1, url: 'https://journal.test/article'})}
  };
  const context = vm.createContext({chrome, PaperCore: C, importScripts: () => {}, setTimeout, clearTimeout, AbortController, fetch: async (url, options) => {requests.push({url, options}); return url.startsWith('chrome-extension:') ? {json: async () => structuredClone(db)} : remote(url, options);}});
  for (const file of ['lib/platform.js', 'lib/download.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), context);
  return {context, stores, listeners, requests, message: (msg, sender) => new Promise(resolve => {const asynchronous = listeners.message(msg, sender, resolve); if (!asynchronous) resolve(undefined);})};
}
test('精确 DOI 补全，并优先使用 NLM 缩写', async () => {
  const e = environment();
  e.stores.session.contexts = [];
  const result = await vm.runInContext(`resolveDownload({id:1,mime:'application/pdf',filename:'original.pdf',url:'https://x/doi/pdf/10.1037/0003-066X.59.1.29'})`, e.context);
  assert.equal(result.filename, 'Am Psychol-2004-How the Mind Hurts and Heals the Body.pdf');
  const api = e.requests.find(r => r.url.startsWith('https://api.crossref.org/'));
  assert.ok(api.url.includes('10.1037%2F0003-066X.59.1.29'));
  assert.equal(api.options.credentials, 'omit'); assert.equal(api.options.referrerPolicy, 'no-referrer');
});
test('ScienceDirect 原始文件名中的 PII 可经 PubMed 唯一记录补全', async () => {
  const e = environment(async url => {
    if (url.includes('/esearch.fcgi')) return {ok: true, json: async () => ({esearchresult: {count: '1', idlist: ['42772285']}})};
    if (url.includes('/esummary.fcgi')) return {ok: true, json: async () => ({result: {'42772285': {uid: '42772285', title: 'A liver-cartilage selenium axis underlies metabolic comorbidity in osteoarthritis.', fulljournalname: 'Cell Metabolism', source: 'Cell Metab', pubdate: '2026 Oct 06', issn: '1550-4131', articleids: [{idtype: 'pii', value: 'S1550-4131(26)00375-X'}, {idtype: 'doi', value: '10.1016/j.cmet.2026.08.023'}]}}})};
    throw new Error('Unexpected request');
  });
  e.stores.session.contexts = [];
  const result = await vm.runInContext(`resolveDownload({id:8,mime:'application/pdf',filename:'PIIS155041312600375X.pdf',url:'https://pdf.sciencedirectassets.com/file.pdf'})`, e.context);
  assert.equal(result.filename, 'Cell Metab-2026-A liver-cartilage selenium axis underlies metabolic comorbidity in osteoarthritis.pdf');
  assert.ok(e.requests.some(request => request.url.includes(encodeURIComponent('S1550-4131(26)00375-X[pii]'))));
});
test('PII 检索不唯一或返回记录 PII 不一致时不改名', async () => {
  const ambiguous = environment(async url => ({ok: true, json: async () => url.includes('/esearch.fcgi') ? {esearchresult: {count: '2', idlist: ['1', '2']}} : {}}));
  ambiguous.stores.session.contexts = [];
  assert.equal(await vm.runInContext(`resolveDownload({id:9,mime:'application/pdf',filename:'PIIS155041312600375X.pdf',url:'https://x/file.pdf'})`, ambiguous.context), undefined);
  const mismatch = environment(async url => ({ok: true, json: async () => url.includes('/esearch.fcgi') ? {esearchresult: {count: '1', idlist: ['1']}} : {result: {'1': {uid: '1', title: 'Wrong', source: 'Wrong', pubdate: '2026', articleids: [{idtype: 'pii', value: 'S0000-0000(26)00000-0'}]}}}}));
  mismatch.stores.session.contexts = [];
  assert.equal(await vm.runInContext(`resolveDownload({id:10,mime:'application/pdf',filename:'PIIS155041312600375X.pdf',url:'https://x/file.pdf'})`, mismatch.context), undefined);
});
test('网络失败仍使用已识别字段，关闭在线补全不发请求', async () => {
  const e = environment(async () => {throw new Error('Network failure');});
  e.stores.session.contexts = [{time: Date.now(), kind: 'page', pageUrl: 'https://journal.test/article', meta: {title: 'Offline title', doi: '10.1000/paper'}}];
  const result = await vm.runInContext(`resolveDownload({id:2,filename:'original.pdf',url:'https://cdn.test/file.pdf',referrer:'https://journal.test/article'})`, e.context);
  assert.equal(result.filename, 'Offline title.pdf');
  e.stores.local.settings = {online: false};
  const count = e.requests.length;
  await vm.runInContext(`resolveDownload({id:3,filename:'original.pdf',url:'https://cdn.test/file.pdf',referrer:'https://journal.test/article'})`, e.context);
  assert.equal(e.requests.length, count);
});
test('下载 DOI 与来源页 DOI 不同，不拼接两篇论文', async () => {
  const e = environment(async () => {throw new Error('Network failure');});
  e.stores.session.contexts = [{time: Date.now(), kind: 'page', pageUrl: 'https://journal.test/article', meta: {title: 'Wrong article', doi: '10.1000/wrong', year: '2020'}}];
  const result = await vm.runInContext(`resolveDownload({id:3,filename:'original.pdf',url:'https://x/doi/pdf/10.1037/0003-066X.59.1.29',referrer:'https://journal.test/article'})`, e.context);
  assert.equal(result, undefined);
});
test('批量请求排队过长时立即回退，不拖延下载', async () => {
  const e = environment();
  vm.runInContext('nextApiTime = Date.now() + 3000', e.context);
  await assert.rejects(vm.runInContext("apiJson('https://api.crossref.org/works/10.1000/test')", e.context), /busy/);
  assert.equal(e.requests.length, 0);
});
test('设置页在标签页中打开时仍可读取，网站不能修改设置', async () => {
  const e = environment();
  const response = await e.message({type: 'STATE'}, {url: 'chrome-extension://test/popup.html', tab: {id: 20}});
  assert.equal(response.meta.abbreviation, 'Nat Med');
  assert.equal(await e.message({type: 'SETTINGS', config: {enabled: false}}, {url: 'https://journal.test/article', tab: {id: 1}}), undefined);
  assert.equal(e.stores.local.settings, undefined);
});
test('suggest 回调只调用一次，PDF失败安全回退，HTML立即放行', async () => {
  const e = environment();
  const calls = [];
  const ret = e.listeners.download({id: 5, filename: 'unknown.pdf', mime: 'application/pdf', url: 'https://cdn.test/unknown.pdf'}, value => calls.push(value));
  assert.equal(ret, true);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(calls.length, 1); assert.equal(calls[0], undefined);
  const other = [];
  e.listeners.download({mime: 'text/html', filename: 'error.pdf'}, value => other.push(value));
  assert.equal(other.length, 1);
});
