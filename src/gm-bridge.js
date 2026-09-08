// Runs only in Chrome's isolated content-script world, never in the page world.
(() => {
  const PREFIX = 'xfpd:';
  const cache = Object.create(null);
  const listeners = new Map();
  let listenerId = 0;
  const revisions = new Map();
  const changedDuringLoad = new Set();
  let loading = true;

  function notify(key, oldValue, newValue, remote) {
    for (const entry of listeners.values()) {
      if (entry.key === key) {
        try { entry.callback(key, oldValue, newValue, remote); }
        catch (error) { console.error('[CityLink] Storage listener', error); }
      }
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [fullKey, change] of Object.entries(changes)) {
      if (!fullKey.startsWith(PREFIX)) continue;
      const key = fullKey.slice(PREFIX.length);
      if (loading) changedDuringLoad.add(key);
      const envelope = change.newValue;
      // Ignore an earlier local write arriving after a newer optimistic write.
      if (envelope?.writer === writer && envelope.revision < (revisions.get(key) || 0)) continue;
      const oldValue = cache[key];
      if (envelope) cache[key] = envelope.value;
      else delete cache[key];
      if (envelope?.writer !== writer) notify(key, oldValue, cache[key], true);
    }
  });
  const writer = crypto.randomUUID();
  window.citylinkGMReady = chrome.storage.local.get(null).then(values => {
    for (const [key, envelope] of Object.entries(values)) {
      if (key.startsWith(PREFIX) && !changedDuringLoad.has(key.slice(PREFIX.length))) {
        cache[key.slice(PREFIX.length)] = envelope.value;
      }
    }
    loading = false;
  });
  window.GM_getValue = (key, fallback) => Object.hasOwn(cache, key) ? cache[key] : fallback;
  window.GM_setValue = (key, value) => {
    const oldValue = cache[key];
    cache[key] = value;
    const revision = (revisions.get(key) || 0) + 1;
    revisions.set(key, revision);
    notify(key, oldValue, value, false);
    return chrome.storage.local.set({ [PREFIX + key]: { value, writer, revision } })
      .catch(error => console.error('[CityLink] Could not save downloader setting', error));
  };
  window.GM_addValueChangeListener = (key, callback) => {
    const id = ++listenerId;
    listeners.set(id, { key, callback });
    return id;
  };
  window.GM_removeValueChangeListener = id => listeners.delete(id);
  window.GM_log = console.log.bind(console);
  window.GM_info = { script: { name: 'XenForoPostDownloader (CityLink)', version: '3.22' } };
  window.citylinkOnReady = callback => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else queueMicrotask(callback);
  };
  // Explicit settings buttons are reliable on touch/keyboard and do not vanish
  // when the pointer moves from a download link into its configuration form.
  window.citylinkCreateOptionsButton = target => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Options';
    button.className = 'citylink-download-options';
    button.setAttribute('aria-label', target.id === 'download-page' ? 'Page download options' : 'Post download options');
    button.style.cssText = 'margin-left:8px;padding:2px 7px;border:1px solid currentColor;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer';
    target.after(button);
    return button;
  };

  async function rpc(action, data) {
    const result = await chrome.runtime.sendMessage({ channel: 'citylink', action, ...data });
    if (!result?.ok) throw new Error(result?.error || 'Extension service unavailable');
    return result.value;
  }
  window.GM_cookie = {
    list: (details, callback) => rpc('cookies.list', { details }).then(
      value => callback(value, null), error => callback([], error.message)),
    set: (details, callback = () => {}) => rpc('cookies.set', { details }).then(
      () => callback(null), error => callback(error.message)),
    delete: (details, callback = () => {}) => rpc('cookies.delete', { details }).then(
      () => callback(null), error => callback(error.message)),
  };
  window.GM_openInTab = (url, options = {}) => {
    const created = rpc('tabs.open', { url: new URL(url, location.href).href, active: options.active !== false });
    return { close: () => created.then(id => rpc('tabs.close', { id })).catch(console.error) };
  };

  function run(options, kind) {
    const port = chrome.runtime.connect({ name: 'citylink-transfer' });
    let finished = false;
    let chunks = [];
    let metadata = {};
    function cleanup() {
      finished = true;
      clearInterval(heartbeat);
      chunks = [];
      port.disconnect();
    }
    function callback(event, value) {
      try { options[event]?.(value); }
      catch (error) { console.error(`[CityLink] ${event} callback`, error); }
    }
    function fail(error) {
      if (finished) return;
      cleanup();
      callback('onerror', { error: String(error), ...metadata });
    }
    const heartbeat = setInterval(() => {
      try { port.postMessage({ action: 'ping' }); } catch (error) { fail(error); }
    }, kind === 'download' ? 1000 : 20000);
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (!finished) fail(error?.message || 'Extension disconnected. Reload this page and retry.');
    });
    port.onMessage.addListener(message => {
      if (finished) return;
      try {
        if (message.event === 'chunk') {
          const bytes = Uint8Array.from(atob(message.data), ch => ch.charCodeAt(0));
          chunks.push(bytes);
        } else if (message.event === 'headers') {
          metadata = message.data;
          callback('onreadystatechange', { ...metadata, readyState: 2 });
        } else if (message.event === 'progress') {
          callback('onprogress', { ...metadata, ...message.data });
        } else if (message.event === 'load') {
          let response = { ...metadata, ...message.data, readyState: 4 };
          if (kind === 'xhr') {
            const type = options.responseType || 'text';
            if (type === 'blob') response.response = new Blob(chunks, { type: metadata.contentType || '' });
            else {
              const size = chunks.reduce((sum, bytes) => sum + bytes.length, 0);
              const bytes = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
              if (type === 'arraybuffer') response.response = bytes.buffer;
              else {
                let decoder;
                try { decoder = new TextDecoder(metadata.contentType?.match(/charset=["']?([^;"'\s]+)/i)?.[1] || 'utf-8'); }
                catch { decoder = new TextDecoder(); }
                response.responseText = decoder.decode(bytes);
                response.response = response.responseText;
                if (type === 'json') {
                  try { response.response = JSON.parse(response.responseText); } catch { response.response = null; }
                }
                if (type === 'document') {
                  const mime = /xml/i.test(metadata.contentType || '') ? 'application/xml' : 'text/html';
                  response.response = new DOMParser().parseFromString(response.responseText, mime);
                  if (response.response.head && !response.response.querySelector('base')) {
                    const base = response.response.createElement('base');
                    base.href = metadata.finalUrl;
                    response.response.head.prepend(base);
                  }
                }
              }
            }
          }
          cleanup();
          callback('onreadystatechange', response);
          callback('onload', response);
        } else if (['error', 'timeout', 'abort'].includes(message.event)) {
          cleanup();
          callback(`on${message.event}`, { ...metadata, ...message.data });
        }
        if (!finished && message.seq !== undefined) port.postMessage({ action: 'ack', seq: message.seq });
      } catch (error) { fail(error); }
    });
    const request = {};
    for (const key of ['url', 'method', 'headers', 'data', 'timeout', 'anonymous', 'responseType', 'name', 'saveAs']) {
      if (options[key] !== undefined) request[key] = options[key];
    }
    request.url = new URL(request.url, location.href).href;
    port.postMessage({ action: 'start', kind, options: request });
    return { abort() {
      if (finished) return;
      port.postMessage({ action: 'abort' });
      cleanup();
      callback('onabort', { ...metadata, readyState: 4 });
    } };
  }
  window.GM_xmlhttpRequest = options => run(options, 'xhr');
  window.GM_download = (options, name) => run(typeof options === 'string' ? { url: options, name } : options, 'download');
})();
