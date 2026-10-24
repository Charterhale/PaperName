(function (root) {
  'use strict';
  const C = root.PaperCore;
  const text = (doc, selectors) => {for (const selector of selectors) {const value = C.clean(doc.querySelector(selector)?.textContent); if (value) return value;} return '';};
  function extract(doc, pageUrl) {
    const url = new URL(pageUrl), host = url.hostname;
    const values = {};
    for (const el of doc.querySelectorAll('meta[name],meta[property]')) {
      const key = (el.getAttribute('name') || el.getAttribute('property') || '').toLowerCase();
      const value = C.clean(el.getAttribute('content'));
      if (value) (values[key] ||= []).push(value);
    }
    const get = (...keys) => keys.flatMap(k => values[k] || [])[0] || '';
    const meta = {
      title: get('citation_title', 'dc.title', 'dc.title.alternative', 'dcterms.title', 'prism.title'),
      journal: get('citation_journal_title', 'prism.publicationname', 'dc.source', 'dc.source.title', 'journal_title', 'journal'),
      abbreviation: get('citation_journal_abbrev', 'citation_journal_abbreviation', 'prism.publicationabbreviation'),
      year: C.year(get('citation_publication_date', 'citation_date', 'dc.date', 'dcterms.issued', 'prism.publicationdate', 'publication_date')),
      doi: C.doi(get('citation_doi', 'prism.doi', 'dc.identifier', 'dc.identifier.doi')),
      pii: C.pii(get('citation_pii', 'prism.pii', 'pii', 'dc.identifier')),
      pmid: get('citation_pmid'), issn: get('citation_issn', 'prism.issn'),
      pdfUrls: (values.citation_pdf_url || []).map(v => {try {return new URL(v, pageUrl).href;} catch (_) {return '';}}).filter(Boolean)
    };
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const nodes = Array.isArray(data) ? data : [...(data['@graph'] || []), data];
        const article = nodes.find(n => [].concat(n?.['@type'] || []).some(t => /^(ScholarlyArticle|MedicalScholarlyArticle|Article)$/.test(t)));
        if (!article) continue;
        const scholarly = [].concat(article['@type']).some(t => /ScholarlyArticle$/.test(t));
        const identifierDoi = C.doi(article.identifier?.value || article.sameAs || article['@id']);
        let periodical = article.isPartOf, hasPeriodical = false;
        for (let i = 0; periodical && i < 5; i++, periodical = periodical.isPartOf) if (periodical['@type'] === 'Periodical') hasPeriodical = true;
        // Ordinary news/blog Article markup does not identify a scholarly paper.
        if (!scholarly && !meta.journal && !meta.doi && !identifierDoi && !hasPeriodical) continue;
        meta.title ||= C.clean(article.headline || article.name);
        meta.year ||= C.year(article.datePublished);
        let container = article.isPartOf;
        for (let i = 0; container && i < 5; i++, container = container.isPartOf) {
          if (container['@type'] === 'Periodical') {meta.journal ||= C.clean(container.name); meta.issn ||= C.clean([].concat(container.issn || [])[0]); break;}
        }
        meta.doi ||= C.doi(article.identifier?.value || article.sameAs || article['@id']);
      } catch (_) {}
    }
    const pubmed = /(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/.test(host);
    if (pubmed && /^\/\d+\/?$/.test(url.pathname)) {
      meta.pmid ||= url.pathname.match(/\d+/)[0];
      meta.title ||= text(doc, ['h1.heading-title']);
      meta.abbreviation ||= text(doc, ['.journal-actions-trigger']);
      meta.journal ||= doc.querySelector('.journal-actions-trigger')?.getAttribute('title') || '';
      meta.year ||= C.year(text(doc, ['.cit']));
      meta.doi ||= C.doi(text(doc, ['.identifiers .doi .id-link', '.doi .id-link']));
    }
    if (/(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/.test(host)) {
      meta.title ||= text(doc, ['h1.content-title', '.article-title', 'h1']);
      meta.year ||= C.year(text(doc, ['.citation']));
      meta.doi ||= C.doi(text(doc, ['.doi a']));
    }
    const chinese = /(^|\.)(cnki\.net|cnki\.com\.cn|wanfangdata\.com\.cn)$/.test(host);
    if (chinese) {
      meta.title ||= get('title') || text(doc, ['.wx-tit h1', '.brief h1', '.detailTitle', '.detail-title', '.title h1', 'h1']);
      meta.journal ||= text(doc, ['.top-tip .journal', '.journal-title', '.periodical-title']);
      meta.year ||= C.year(get('year', 'publishdate', 'publish_date'));
      // Read labelled citation fields, never the references at the end of the page.
      for (const el of doc.querySelectorAll('.row, .info-row, .basicInfo li, .basic-info li, .wxBaseinfo p, .wxBaseinfo li')) {
        const value = C.clean(el.textContent);
        if (value.length > 300) continue;
        const journal = value.match(/^(?:来源|刊名|期刊名称|期刊)\s*[:：]\s*(.+)$/);
        if (journal) meta.journal ||= journal[1].replace(/\s*\d{4}.*$/, '').trim();
        if (/^(?:发表时间|出版时间|出版日期|年卷期|年份|年期)\s*[:：]/.test(value)) meta.year ||= C.year(value);
        if (/^DOI\s*[:：]/i.test(value)) meta.doi ||= C.doi(value);
      }
    }
    if (/(^|\.)webofscience\.com$/.test(host) && /full-record/i.test(url.pathname)) {
      meta.title ||= text(doc, ['[data-ta="FullRTa-title"]', '.title.value', 'h1']);
      meta.journal ||= text(doc, ['[data-ta="FullRTa-sourceTitle"]', '.source-title']);
      meta.year ||= C.year(text(doc, ['[data-ta="FullRTa-pubdate"]', '[data-ta="FullRTa-publicationDate"]']));
      meta.doi ||= C.doi(text(doc, ['[data-ta="FullRTa-DOI"]']));
    }
    // A citation title alone is still useful. An ordinary web page title is never used.
    if (!meta.title && (meta.doi || meta.journal)) meta.title = text(doc, ['h1']) || get('og:title');
    if (!meta.doi && meta.title) meta.doi = C.doi(pageUrl);
    meta.title = C.clean(meta.title);
    meta.journal = C.clean(meta.journal);
    meta.abbreviation = C.clean(meta.abbreviation);
    if (meta.title && meta.pdfUrls.length === 0) {
      for (const a of doc.querySelectorAll('a[href]')) {
        if (a.closest('.references, .ref-list, .bibliography, [role="doc-bibliography"], [id*="reference"], [id*="Reference"]')) continue;
        if (/\.pdf(?:[?#]|$)|\/doi\/(?:e?pdf)\//i.test(a.href) && !/supp|appendix|补充|附件/i.test(a.textContent + a.href)) meta.pdfUrls.push(a.href);
        if (meta.pdfUrls.length >= 20) break;
      }
    }
    return meta.title || meta.doi || meta.pmid ? meta : null;
  }
  function clicked(doc, el, pageUrl) {
    const anchor = el.closest('a[href]');
    const host = new URL(pageUrl).hostname;
    if (/(^|\.)scholar\.google\./.test(host)) {
      const row = el.closest('.gs_r');
      if (row && anchor) {
        const title = text(row, ['.gs_rt a', '.gs_rt']).replace(/^\[(?:PDF|HTML|引用|CITATION|BOOK)\]\s*/i, '');
        if (!title) return null;
        const byline = text(row, ['.gs_a']);
        const source = byline.split(/\s[-–]\s/)[1] || '';
        const rawJournal = source.replace(/,?\s*\b(?:18|19|20|21)\d{2}\b.*$/, '').trim();
        const meta = {title, year: C.year(source), journal: /[…]|\.{3}/.test(rawJournal) ? '' : rawJournal, doi: C.doi(anchor.href), pdfUrls: []};
        return {meta, targetUrl: anchor.href, downloadHint: /pdf|下载|download/i.test(anchor.textContent + anchor.href) || !!anchor.closest('.gs_or_ggsm')};
      }
      return null;
    }
    const meta = extract(doc, pageUrl);
    if (!meta) return null;
    if (!anchor) {
      const button = el.closest('button, input[type="submit"], [role="button"], form');
      if (!button || !/pdf|下载|download/i.test(button.textContent + (button.getAttribute('value') || ''))) return null;
      const form = button.closest('form');
      const target = button.getAttribute('data-url') || form?.getAttribute('action');
      let targetUrl = '';
      try {if (target) targetUrl = new URL(target, pageUrl).href;} catch (_) {}
      return {meta, targetUrl, downloadHint: true};
    }
    if (/supplement|suppinfo|appendix|补充材料|附件/i.test(anchor.textContent + anchor.href)) return null;
    return {meta, targetUrl: anchor.href, downloadHint: /pdf|下载|download/i.test(anchor.textContent + anchor.href) || anchor.hasAttribute('download')};
  }
  root.PaperExtract = {extract, clicked};
})(globalThis);
