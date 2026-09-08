import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { allowedUrl, trustedSender, downloadName, downloadUrl, headerRule } from '../src/network-policy.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const sender = { id: 'test-extension', tab: { id: 1 }, frameId: 0, url: 'https://simpcity.cr/threads/demo.1/' };

test('network policy rejects foreign callers, host lookalikes, and privileged URLs', () => {
  assert.equal(trustedSender(sender, sender.id), true);
  for (const url of ['https://evil.test/threads/1', 'https://simpcity.cr.evil.test/threads/1', 'http://simpcity.cr/threads/1']) {
    assert.equal(trustedSender({ ...sender, url }, sender.id), false);
  }
  assert.equal(trustedSender({ ...sender, frameId: 1 }, sender.id), false);
  assert.equal(allowedUrl('https://api.gofile.io/contents/test#fragment'), 'https://api.gofile.io/contents/test');
  for (const url of ['file:///C:/secret', 'https://localhost/', 'http://127.0.0.1/', 'https://gofile.io.evil.test/', 'https://a:b@gofile.io/']) {
    assert.throws(() => allowedUrl(url));
  }
  assert.equal(downloadUrl('blob:https://simpcity.cr/example', sender.url), 'blob:https://simpcity.cr/example');
  assert.throws(() => downloadUrl('blob:https://evil.test/example', sender.url));
  assert.equal(downloadName('../CON/日本語?.zip'), '_/_CON/日本語_.zip');
  const rule = headerRule(100000, 'https://gofile.io/x?a=1.2', { Referer: 'https://gofile.io/' }, sender.id);
  assert.deepEqual(rule.condition.initiatorDomains, [sender.id]);
  assert.ok(new RegExp(rule.condition.regexFilter).test('https://gofile.io/x?a=1.2'));
  assert.ok(!new RegExp(rule.condition.regexFilter).test('https://gofile.io/x?a=1x2'));
});

test('local GoFile algorithm matches captured website implementation across bucket boundaries', async () => {
  const original = read('../vendor/gofile-wt.js');
  for (const now of [0, 14400000 - 1, 14400000, 1788825600000]) {
    const navigator = { userAgent: 'CityLink test browser', language: 'zh-HK' };
    const Date = { now: () => now };
    const expected = runInNewContext(original + ';generateWT("sample-token")', { navigator, Date }, {
      timeout: 1000, contextCodeGeneration: { strings: false, wasm: false },
    });
    const window = {};
    runInNewContext(read('../src/gofile-token.js'), { window, navigator, Date, crypto: webcrypto, TextEncoder });
    assert.equal(await window.citylinkGenerateWT('sample-token'), expected);
  }
});

