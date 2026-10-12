(function (root) {
  'use strict';
  const MAX_BYTES = 50 * 1024 * 1024;
  function eligible(value, pageUrl) {
    try {
      const url = new URL(value, pageUrl), page = new URL(pageUrl);
      return /^https?:$/.test(url.protocol) && url.origin === page.origin && !url.username && !url.password &&
        !/(?:supplement|suppinfo|appendix|\/esm\d+|\/mmc\d+)/i.test(url.href);
    } catch (_) {return false;}
  }
  function directPdf(anchor, pageUrl) {
    return anchor && eligible(anchor.href, pageUrl) &&
      (/\.pdf(?:[?#]|$)/i.test(anchor.href) || /\.pdf$/i.test(anchor.getAttribute('download') || '')) &&
      !/supplement|appendix|补充|附件/i.test(anchor.textContent || '');
  }
  async function readPdf(response) {
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('PDF 不可读取或超过 50 MB');
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type && !['application/pdf', 'application/x-pdf', 'application/octet-stream', 'binary/octet-stream'].includes(type)) throw new Error('返回内容不是 PDF');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('浏览器无法读取 PDF 数据');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('PDF 超过 50 MB');
        chunks.push(value);
      }
    } catch (error) {await reader.cancel().catch(() => {}); throw error;}
    const blob = new Blob(chunks, {type: 'application/pdf'});
    const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
    if (!new TextDecoder().decode(head).includes('%PDF-')) throw new Error('文件缺少 PDF 标识');
    return blob;
  }
  root.PaperDownload = {eligible, directPdf, readPdf, MAX_BYTES};
  if (typeof module !== 'undefined') module.exports = root.PaperDownload;
})(globalThis);
