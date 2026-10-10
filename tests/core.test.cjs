const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/lib/core.js');
const m = {title: 'Aging of the joint', year: '2024', abbreviation: 'Nat Med'};
test('三种顺序', () => {
  assert.equal(C.filename(m), 'Nat Med-2024-Aging of the joint.pdf');
  assert.equal(C.filename(m, {order: 'year-journal-title'}), '2024-Nat Med-Aging of the joint.pdf');
  assert.equal(C.filename(m, {order: 'title-year-journal'}), 'Aging of the joint-2024-Nat Med.pdf');
});
test('缺失字段省略，未知缩写保留全名', () => {
  assert.equal(C.filename({title: '中文论文', journal: '中华骨科杂志'}), '中华骨科杂志-中文论文.pdf');
  assert.equal(C.filename({title: 'Only title'}), 'Only title.pdf');
  assert.equal(C.filename({year: '2024'}), '');
});
test('文件名跨系统安全且中文不会截断字节', () => {
  const name = C.filename({title: '关节:老化/机制?'.repeat(100), journal: '期刊', year: '2024'});
  assert.ok(Buffer.byteLength(name) <= 220);
  assert.ok(!/[<>:"/\\|?*]/.test(name));
  assert.ok(!name.includes('\ufffd'));
  assert.equal(C.sanitize('CON'), '_CON');
  assert.equal(C.sanitize('../../outside'), 'outside');
  assert.equal(C.filename({title: '...'}), '');
});
test('PDF 和非 PDF 区分，CAJ 和错误 HTML 不改名', () => {
  assert.ok(C.isPdf({mime: 'application/pdf', filename: 'download.action'}));
  assert.ok(C.isPdf({mime: 'application/octet-stream', filename: 'paper.pdf'}));
  assert.ok(!C.isPdf({mime: 'text/html', filename: 'paper.pdf'}));
  assert.ok(!C.isPdf({mime: '', filename: 'paper.caj'}));
  assert.ok(!C.isPdf({mime: 'text/plain', filename: 'notes.txt'}));
});
test('DOI 包含括号、编码和 pdf 路由', () => {
  assert.equal(C.doi('https://x/doi/pdf/10.1000/foo(2024)'), '10.1000/foo(2024)');
  assert.equal(C.doi('https://x/10.1000%2Ffoo.pdf?token=1'), '10.1000/foo');
  assert.equal(C.doi('https://x/10.1000/foo/epdf'), '10.1000/foo');
});
const now = Date.now();
const ctx = (patch = {}) => ({kind: 'page', pageUrl: 'https://journal.test/article', time: now, meta: {title: 'A'}, ...patch});
test('下载与准确来源匹配，不根据活动标签猜测', () => {
  assert.equal(C.selectContext({url: 'https://x/file.pdf', referrer: 'https://journal.test/article'}, [ctx()], now).meta.title, 'A');
  assert.equal(C.selectContext({url: 'https://unrelated/file.pdf'}, [ctx()], now), null);
  assert.equal(C.selectContext({url: 'https://x/file.pdf', referrer: 'https://other/'}, [ctx()], now), null);
});
test('单条点击优先于页面，搜索结果记录隔离', () => {
  const record = ctx({kind: 'click', targetUrl: 'https://x/A.pdf', meta: {title: 'Record A'}});
  assert.equal(C.selectContext({url: 'https://x/A.pdf', referrer: 'https://journal.test/article'}, [ctx(), record], now).meta.title, 'Record A');
});
test('多条记录同一下载地址时不猜测', () => {
  const a = ctx({kind: 'click', targetUrl: 'https://x/getpdf', meta: {title: 'A'}});
  const b = ctx({kind: 'click', targetUrl: 'https://x/getpdf', meta: {title: 'B'}});
  assert.equal(C.selectContext({url: 'https://x/getpdf'}, [a,b], now), null);
});
test('跨站来源仅剩域名时，需有唯一且近期的下载点击', () => {
  const a = ctx({kind: 'click', downloadHint: true, targetUrl: '', meta: {title: 'A'}});
  const item = {url: 'https://cdn.test/opaque', referrer: 'https://journal.test/'};
  assert.equal(C.selectContext(item, [a], now).meta.title, 'A');
  assert.equal(C.selectContext(item, [ctx()], now), null);
  assert.equal(C.selectContext(item, [a, {...a, meta: {title: 'B'}}], now), null);
});
test('过期上下文不使用，隐私窗口隔离', () => {
  assert.equal(C.selectContext({referrer: 'https://journal.test/article'}, [ctx({time: now - 31 * 60000})], now), null);
  assert.equal(C.selectContext({referrer: 'https://journal.test/article', incognito: true}, [ctx({incognito: false})], now), null);
});
test('PDF 阅读器 URL 通过 citation_pdf_url 追溯', () => {
  const page = ctx({meta: {title: 'A', pdfUrls: ['https://cdn.test/A.pdf']}});
  assert.equal(C.selectContext({url: 'https://cdn.test/A.pdf'}, [page], now).meta.title, 'A');
});
test('NLM 离线字典覆盖真实期刊，来源和数量可核对', () => {
  const db = require('../extension/data/journals.json');
  assert.ok(db.records > 40000);
  assert.equal(db.titles[C.journalKey('Nature Medicine')], 'Nat Med');
  assert.equal(db.titles[C.journalKey('ACS Nano')], 'ACS Nano');
  assert.equal(db.titles[C.journalKey('Journal of Bone and Mineral Research')], 'J Bone Miner Res');
  assert.ok(db.issns['1078-8956']);
});
test('普通博客 Article JSON-LD 不触发文献命名', () => {
  require('../extension/lib/extract.js');
  const doc = data => ({querySelector: () => null, querySelectorAll: selector => selector === 'script[type="application/ld+json"]' ? [{textContent: JSON.stringify(data)}] : []});
  assert.equal(globalThis.PaperExtract.extract(doc({'@type': 'Article', headline: 'News headline', datePublished: '2024'}), 'https://news.test/'), null);
  assert.equal(globalThis.PaperExtract.extract(doc({'@type': 'ScholarlyArticle', headline: 'Paper title', datePublished: '2024'}), 'https://journal.test/').title, 'Paper title');
});
