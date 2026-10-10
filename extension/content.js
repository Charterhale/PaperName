(() => {
  'use strict';
  let last = '', timer;
  function send(payload) {chrome.runtime.sendMessage(payload).catch(() => {});}
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
  }, true);
  document.addEventListener('auxclick', event => {
    const result = PaperExtract.clicked(document, event.target, location.href);
    if (result) send({type: 'CLICK', pageUrl: location.href, ...result});
  }, true);
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'EXTRACT') {reply(PaperExtract.extract(document, location.href));}
  });
})();
