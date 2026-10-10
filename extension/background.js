importScripts('lib/core.js');
'use strict';
const C = PaperCore;
let serial = Promise.resolve(), journalIndex, nextApiTime = 0;
const pendingLookups = new Map();
function queue(job) {const task = serial.then(job, job); serial = task.catch(() => {}); return task;}
async function settings() {return {...C.defaults, ...(await chrome.storage.local.get('settings')).settings};}
async function index() {
  journalIndex ||= fetch(chrome.runtime.getURL('data/journals.json')).then(r => r.json()).catch(() => ({titles: {}, issns: {}}));
  return journalIndex;
}
async function abbreviate(meta, config) {
  const db = await index();
  const alias = config.aliases?.[C.journalKey(meta.journal)] || config.aliases?.[meta.issn];
  return {...meta, abbreviation: alias || meta.abbreviation || db.issns[meta.issn] || db.titles[C.journalKey(meta.journal)] || ''};
}
async function apiJson(url) {
  // NCBI requests are spaced below the unauthenticated 3 requests/second limit.
  const wait = Math.max(0, nextApiTime - Date.now());
  if (wait > 2000) throw new Error('Metadata service busy');
  nextApiTime = Date.now() + wait + 400;
  if (wait) await new Promise(r => setTimeout(r, wait));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  try {
    const response = await fetch(url, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new Error('Metadata unavailable');
    return await response.json();
  } finally {clearTimeout(timeout);}
}
async function lookup(doi, pmid) {
  const key = doi ? 'doi:' + doi.toLowerCase() : 'pmid:' + pmid;
  const cached = (await chrome.storage.local.get('metadataCache')).metadataCache || {};
  if (cached[key] && Date.now() - cached[key].time < 30 * 86400000) return cached[key].meta;
  if (pendingLookups.has(key)) return pendingLookups.get(key);
  const job = (async () => {
    let meta;
    if (doi) {
      const {message: m} = await apiJson('https://api.crossref.org/works/' + encodeURIComponent(doi));
      if (!m || C.doi(m.DOI).toLowerCase() !== doi.toLowerCase()) throw new Error('DOI mismatch');
      const date = m['published-print'] || m['published'] || m['published-online'] || m['issued'];
      meta = {doi, title: C.clean(m.title?.[0]), journal: C.clean(m['container-title']?.[0]), abbreviation: C.clean(m['short-container-title']?.[0]), year: C.year(date?.['date-parts']?.[0]?.[0]), issn: m.ISSN?.[0] || ''};
    } else {
      const data = await apiJson('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + encodeURIComponent(pmid));
      const m = data.result?.[pmid];
      if (!m || m.uid !== pmid) throw new Error('PMID mismatch');
      meta = {pmid, title: C.clean(m.title), journal: C.clean(m.fulljournalname), abbreviation: C.clean(m.source), year: C.year(m.pubdate), issn: m.issn || m.essn || '', doi: m.articleids?.find(a => a.idtype === 'doi')?.value || ''};
    }
    await queue(async () => {
      const current = (await chrome.storage.local.get('metadataCache')).metadataCache || {};
      current[key] = {meta, time: Date.now()};
      const entries = Object.entries(current).sort((a, b) => b[1].time - a[1].time).slice(0, 200);
      await chrome.storage.local.set({metadataCache: Object.fromEntries(entries)});
    });
    return meta;
  })();
  pendingLookups.set(key, job);
  try {return await job;} finally {pendingLookups.delete(key);}
}
async function enrich(meta, config) {
  let result = await abbreviate(meta, config);
  if (config.online && (result.doi || result.pmid) && (!result.title || !result.year || !result.journal || !result.abbreviation)) {
    try {
      const extra = await lookup(result.doi, result.pmid);
      if (!result.abbreviation) {
        const db = await index();
        extra.abbreviation = db.issns[extra.issn] || db.titles[C.journalKey(extra.journal)] || extra.abbreviation;
      }
      result = C.merge(result, extra);
    } catch (_) {}
  }
  return abbreviate(result, config);
}
async function remember(message, sender) {
  if (!sender.tab || !/^https?:/.test(message.pageUrl || '')) return;
  await queue(async () => {
    const stored = await chrome.storage.session.get(['contexts', 'overrides']);
    let contexts = (stored.contexts || []).filter(c => Date.now() - c.time < 30 * 60000);
    const tabId = sender.tab.id, frameId = sender.frameId || 0;
    if (message.type === 'PAGE') contexts = contexts.filter(c => !(c.tabId === tabId && c.frameId === frameId && c.kind === 'page'));
    if (message.meta) {
      const override = stored.overrides?.[tabId];
      const meta = override && C.urlKey(override.pageUrl) === C.urlKey(message.pageUrl) ? {...message.meta, ...override.meta} : message.meta;
      contexts.push({tabId, frameId, incognito: !!sender.tab.incognito, kind: message.type === 'CLICK' ? 'click' : 'page', pageUrl: message.pageUrl, targetUrl: message.targetUrl || '', downloadHint: !!message.downloadHint, meta, time: Date.now()});
    }
    await chrome.storage.session.set({contexts: contexts.slice(-180)});
  });
}
async function history(entry) {
  await queue(async () => {
    const old = (await chrome.storage.local.get('history')).history || [];
    await chrome.storage.local.set({history: [entry, ...old.filter(x => x.id !== entry.id)].slice(0, 12)});
  });
}
async function resolveDownload(item) {
  const config = await settings();
  if (!config.enabled) return;
  const {contexts = []} = await chrome.storage.session.get('contexts');
  const context = C.selectContext(item, contexts);
  let meta = context?.meta || {};
  // A DOI in the download URL is stronger evidence than referrer metadata.
  const downloadDoi = C.doi(item.url) || C.doi(item.finalUrl);
  if (downloadDoi && meta.doi && downloadDoi.toLowerCase() !== meta.doi.toLowerCase()) meta = {doi: downloadDoi};
  else if (downloadDoi) meta = C.merge(meta, {doi: downloadDoi});
  if (!meta.title && !meta.doi && !meta.pmid) {
    if (!item.incognito) await history({id: item.id, original: item.filename.split(/[\\/]/).pop(), reason: '未找到可靠的论文信息，保留原名', time: Date.now()});
    return;
  }
  meta = await enrich(meta, config);
  const filename = C.filename(meta, config);
  if (!filename) return;
  if (!item.incognito) await history({id: item.id, filename, original: item.filename.split(/[\\/]/).pop(), reason: (!meta.year || !meta.journal) ? '使用已识别的字段，缺失字段已省略' : (!meta.abbreviation ? '未找到可靠缩写，使用期刊全名' : '已建议按文献信息命名'), time: Date.now(), meta});
  return {filename, conflictAction: 'uniquify'};
}
// Register synchronously so an MV3 service worker can wake for download events.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!C.isPdf(item) || /(?:supplement|suppl|suppinfo|appendix|esm\d+|mmc\d+)/i.test(item.url || '')) {suggest(); return;}
  let finished = false;
  const finish = result => {if (!finished) {finished = true; clearTimeout(timeout); suggest(result);}};
  const timeout = setTimeout(() => finish(), 6500);
  resolveDownload(item).then(finish, () => finish());
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (!delta.filename && !delta.state) return;
  queue(async () => {
    const {history: entries = []} = await chrome.storage.local.get('history');
    const entry = entries.find(x => x.id === delta.id);
    if (!entry) return;
    if (delta.filename) entry.actualFilename = delta.filename.current.split(/[\\/]/).pop();
    if (delta.state) entry.state = delta.state.current;
    await chrome.storage.local.set({history: entries});
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  queue(async () => {
    const {contexts = [], overrides = {}} = await chrome.storage.session.get(['contexts', 'overrides']);
    delete overrides[tabId];
    await chrome.storage.session.set({contexts: contexts.filter(c => c.tabId !== tabId), overrides});
  }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (['PAGE', 'CLICK'].includes(message.type)) {remember(message, sender).then(() => reply({ok: true}), () => reply({ok: false})); return true;}
  // Page scripts cannot change settings or read local download history.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  (async () => {
    if (message.type === 'STATE') {
      const config = await settings();
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const {contexts = [], overrides = {}} = await chrome.storage.session.get(['contexts', 'overrides']);
      let meta;
      try {meta = await chrome.tabs.sendMessage(tab.id, {type: 'EXTRACT'}, {frameId: 0});} catch (_) {}
      meta ||= contexts.filter(c => c.tabId === tab?.id && c.frameId === 0 && C.urlKey(c.pageUrl) === C.urlKey(tab.url)).sort((a, b) => b.time - a.time)[0]?.meta;
      if (overrides[tab?.id] && C.urlKey(overrides[tab.id].pageUrl) === C.urlKey(tab.url)) meta = {...meta, ...overrides[tab.id].meta};
      meta = meta ? await enrich(meta, config) : null;
      const {history: entries = []} = await chrome.storage.local.get('history');
      return {config, meta, tabId: tab?.id, pageUrl: tab?.url, history: entries};
    }
    if (message.type === 'SETTINGS') {
      const old = await settings();
      const next = {...old, ...message.config};
      if (!['journal-year-title', 'year-journal-title', 'title-year-journal'].includes(next.order)) next.order = C.defaults.order;
      await chrome.storage.local.set({settings: next});
      return {ok: true};
    }
    if (message.type === 'OVERRIDE') {
      const tab = await chrome.tabs.get(message.tabId);
      if (C.urlKey(tab.url) !== C.urlKey(message.pageUrl)) throw new Error('页面已切换，请刷新插件');
      const meta = {title: C.clean(message.meta.title), journal: C.clean(message.meta.journal), abbreviation: C.clean(message.meta.abbreviation), year: C.year(message.meta.year), doi: C.doi(message.meta.doi), pdfUrls: message.meta.pdfUrls || []};
      if (!meta.title) throw new Error('请填写文章标题');
      await queue(async () => {
        const {contexts = [], overrides = {}} = await chrome.storage.session.get(['contexts', 'overrides']);
        overrides[tab.id] = {pageUrl: tab.url, meta};
        for (const c of contexts) if (c.tabId === tab.id && C.urlKey(c.pageUrl) === C.urlKey(tab.url)) c.meta = {...c.meta, ...meta};
        if (!contexts.some(c => c.tabId === tab.id && c.kind === 'page' && C.urlKey(c.pageUrl) === C.urlKey(tab.url))) contexts.push({tabId: tab.id, frameId: 0, incognito: !!tab.incognito, kind: 'page', pageUrl: tab.url, meta, time: Date.now()});
        await chrome.storage.session.set({contexts, overrides});
      });
      return {ok: true};
    }
    if (message.type === 'CLEAR') {await chrome.storage.local.remove(['history', 'metadataCache']); return {ok: true};}
    throw new Error('Unknown message');
  })().then(reply, error => reply({error: error.message}));
  return true;
});
