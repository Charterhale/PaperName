(function (root) {
  'use strict';
  const defaults = {enabled: true, order: 'journal-year-title', online: true, aliases: {}};
  const clean = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const journalKey = value => clean(value).normalize('NFKC').toLowerCase().replace(/[.,:;\s&\-–—]+/g, '');
  function year(value) {
    return clean(value).match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/)?.[1] || '';
  }
  function doi(value) {
    let str = String(value || '');
    try {str = decodeURIComponent(str);} catch (_) {}
    // Do not use a page's reference list. Call this only on explicit DOI fields or URLs.
    return str.match(/10\.\d{4,9}\/[^\s<>"?#]+/i)?.[0].replace(/(?:\/pdf|\/full|\/epdf|\.pdf)$/i, '').replace(/[.,;]+$/, '') || '';
  }
  function urlKey(value) {
    try {const u = new URL(value); u.hash = ''; return u.href;} catch (_) {return '';}
  }
  function sanitize(value) {
    let text = clean(value).normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').replace(/^[.\s]+|[.\s]+$/g, '').trim();
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text)) text = '_' + text;
    return text;
  }
  function byteTrim(value, limit) {
    let result = '', bytes = 0;
    for (const ch of value) {const count = new TextEncoder().encode(ch).length; if (bytes + count > limit) break; result += ch; bytes += count;}
    return result.replace(/[.\s-]+$/, '');
  }
  function filename(meta, settings = defaults) {
    if (!meta?.title) return '';
    const parts = {title: sanitize(meta.title).replace(/\.pdf$/i, ''), year: year(meta.year), journal: sanitize(meta.abbreviation || meta.journal)};
    if (!parts.title) return '';
    const order = ['journal-year-title', 'year-journal-title', 'title-year-journal'].includes(settings.order) ? settings.order : defaults.order;
    // Cap the filename in UTF-8 bytes (including Chinese), preserving year and journal.
    parts.journal = byteTrim(parts.journal, 65);
    const suffixBytes = new TextEncoder().encode([parts.year, parts.journal].filter(Boolean).join('-')).length;
    parts.title = byteTrim(parts.title, 220 - suffixBytes - 6);
    return order.split('-').map(p => parts[p]).filter(Boolean).join('-') + '.pdf';
  }
  function isPdf(item) {
    const mime = (item.mime || '').toLowerCase().split(';')[0].trim();
    if (['application/pdf', 'application/x-pdf'].includes(mime)) return true;
    // An explicit non-PDF MIME prevents renaming an HTML error or a CAJ file.
    if (mime && !['application/octet-stream', 'binary/octet-stream'].includes(mime)) return false;
    return /\.pdf$/i.test(item.filename || '') || [item.url, item.finalUrl].some(v => /\.pdf(?:[?#]|$)/i.test(v || ''));
  }
  function merge(base, extra) {
    const out = {...base};
    for (const key of ['title', 'journal', 'abbreviation', 'year', 'doi', 'pmid', 'issn']) if (!out[key] && extra?.[key]) out[key] = extra[key];
    return out;
  }
  function selectContext(item, contexts, now = Date.now()) {
    const urls = [item.url, item.finalUrl].map(urlKey).filter(Boolean);
    const ref = urlKey(item.referrer);
    const fresh = contexts.filter(c => c?.meta && now - c.time < 30 * 60 * 1000 && (!c.incognito === !item.incognito));
    // Exact clicked-link matching wins. Never infer a download from the active tab.
    const exact = fresh.filter(c => c.kind === 'click' && now - c.time < 90000 && urls.includes(urlKey(c.targetUrl)));
    const unique = candidates => {
      const ids = new Set(candidates.map(c => (c.meta.doi || c.meta.pmid || journalKey(c.meta.title))));
      return ids.size === 1 ? candidates.sort((a, b) => b.time - a.time)[0] : null;
    };
    if (exact.length) return unique(exact);
    // A click inside a search result is scoped to that record, never to the whole results page.
    const matchesReferrer = pageUrl => {
      if (!ref) return false;
      if (urlKey(pageUrl) === ref) return true;
      try {const r = new URL(ref), p = new URL(pageUrl); return r.pathname === '/' && !r.search && r.origin === p.origin;} catch (_) {return false;}
    };
    const clicks = fresh.filter(c => c.kind === 'click' && now - c.time < 15000 && c.downloadHint && matchesReferrer(c.pageUrl));
    if (clicks.length) return unique(clicks);
    const pdf = fresh.filter(c => (c.meta.pdfUrls || []).some(v => urls.includes(urlKey(v)) || (ref && urlKey(v) === ref)));
    if (pdf.length) return unique(pdf);
    if (ref) return unique(fresh.filter(c => c.kind === 'page' && urlKey(c.pageUrl) === ref));
    return null;
  }
  root.PaperCore = {defaults, clean, journalKey, year, doi, urlKey, sanitize, byteTrim, filename, isPdf, merge, selectContext};
  if (typeof module !== 'undefined') module.exports = root.PaperCore;
})(globalThis);