test('packaging contains local dependencies and no legacy collector or runtime eval', () => {
  const manifest = JSON.parse(read('../manifest.json'));
  const downloader = manifest.content_scripts.find(entry => entry.js?.includes('src/downloader.js'));
  assert.equal(downloader.run_at, 'document_end');
  assert.ok(downloader.matches.includes('https://goonbox.cr/*'));
  assert.ok(downloader.js.indexOf('src/gm-bridge.js') < downloader.js.indexOf('src/downloader.js'));
  for (const entry of manifest.content_scripts) {
    for (const path of [...(entry.js || []), ...(entry.css || [])]) assert.ok(read(`../${path}`).length > 0);
  }
  assert.ok(!JSON.stringify(manifest).includes('src/content.js'));
  assert.ok(!/\bnew Function\s*\(|\beval\s*\(/.test(read('../src/downloader.js')));
  const provenance = JSON.parse(read('../vendor/provenance.json'));
  for (const [name, metadata] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../vendor/${name}`, import.meta.url))).digest('hex'), metadata.sha256);
  }
});

function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) };
}
function portPair() {
  const a = { onMessage: event(), onDisconnect: event() };
  const b = { onMessage: event(), onDisconnect: event(), name: 'citylink-transfer', sender };
  let closed = false;
  a.postMessage = value => queueMicrotask(() => { if (!closed) b.onMessage.emit(JSON.parse(JSON.stringify(value))); });
  b.postMessage = value => queueMicrotask(() => { if (!closed) a.onMessage.emit(JSON.parse(JSON.stringify(value))); });
  a.disconnect = b.disconnect = () => {
    if (closed) return;
    closed = true;
    a.onDisconnect.emit(); b.onDisconnect.emit();
  };
  return [a, b];
}

test('GM bridge and worker integrate over JSON-only ports', async t => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const local = {};
  const session = {};
  const rules = new Map();
  const change = event();
  const connections = event();
  const messages = event();
  const downloadCalls = [];
  const makeStorage = (values, area) => ({
    get: async key => key == null ? structuredClone(values) : { [key]: values[key] },
    set: async update => {
      const changes = {};
      for (const [key, value] of Object.entries(update)) { changes[key] = { oldValue: values[key], newValue: value }; values[key] = value; }
      queueMicrotask(() => change.emit(changes, area));
    },
    remove: async keys => { for (const key of [keys].flat()) delete values[key]; },
  });
  globalThis.chrome = {
    runtime: { id: sender.id, onConnect: connections, onMessage: messages,
      connect() { const [client, server] = portPair(); connections.emit(server); return client; },
      sendMessage(message) { return new Promise(resolve => messages.emit(message, sender, resolve)); },
    },
    storage: { local: makeStorage(local, 'local'), session: makeStorage(session, 'session'), onChanged: change },
    declarativeNetRequest: {
      getSessionRules: async () => [],
      updateSessionRules: async ({ addRules = [], removeRuleIds = [] }) => {
        for (const id of removeRuleIds) rules.delete(id);
        for (const rule of addRules) rules.set(rule.id, rule);
      },
    },
    downloads: {
      download: async options => { downloadCalls.push(options); return downloadCalls.length; },
      search: async () => [{ state: 'complete', bytesReceived: 4, totalBytes: 4 }],
      cancel: async () => {},
    },
    tabs: { onRemoved: event(), create: async () => ({ id: 2 }), remove: async () => {} },
    cookies: { getAllCookieStores: async () => [{ id: '0', tabIds: [1] }], getAll: async () => [], set: async x => x, remove: async () => {} },
  };
  const doms = [];
  const makeWindow = async () => {
    const dom = new JSDOM('<html><body></body></html>', { url: sender.url, runScripts: 'outside-only' });
    doms.push(dom);
    dom.window.chrome = globalThis.chrome;
    dom.window.TextDecoder = TextDecoder;
    dom.window.eval(read('../src/gm-bridge.js'));
    await dom.window.citylinkGMReady;
    return dom.window;
  };
  try {
    await import('../src/background.js');
    const w = await makeWindow();
    const xhr = options => new Promise((resolve, reject) => w.GM_xmlhttpRequest({ ...options, onload: resolve, onerror: reject, ontimeout: reject }));
    await t.test('streams binary without corruption and removes temporary headers', async () => {
      const bytes = Uint8Array.from({ length: 600000 }, (_, i) => i % 256);
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://gofile.io/test');
        assert.equal(options.credentials, 'include');
        assert.equal(rules.size, 1);
        return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
      };
      let progress = 0;
      const result = await xhr({ url: 'https://gofile.io/test', headers: { Referer: 'https://gofile.io/' }, responseType: 'arraybuffer', onprogress: e => { progress = e.loaded; } });
      assert.deepEqual(Buffer.from(result.response), Buffer.from(bytes));
      assert.equal(progress, bytes.length);
      assert.equal(rules.size, 0);
    });
    await t.test('parses HTML/JSON, preserves UTF-8, method and body', async () => {
      globalThis.fetch = async (_, options) => {
        assert.equal(options.method, 'POST'); assert.equal(options.body, '{"test":1}');
        return new Response('<h1>中文</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      };
      const result = await xhr({ url: 'https://gofile.io/test', method: 'POST', data: '{"test":1}', responseType: 'document' });
      assert.equal(result.response.querySelector('h1').textContent, '中文');
      globalThis.fetch = async () => new Response('{"ok":true}');
      assert.equal((await xhr({ url: 'https://gofile.io/test', responseType: 'json' })).response.ok, true);
    });
    await t.test('header callback can abort a probe without downloading the body', async () => {
      let aborted = false;
      globalThis.fetch = async (_, options) => {
        options.signal.addEventListener('abort', () => { aborted = true; });
        return new Response('body');
      };
      await new Promise(resolve => {
        const handle = w.GM_xmlhttpRequest({ url: 'https://gofile.io/test',
          onreadystatechange: response => { if (response.readyState === 2) handle.abort(); },
          onabort: resolve, onload: () => assert.fail('Aborted request loaded'),
        });
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(aborted, true);
    });
    await t.test('timeouts and network failures reach their own callbacks', async () => {
      globalThis.fetch = async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Abort', 'AbortError'))));
      await new Promise((resolve, reject) => w.GM_xmlhttpRequest({ url: 'https://gofile.io/test', timeout: 10, ontimeout: resolve, onload: reject }));
      globalThis.fetch = async () => { throw new Error('Network failed'); };
      await assert.rejects(xhr({ url: 'https://gofile.io/test' }), error => error.error === 'Network failed');
    });
    await t.test('values persist and are delivered to another tab', async () => {
      const other = await makeWindow();
      let remote;
      other.GM_addValueChangeListener('bridge', (...args) => { remote = args; });
      await w.GM_setValue('bridge', { done: true });
      assert.equal(other.GM_getValue('bridge').done, true);
      assert.equal(remote[3], true);
      const fresh = await makeWindow();
      assert.equal(fresh.GM_getValue('bridge').done, true);
    });
    await t.test('downloads report completion and sanitize Windows paths', async () => {
      await new Promise((resolve, reject) => w.GM_download({ url: 'blob:https://simpcity.cr/test', name: 'Title/#1.zip', onload: resolve, onerror: reject }));
      assert.equal(downloadCalls.at(-1).filename, 'Title/#1.zip');
    });
    await t.test('cookie API rejects unrelated cookie access', async () => {
      const error = await new Promise(resolve => w.GM_cookie.list({ url: 'https://gofile.io/', name: 'other' }, (_, error) => resolve(error)));
      assert.match(error, /Unsupported cookie/);
    });
  } finally {
    doms.forEach(dom => dom.window.close());
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});
