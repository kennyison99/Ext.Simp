import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../src/watched.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function row(id, title = `Thread ${id}`, tag = 'Asian', unread = false) {
  return `<div class="structItem--thread js-threadListItem-${id} ${unread ? 'is-unread' : ''}" data-author="Author">
    <div class="structItem-title"><span class="label">OnlyFans</span><span class="label">${tag}</span><a href="/threads/topic.${id}/unread">${title}</a></div>
    <div class="structItem-startDate"><time data-timestamp="${id}"></time></div>
    <div class="structItem-cell--latest"><a href="/threads/topic.${id}/latest"><time class="structItem-latestDate" data-timestamp="${id}">Today</time></a></div></div>`;
}
function storage() {
  const values = {};
  const listeners = [];
  return { values, api: {
    onChanged: { addListener: callback => listeners.push(callback) },
    local: {
      get: async () => ({ ...values }),
      set: async changes => {
        Object.assign(values, changes);
        listeners.forEach(callback => callback(Object.fromEntries(Object.entries(changes).map(([key, newValue]) => [key, { newValue }])), 'local'));
      },
    },
  } };
}
async function setup(html, options = {}) {
  const store = options.store || storage();
  const dom = new JSDOM(`<div class="block"><a href="/watched/threads?page=${options.pages || 1}">Last</a>
    <div class="structItemContainer">${html}</div><button>Forum management</button></div>`, {
    url: 'https://simpcity.cr/watched/threads', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  dom.window.chrome = { storage: store.api };
  const observed = new Set();
  let onIntersection;
  dom.window.IntersectionObserver = class {
    constructor(callback) { onIntersection = callback; }
    observe(element) { observed.add(element); }
    unobserve(element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  };
  dom.window.fetch = options.fetch || (async () => { throw new Error('unexpected fetch'); });
  await dom.window.eval(script);
  const shadow = dom.window.document.querySelector('#citylink-watched').shadowRoot;
  return { dom, shadow, store, $: selector => shadow.querySelector(selector),
    reveal: () => onIntersection([...observed].map(target => ({ target, isIntersecting: true }))) };
}

test('defaults to folder cards, with bounded thread pages and native view available', async () => {
  const app = await setup(Array.from({ length: 55 }, (_, i) => row(i + 1)).join(''));
  try {
    assert.equal(app.shadow.querySelectorAll('.folder').length, 1);
    assert.equal(app.shadow.querySelectorAll('.card').length, 0);
    app.$('.folder').click();
    assert.equal(app.shadow.querySelectorAll('.card').length, 24);
    assert.equal(app.$('[data-page]').textContent, 'Page 1 of 3');
    assert.equal(app.$('.card').dataset.threadId, '55');
    app.$('[data-next]').click(); app.$('[data-next]').click();
    assert.equal(app.shadow.querySelectorAll('.card').length, 7);
    app.$('[data-original]').click();
    assert.equal(app.$('.workspace').hidden, true);
    assert.equal(app.dom.window.document.querySelector('.block').style.display, '');
    assert.equal(app.dom.window.document.querySelectorAll('.structItem--thread').length, 55);
    app.$('[data-original]').click();
    assert.equal(app.dom.window.document.querySelector('.block').style.display, 'none');
  } finally { app.dom.window.close(); }
});

test('search crosses folders and loaded pages, deduplicates IDs and supports Unicode', async () => {
  const urls = [];
  const app = await setup(row(1, 'Alpha', 'Asian'), { pages: 3, fetch: async url => {
    urls.push(String(url));
    return { ok: true, text: async () => `<div class="structItemContainer">${row(1, 'Duplicate')}${row(2, '曇 Kumori', 'Cosplay', true)}</div>` };
  } });
  try {
    assert.equal(urls.length, 2);
    assert.match(app.$('[data-status]').textContent, /2 threads · 3\/3 pages loaded/);
    app.$('.folder').click();
    app.$('input').value = '曇 KUMORI';
    app.$('input').dispatchEvent(new app.dom.window.Event('input'));
    assert.equal(app.shadow.querySelectorAll('.card').length, 1);
    assert.equal(app.$('.card').dataset.threadId, '2');
    assert.match(app.$('[data-heading]').textContent, /all folders/);
    app.$('input').value = '<script>';
    app.$('input').dispatchEvent(new app.dom.window.Event('input'));
    assert.equal(app.$('.empty').hidden, false);
    assert.equal(app.shadow.querySelectorAll('script').length, 0);
  } finally { app.dom.window.close(); }
});

test('favourites persist by thread ID, sync tabs, and roll back failed saves', async () => {
  const store = storage();
  const app = await setup(row(1, 'Alpha'), { store });
  const other = await setup(row(1, 'Renamed thread'), { store });
  try {
    app.$('[data-section="all"]').click();
    app.$('.star').click(); await tick();
    assert.equal(app.$('.star').getAttribute('aria-pressed'), 'true');
    other.$('[data-section="favourites"]').click();
    assert.equal(other.shadow.querySelectorAll('.card').length, 1);
    const fresh = await setup(row(1, 'Another title'), { store });
    fresh.$('[data-section="favourites"]').click();
    assert.equal(fresh.shadow.querySelectorAll('.card').length, 1);
    fresh.dom.window.close();
    store.api.local.set = async () => { throw new Error('quota'); };
    app.$('.star').click(); await tick();
    assert.equal(app.$('.star').getAttribute('aria-pressed'), 'true');
    assert.match(app.$('[data-error]').textContent, /restored/);
  } finally { app.dom.window.close(); other.dom.window.close(); }
});

test('unread filter and creation/title sorting use the whole selected collection', async () => {
  const app = await setup(row(1, 'Zebra', 'Asian', true) + row(2, 'Alpha', 'Asian', true) + row(3, 'Beta', 'Asian'));
  try {
    app.$('[data-section="unread"]').click();
    assert.equal(app.shadow.querySelectorAll('.card').length, 2);
    const sort = app.$('select[aria-label="Sort watched threads"]');
    sort.value = 'oldest'; sort.dispatchEvent(new app.dom.window.Event('change'));
    assert.equal(app.$('.card').dataset.threadId, '1');
    sort.value = 'title'; sort.dispatchEvent(new app.dom.window.Event('change'));
    assert.equal(app.$('.card').dataset.threadId, '2');
    app.$('select[aria-label="Watched layout"]').value = 'compact';
    app.$('select[aria-label="Watched layout"]').dispatchEvent(new app.dom.window.Event('change'));
    assert.ok(app.$('.items').classList.contains('compact'));
  } finally { app.dom.window.close(); }
});

test('failed pages expose incomplete-search notice and can be retried', async () => {
  let fail = true;
  const app = await setup(row(1), { pages: 2, fetch: async () => {
    if (fail) throw new Error('offline');
    return { ok: true, text: async () => `<div class="structItemContainer">${row(2)}</div>` };
  } });
  try {
    assert.equal(app.$('[data-partial]').hidden, false);
    assert.match(app.$('[data-status]').textContent, /1\/2/);
    fail = false; app.$('[data-retry]').click(); await tick();
    assert.equal(app.$('[data-partial]').hidden, true);
    assert.match(app.$('[data-status]').textContent, /2 threads · 2\/2/);
  } finally { app.dom.window.close(); }
});

test('folder previews show three recent threads; visible covers fetch once and reuse the image in cards', async () => {
  const urls = [];
  const app = await setup(Array.from({ length: 5 }, (_, i) => row(i + 1)).join(''), { fetch: async url => {
    urls.push(String(url));
    return { ok: true, text: async () => `<img src="/logo.png"><div class="message-body"><div class="bbWrapper">
      <div class="bbCodeBlock--quote"><img src="https://images.example/quote.jpg"></div>
      <img class="smilie" src="/smilies/smile.png"><img width="16" src="/tiny.png">
      <img data-src="https://images.example/cover.jpg" src="data:image/gif;base64,AA==">
      </div></div>` };
  } });
  try {
    assert.equal(urls.length, 0, 'offscreen previews do not fetch thread pages');
    assert.deepEqual([...app.shadow.querySelectorAll('.folder-entry-title')].map(el => el.textContent), ['Thread 5', 'Thread 4', 'Thread 3']);
    app.reveal(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(urls.length, 3);
    assert.ok(urls.every(url => /^https:\/\/simpcity.cr\/threads\/topic\.\d+\/(?:latest)?$/.test(url)), 'use same-origin thread pages');
    assert.equal(app.$('.preview img').src, 'https://images.example/cover.jpg');
    assert.equal(app.$('.preview img').referrerPolicy, 'no-referrer');
    app.$('.folder').click();
    assert.equal(app.$('.card .preview img').src, 'https://images.example/cover.jpg');
    assert.equal(urls.length, 3, 'cached previews survive rerendering');
    const img = app.$('.preview img'); img.dispatchEvent(new app.dom.window.Event('error'));
    assert.ok(app.$('.card .preview').querySelector('img'));
    assert.match(app.$('.preview-caption').textContent, /^(Preview|Generated cover)$/);
  } finally { app.dom.window.close(); }
});

test('preview loading limits concurrency and drops offscreen jobs after navigation', async () => {
  const pending = [];
  const app = await setup(Array.from({ length: 6 }, (_, i) => row(i + 1)).join(''), {
    fetch: url => new Promise(resolve => pending.push({ url, resolve })),
  });
  try {
    app.$('[data-section="all"]').click(); app.reveal();
    assert.equal(pending.length, 2);
    app.$('[data-section="favourites"]').click();
    for (const request of pending) request.resolve({ ok: true, text: async () => '<div class="message-body">No images</div>' });
    await tick(); await tick();
    assert.equal(pending.length, 4, 'latest and canonical pages are bounded to the visible jobs');
    app.$('[data-section="all"]').click();
    assert.match(app.$('.preview-caption').textContent, /^(Preview|Generated cover)$/);
  } finally { app.dom.window.close(); }
});

test('preview cache persists across page loads, expires, and rejects unsafe image URLs', async () => {
  const store = storage();
  store.values['citylink:watched:default:previews'] = {
    1: { url: 'https://images.example/cached.jpg', at: Date.now() },
    2: { url: 'https://images.example/expired.jpg', at: Date.now() - 8 * 86400000 },
    3: { url: 'javascript:alert(1)', at: Date.now() },
  };
  const requests = [];
  const app = await setup(row(1) + row(2) + row(3), { store, fetch: async url => {
    requests.push(url);
    return { ok: true, text: async () => '<div class="message-body"><div class="bbWrapper"><img src="javascript:alert(1)"><img src="http://insecure.example/img.jpg"></div></div>' };
  } });
  try {
    assert.equal(app.$('[data-preview-id="1"] img').src, 'https://images.example/cached.jpg');
    app.reveal(); await tick(); await tick();
    assert.equal(requests.length, 2, 'latest and canonical pages may both be tried');
    assert.ok(app.$('[data-preview-id="2"] img'));
    assert.ok(app.$('[data-preview-id="3"] img'));
    assert.equal(app.$('[data-preview-id="2"] .preview-caption').textContent, 'Generated cover');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(store.values['citylink:watched:default:previews'][2].url, '');
  } finally { app.dom.window.close(); }
});

test('preview extraction covers OpenGraph, attachment links, and lazy image fields', async () => {
  const app = await setup(row(1), { fetch: async () => ({ ok: true, text: async () => `
    <meta property="og:image" content="https://images.example/og.jpg">
    <div class="message-body"><div class="bbWrapper">
      <a href="https://images.example/attachment.png">download image</a>
      <img data-original="https://images.example/lazy.jpg" src="/placeholder.svg">
    </div></div>` }) });
  try {
    app.reveal(); await tick(); await tick();
    assert.equal(app.$('.preview img').src, 'https://images.example/og.jpg');
  } finally { app.dom.window.close(); }
});

test('preview extraction accepts extensionless Goonbox image links', async () => {
  const app = await setup(row(1), { fetch: async () => ({ ok: true, text: async () => `
    <div class="message-body"><a class="link link--external" href="https://goonbox.cr/img/ak9Rgzm"></a></div>` }) });
  try {
    app.reveal(); await tick(); await tick();
    assert.equal(app.$('.preview img').src, 'https://goonbox.cr/img/ak9Rgzm');
  } finally { app.dom.window.close(); }
});
