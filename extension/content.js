(() => {
  'use strict';
  const api = PaperPlatform.api;
  let last = '', timer, enabled = true;
  api.storage.local.get('settings').then(value => {enabled = value.settings?.enabled !== false;}).catch(() => {});
  api.storage.onChanged?.addListener((changes, area) => {if (area === 'local' && changes.settings) enabled = changes.settings.newValue?.enabled !== false;});
  function send(payload) {api.runtime.sendMessage(payload).catch(() => {});}
  function publish() {
    const meta = PaperExtract.extract(document, location.href);
    const fingerprint = JSON.stringify([location.href, meta]);
    if (fingerprint !== last) {last = fingerprint; send({type: 'PAGE', pageUrl: location.href, meta});}
  }
  publish();
  const observer = new MutationObserver(() => {clearTimeout(timer); timer = setTimeout(publish, 500);});
  observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['content']});
  window.addEventListener('popstate', publish);
  window.addEventListener('hashchange', publish);
  document.addEventListener('click', event => {
    const result = PaperExtract.clicked(document, event.target instanceof Element ? event.target : event.target.parentElement, location.href);
    if (result) send({type: 'CLICK', pageUrl: location.href, ...result});
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!PaperPlatform.nativeDownloads && enabled && event.isTrusted && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        !event.defaultPrevented && !anchor?.hasAttribute('data-papername-save') && result?.meta?.title && PaperDownload.directPdf(anchor, location.href)) {
      event.preventDefault(); event.stopImmediatePropagation();
      savePdf(anchor.href, result.meta, anchor).catch(error => showSaveResult('自动命名未完成：' + error.message, anchor));
    }
  }, true);
  document.addEventListener('auxclick', event => {
    const result = PaperExtract.clicked(document, event.target, location.href);
    if (result) send({type: 'CLICK', pageUrl: location.href, ...result});
  }, true);
  function showSaveResult(text, original) {
    document.getElementById('papername-save-status')?.remove();
    const box = document.createElement('div'); box.id = 'papername-save-status'; box.setAttribute('role', 'status');
    Object.assign(box.style, {position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647', padding: '16px', maxWidth: '360px', background: '#fff', color: '#172124', boxShadow: '0 4px 24px #0003', borderRadius: '12px', font: '14px system-ui'});
    box.append(document.createTextNode(text));
    if (original) {
      const link = original.cloneNode(false); link.textContent = '按网站原方式打开'; link.setAttribute('data-papername-save', 'true');
      link.style.display = 'block'; box.append(link);
    }
    const close = document.createElement('button'); close.textContent = '关闭'; close.addEventListener('click', () => box.remove()); box.append(close);
    document.documentElement.append(box);
  }
  async function savePdf(url, meta, original) {
    if (!PaperDownload.eligible(url, location.href)) throw new Error('跨域或中转下载请复制文件名后手动保存');
    const prepared = await api.runtime.sendMessage({type: 'PREPARE_PDF', pageUrl: location.href, targetUrl: url, meta});
    if (prepared?.disabled) {if (original) {const copy = original.cloneNode(false); copy.setAttribute('data-papername-save', 'true'); copy.click();} return;}
    if (prepared?.error || !prepared?.filename) throw new Error(prepared?.error || '未找到可靠的文章标题');
    showSaveResult('正在读取 PDF…');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      // Only same-origin GET requests; existing site login remains in the browser.
      const response = await fetch(url, {credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal: controller.signal});
      const blob = await PaperDownload.readPdf(response);
      const objectUrl = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = objectUrl; a.download = prepared.filename; a.setAttribute('data-papername-save', 'true'); a.hidden = true;
      document.documentElement.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      showSaveResult('已交给 Safari 保存：' + prepared.filename);
    } finally {clearTimeout(timeout);}
  }
  PaperPlatform.listen((message, sender, reply) => {
    if (message.type === 'SAVE_PDF' && sender.id === api.runtime.id && !PaperPlatform.nativeDownloads) {
      savePdf(message.url, PaperExtract.extract(document, location.href)).then(() => reply({ok: true}), error => reply({error: error.message}));
      return true;
    }
    if (message.type === 'EXTRACT') {reply(PaperExtract.extract(document, location.href));}
  });
})();
