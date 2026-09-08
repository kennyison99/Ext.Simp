import { allowedUrl, trustedSender, downloadUrl, downloadName, headerRule } from './network-policy.js';

const RULE_START = 100000;
let nextRule = RULE_START;
// A restarted worker removes stale temporary rules left by an interrupted transfer.
const ready = chrome.declarativeNetRequest.getSessionRules().then(rules =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.filter(r => r.id >= RULE_START).map(r => r.id) }));
const locks = new Map();
function untilAborted(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function withHeaders(url, headers, signal, operation) {
  const previous = locks.get(url) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const current = previous.then(() => gate);
  locks.set(url, current);
  let rule;
  try {
    await untilAborted(previous, signal);
    await ready;
    signal.throwIfAborted();
    rule = headerRule(nextRule++, url, headers, chrome.runtime.id);
    if (rule) await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
    signal.throwIfAborted();
    return await operation();
  } finally {
    if (rule) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id] }).catch(console.error);
    release();
    current.then(() => { if (locks.get(url) === current) locks.delete(url); });
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== 'citylink') return;
  if (!trustedSender(sender, chrome.runtime.id)) { respond({ ok: false, error: 'Untrusted sender' }); return; }
  handleMessage(message, sender).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message, sender) {
  if (message.action === 'tabs.open') {
    const url = allowedUrl(message.url);
    const tab = await chrome.tabs.create({ url, active: message.active === true, openerTabId: sender.tab.id });
    await chrome.storage.session.set({ [`helper:${tab.id}`]: sender.tab.id });
    return tab.id;
  }
  if (message.action === 'tabs.close') {
    const key = `helper:${message.id}`;
    const state = await chrome.storage.session.get(key);
    if (state[key] !== sender.tab.id) throw new Error('This tab was not opened by the caller');
    await chrome.tabs.remove(message.id).catch(() => {});
    await chrome.storage.session.remove(key);
    return;
  }
  if (message.action.startsWith('cookies.')) {
    // Upstream only needs its GoFile account-token cookie, not arbitrary browser cookies.
    const input = message.details || {};
    if (new URL(input.url).origin !== 'https://gofile.io' || input.name !== 'accountToken' ||
        (input.domain && !['gofile.io', '.gofile.io'].includes(input.domain))) throw new Error('Unsupported cookie');
    const details = { url: 'https://gofile.io/', name: 'accountToken' };
    // Use the sender's cookie store, including incognito where enabled.
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find(item => item.tabIds.includes(sender.tab.id));
    if (store) details.storeId = store.id;
    if (message.action === 'cookies.list') return chrome.cookies.getAll(details);
    if (message.action === 'cookies.delete') return chrome.cookies.remove(details);
    if (message.action === 'cookies.set') return chrome.cookies.set({
      ...details, value: String(input.value), domain: '.gofile.io', path: '/', secure: true,
      sameSite: input.sameSite === 'lax' ? 'lax' : 'unspecified',
    });
  }
  throw new Error('Unsupported operation');
}

