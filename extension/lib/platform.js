(function (root) {
  'use strict';
  const api = root.browser || root.chrome;
  // Safari has no downloads API. Never touch missing events at startup.
  const nativeDownloads = api?.runtime?.getURL('').startsWith('chrome-extension://') || false;
  const memory = {};
  const session = api?.storage?.session || {
    async get(keys) {
      return Object.fromEntries([].concat(keys).filter(k => k in memory).map(k => [k, structuredClone(memory[k])]));
    },
    async set(values) {Object.assign(memory, structuredClone(values));}
  };
  function listen(handler) {
    // Safari's browser namespace keeps async replies alive with a returned Promise.
    api.runtime.onMessage.addListener(nativeDownloads ? handler : (message, sender) => new Promise(resolve => {
      const pending = handler(message, sender, resolve);
      if (pending !== true) resolve();
    }));
  }
  root.PaperPlatform = {api, session, nativeDownloads, listen};
})(globalThis);
