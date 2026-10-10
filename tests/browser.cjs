// Edge isolated profile integration: real downloads and MV3 service worker, no user profile access.
const {chromium} = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), ext = path.join(root, 'extension');
const artifacts = path.resolve(root, process.env.PAPERNAME_TEST_ARTIFACTS_DIR || '.artifacts');
fs.mkdirSync(artifacts, {recursive: true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'papername-edge-'));
fs.mkdirSync(path.join(profile, 'Default'), {recursive: true});
fs.mkdirSync(path.join(profile, 'downloads'), {recursive: true});
fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({download: {default_directory: path.join(profile, 'downloads'), prompt_for_download: false}}));
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
const article = (title, journal, year, links) => `<!doctype html><meta name="citation_title" content="${title}"><meta name="citation_journal_title" content="${journal}"><meta name="citation_publication_date" content="${year}"><h1>${title}</h1>${links}`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/file') || req.url.startsWith('/opaque')) {res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="original.pdf"'}); res.end(pdf);}
  else if (req.url === '/redirect') {res.writeHead(302, {Location: '/file-redirect.pdf'}); res.end();}
  else if (req.url === '/a') {res.end(article('Joint aging: a study', 'Nature Medicine', '2024/06/01', '<a id="pdf" href="/file-a.pdf">Download PDF</a>'));}
  else if (req.url === '/b') {res.end(article('Another article', 'ACS Nano', '2025', '<a id="pdf" href="/file-b.pdf">PDF</a>'));}
  else if (req.url === '/dynamic') {res.end(article('Before', 'Cell', '2020', '<button id="change" onclick="document.querySelector(\'[name=citation_title]\').content=\'After\'">Change</button><a id="pdf" href="/file-dynamic.pdf">PDF</a>'));}
  else if (req.url === '/redirect-page') {res.end(article('Redirect article', 'Cell', '2023', '<a id="pdf" href="/redirect">PDF</a>'));}
  else if (req.url === '/post') {res.end(article('POST generated paper', 'Science', '2022', '<form method="post" action="/opaque"><button id="pdf">Download PDF</button></form>'));}
  else {res.end('<!doctype html><h1>Ordinary web page</h1><a id="pdf" href="/file-unknown.pdf">PDF</a>');}
});
let context;
const results = [];
async function check(name, fn) {await fn(); results.push(name); console.log('PASS ' + name);}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  context = await chromium.launchPersistentContext(profile, {...(process.env.PAPERNAME_BROWSER_PATH ? {executablePath: process.env.PAPERNAME_BROWSER_PATH} : {channel: process.env.PAPERNAME_BROWSER_CHANNEL || 'msedge'}), headless: false, acceptDownloads: true, args: ['--headless=new', '--disable-extensions-except=' + ext, '--load-extension=' + ext, '--no-first-run']});
  // Playwright's allowAndName bypasses Chrome filename determination. Restore native downloads.
  const cdp = await context.newCDPSession(context.pages()[0]);
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'default'});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', msg => console.log('WORKER ' + msg.text()));
  const extensionId = worker.url().split('/')[2];
  await worker.evaluate(async () => {await chrome.storage.local.clear(); await chrome.storage.session.clear(); await chrome.storage.local.set({settings: {enabled: true, online: false, order: 'journal-year-title', aliases: {}}});});
  const page = await context.newPage();
  const download = async (pathname, expected) => {
    await page.goto(base + pathname);
    await page.waitForTimeout(650);
    const previousId = await worker.evaluate(async () => (await chrome.downloads.search({limit: 1, orderBy: ['-startTime']}))[0]?.id || 0);
    await page.locator('#pdf').click({noWaitAfter: true});
    let downloaded;
    for (let i = 0; i < 100; i++) {
      downloaded = await worker.evaluate(async () => (await chrome.downloads.search({limit: 1, orderBy: ['-startTime']}))[0]);
      if (downloaded?.id > previousId && downloaded?.state === 'complete' && downloaded.url.startsWith(base)) break;
      await page.waitForTimeout(100);
    }
    assert.equal(downloaded.state, 'complete');
    const diagnostics = await worker.evaluate(async () => ({local: await chrome.storage.local.get(['history']), session: await chrome.storage.session.get('contexts'), downloads: await chrome.downloads.search({limit: 1, orderBy: ['-startTime']})}));
    const actual = diagnostics.downloads[0]?.filename.split(/[\\/]/).pop();
    if (actual !== expected && actual !== expected.replace(/\.pdf$/, ' (1).pdf')) console.log(JSON.stringify({diagnostics}));
    assert.equal(actual.replace(/ \(\d+\)(?=\.pdf$)/, ''), expected);
    assert.ok(diagnostics.downloads[0].filename.startsWith(path.join(profile, 'downloads')));
  };
  await check('MV3 加载与真实 PDF 下载自动命名', () => download('/a', 'Nat Med-2024-Joint aging a study.pdf'));
  await check('第二篇论文与第一篇独立关联', () => download('/b', 'ACS Nano-2025-Another article.pdf'));
  await worker.evaluate(async () => {const {settings} = await chrome.storage.local.get('settings'); await chrome.storage.local.set({settings: {...settings, order: 'year-journal-title'}});});
  await check('年份在前', () => download('/a', '2024-Nat Med-Joint aging a study.pdf'));
  await worker.evaluate(async () => {const {settings} = await chrome.storage.local.get('settings'); await chrome.storage.local.set({settings: {...settings, order: 'title-year-journal'}});});
  await check('标题在前', () => download('/b', 'Another article-2025-ACS Nano.pdf'));
  await worker.evaluate(async () => {const {settings} = await chrome.storage.local.get('settings'); await chrome.storage.local.set({settings: {...settings, order: 'journal-year-title'}});});
  await check('重定向 PDF', () => download('/redirect-page', 'Cell-2023-Redirect article.pdf'));
  await check('POST 表单和不含 pdf 的下载地址', () => download('/post', 'Science-2022-POST generated paper.pdf'));
  await check('未知页面不误用上一篇论文', () => download('/unknown', 'original.pdf'));
  await check('SPA 页面元数据变更', async () => {
    await page.goto(base + '/dynamic'); await page.locator('#change').click(); await page.waitForTimeout(800);
    await page.locator('#pdf').click({noWaitAfter: true}); await page.waitForTimeout(500);
    const name = await worker.evaluate(async () => (await chrome.downloads.search({limit: 1, orderBy: ['-startTime']}))[0].filename);
    assert.equal(path.basename(name), 'Cell-2020-After.pdf');
  });
  const popup = await context.newPage();
  await popup.setViewportSize({width: 430, height: 880});
  await popup.goto('chrome-extension://' + extensionId + '/popup.html');
  await worker.evaluate(async () => {const tabs = await chrome.tabs.query({}); const paper = tabs.find(t => t.url?.endsWith('/dynamic')); await chrome.tabs.update(paper.id, {active: true});});
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => document.getElementById('status').textContent !== '正在读取当前页面…');
  await popup.screenshot({path: path.join(artifacts, '界面预览.png'), fullPage: true});
  await check('设置界面切换与持久化', async () => {
    await popup.locator('[value="year-journal-title"]').check();
    await popup.waitForFunction(() => document.getElementById('notice').textContent.includes('保存'));
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.order), 'year-journal-title');
  });
  await check('关闭自动命名', async () => {
    await popup.locator('#enabled').uncheck(); await popup.waitForTimeout(300);
    await download('/a', 'original.pdf');
  });
  await popup.locator('#enabled').check(); await popup.waitForTimeout(300);
  await check('自定义期刊缩写', async () => {
    await popup.locator('details').first().locator('summary').click();
    await popup.locator('#aliases').fill('Nature Medicine = NM'); await popup.locator('#save-aliases').click(); await popup.waitForTimeout(300);
    await download('/a', '2024-NM-Joint aging a study.pdf');
  });
  await check('本页手动纠正与其它页面隔离', async () => {
    await popup.locator('#refresh').click(); await popup.waitForTimeout(400);
    await popup.locator('#title').fill('Corrected title'); await popup.locator('#year').fill('2026'); await popup.locator('#abbreviation').fill('NM');
    await popup.locator('#apply').click(); await popup.waitForFunction(() => document.getElementById('notice').textContent.includes('关联'));
    await download('/a', '2026-NM-Corrected title.pdf');
    await download('/b', '2025-ACS Nano-Another article.pdf');
  });
  const extraction = await context.newPage();
  await extraction.goto(base + '/unknown');
  await extraction.addScriptTag({path: path.join(ext, 'lib/core.js')});
  await extraction.addScriptTag({path: path.join(ext, 'lib/extract.js')});
  const parse = async (html, url, selector) => extraction.evaluate(({html,url,selector}) => {const doc = new DOMParser().parseFromString(html, 'text/html'); return selector ? PaperExtract.clicked(doc, doc.querySelector(selector), url) : PaperExtract.extract(doc, url);}, {html,url,selector});
  await check('PubMed DOM 文献信息', async () => {
    const m = await parse('<h1 class="heading-title">A pubmed article</h1><span class="journal-actions-trigger" title="Nature medicine">Nat Med</span><span class="cit">2024 Jan;30(1)</span><span class="doi"><a class="id-link">10.1000/test</a></span>', 'https://pubmed.ncbi.nlm.nih.gov/12345/');
    assert.equal(m.pmid, '12345'); assert.equal(m.abbreviation, 'Nat Med'); assert.equal(m.year, '2024'); assert.equal(m.doi, '10.1000/test');
  });
  await check('谷歌学术单条 PDF、截断期刊不猜测', async () => {
    const m = await parse('<div class="gs_r"><div class="gs_or_ggsm"><a id="link" href="https://x/p.pdf">[PDF]</a></div><h3 class="gs_rt"><a>Chosen title</a></h3><div class="gs_a">A Smith - Nature Med…, 2024 - publisher</div></div><div class="gs_r"><h3 class="gs_rt">Other title</h3></div>', 'https://scholar.google.com/scholar?q=test', '#link');
    assert.equal(m.meta.title, 'Chosen title'); assert.equal(m.meta.year, '2024'); assert.equal(m.meta.journal, ''); assert.ok(m.downloadHint);
  });
  await check('知网标签字段', async () => {
    const m = await parse('<div class="wx-tit"><h1>软骨衰老研究</h1></div><div class="wxBaseinfo"><p>来源：中华骨科杂志</p><p>发表时间：2024-01-01</p></div>', 'https://kns.cnki.net/kcms2/article/abstract?v=1');
    assert.equal(m.title, '软骨衰老研究'); assert.equal(m.journal, '中华骨科杂志'); assert.equal(m.year, '2024');
  });
  await check('万方标准文献标签', async () => {
    const m = await parse(article('骨质疏松研究', '中华骨质疏松杂志', '2023', ''), 'https://d.wanfangdata.com.cn/periodical/example');
    assert.equal(m.title, '骨质疏松研究'); assert.equal(m.year, '2023');
  });
  await check('Web of Science 详情页选择器', async () => {
    const m = await parse('<div data-ta="FullRTa-title">WOS article</div><div data-ta="FullRTa-sourceTitle">Cell</div><div data-ta="FullRTa-pubdate">2025</div>', 'https://www.webofscience.com/wos/woscc/full-record/WOS:1');
    assert.equal(m.title, 'WOS article'); assert.equal(m.journal, 'Cell'); assert.equal(m.year, '2025');
  });
  await check('JSON-LD 与引用列表隔离', async () => {
    const m = await parse('<script type="application/ld+json">{"@type":"ScholarlyArticle","headline":"Structured paper","datePublished":"2024","isPartOf":{"@type":"PublicationIssue","isPartOf":{"@type":"Periodical","name":"Science"}}}</script><div class="references">10.9999/wrong</div>', 'https://journal.test/paper');
    assert.equal(m.title, 'Structured paper'); assert.equal(m.journal, 'Science'); assert.equal(m.doi, '');
  });
  await check('普通网页标题不被识别为论文', async () => {
    assert.equal(await parse('<title>Shopping</title><h1>Shopping</h1>', 'https://shop.test/'), null);
  });
  await popup.locator('[value="journal-year-title"]').check();
  await popup.locator('#aliases').fill(''); await popup.locator('#save-aliases').click();
  await popup.locator('#title').fill('关节衰老的单细胞图谱'); await popup.locator('#year').fill('2024');
  await popup.locator('#journal').fill('Nature Medicine'); await popup.locator('#abbreviation').fill('Nat Med');
  await popup.locator('details').first().locator('summary').click();
  await popup.screenshot({path: path.join(artifacts, '界面预览.png'), fullPage: true});
  fs.writeFileSync(path.join(artifacts, '验证结果.json'), JSON.stringify({browser: 'Microsoft Edge', browserVersion: context.browser()?.version(), date: '2026-10-10', passed: results, liveSiteValidation: false}, null, 2));
})().catch(e => {console.error(e); process.exitCode = 1;}).finally(async () => {if (context) await context.close(); server.close(); fs.rmSync(profile, {recursive: true, force: true});});