chrome.tabs.onRemoved.addListener(async tabId => {
  const values = await chrome.storage.session.get(null);
  const owned = Object.entries(values).filter(([key, owner]) => key.startsWith('helper:') && owner === tabId);
  await Promise.all(owned.map(([key]) => chrome.tabs.remove(Number(key.slice(7))).catch(() => {})));
  await chrome.storage.session.remove([`helper:${tabId}`, ...owned.map(([key]) => key)]);
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'citylink-transfer' || !trustedSender(port.sender, chrome.runtime.id)) { port.disconnect(); return; }
  const controller = new AbortController();
  let started = false;
  let closed = false;
  let seq = 0;
  let pending;
  let downloadId;
  let timeout;
  let timedOut = false;
  // Keep long transfers alive even when Chrome throttles a background forum tab.
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
  let downloadPollTimer;
  const send = (event, data) => { if (!closed) port.postMessage({ event, data }); };
  function acknowledged(event, data) {
    controller.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      pending = { seq: ++seq, resolve, reject };
      port.postMessage({ event, data, seq });
    });
  }
  function abort() {
    controller.abort();
    pending?.reject(new DOMException('Aborted', 'AbortError'));
    pending = null;
    if (downloadId !== undefined) chrome.downloads.cancel(downloadId).catch(() => {});
  }
  async function downloadStatus() {
    if (downloadId === undefined || closed) return;
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (!item) throw new Error('Download disappeared');
    send('progress', { loaded: item.bytesReceived, total: item.totalBytes, lengthComputable: item.totalBytes > 0 });
    if (item.state === 'complete') return { done: true };
    if (item.state === 'interrupted') throw new Error(item.error || 'Download interrupted');
    return { done: false };
  }
  let pollDownload;
  port.onDisconnect.addListener(() => {
    closed = true;
    clearTimeout(timeout);
    clearInterval(keepAlive);
    clearInterval(downloadPollTimer);
    abort();
  });
  port.onMessage.addListener(message => {
    if (message.action === 'ack' && pending?.seq === message.seq) { pending.resolve(); pending = null; }
    if (message.action === 'abort') abort();
    if (message.action === 'ping') pollDownload?.();
    if (message.action !== 'start' || started) return;
    started = true;
    const options = message.options || {};
    const duration = Number(options.timeout) || 0;
    if (duration > 0) timeout = setTimeout(() => { timedOut = true; abort(); }, Math.min(duration, 2147483647));
    (async () => {
      if (message.kind === 'download') {
        const url = downloadUrl(options.url, port.sender.url);
        await withHeaders(url, options.headers, controller.signal, async () => {
          downloadId = await chrome.downloads.download({
            url, filename: downloadName(options.name), saveAs: options.saveAs === true, conflictAction: 'uniquify',
          });
          if (controller.signal.aborted) { await chrome.downloads.cancel(downloadId); controller.signal.throwIfAborted(); }
          await new Promise((resolve, reject) => {
            let polling = false;
            const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            controller.signal.addEventListener('abort', onAbort, { once: true });
            pollDownload = async () => {
              if (polling) return;
              polling = true;
              try { if ((await downloadStatus())?.done) resolve(); }
              catch (error) { reject(error); }
              finally { polling = false; }
            };
            pollDownload();
            downloadPollTimer = setInterval(pollDownload, 1000);
          });
          // A successful port disconnect must not cancel the completed download.
          downloadId = undefined;
        });
      } else if (message.kind === 'xhr') {
        const url = allowedUrl(options.url);
        await withHeaders(url, options.headers, controller.signal, async () => {
          const method = String(options.method || 'GET').toUpperCase();
          const response = await fetch(url, {
            method, signal: controller.signal, credentials: options.anonymous ? 'omit' : 'include',
            body: ['GET', 'HEAD'].includes(method) ? undefined : options.data == null ? undefined : String(options.data),
          });
          const responseHeaders = [...response.headers].map(([key, value]) => `${key}: ${value}\r\n`).join('');
          const metadata = { status: response.status, statusText: response.statusText, responseHeaders,
            finalUrl: response.url, responseURL: response.url, contentType: response.headers.get('content-type') || '' };
          await acknowledged('headers', metadata);
          const reader = response.body?.getReader();
          let loaded = 0;
          const total = Number(response.headers.get('content-length')) || 0;
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              // Bounded messages and acknowledgements prevent unbounded extension-port queues.
              for (let offset = 0; offset < value.length; offset += 256 * 1024) {
                const bytes = value.subarray(offset, offset + 256 * 1024);
                let binary = '';
                for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                await acknowledged('chunk', btoa(binary));
                loaded += bytes.length;
                send('progress', { loaded, total, lengthComputable: total > 0 });
              }
            }
          }
        });
      } else throw new Error('Unsupported transfer');
      send('load', {});
    })().catch(error => send(timedOut ? 'timeout' : controller.signal.aborted ? 'abort' : 'error', { error: error.message }))
      .finally(() => {
        clearTimeout(timeout);
        clearInterval(keepAlive);
        clearInterval(downloadPollTimer);
        pollDownload = null;
      });
  });
});
