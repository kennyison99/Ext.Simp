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
  let intersect;
  dom.window.IntersectionObserver = class {
    constructor(callback) { intersect = callback; }
    observe(box) { observed.add(box); }
    unobserve(box) { observed.delete(box); }
    disconnect() { observed.clear(); }
  };
  dom.window.fetch = options.fetch || (async () => { throw new Error('unexpected fetch'); });
  await dom.window.eval(script);
  const shadow = dom.window.document.querySelector('#citylink-watched').shadowRoot;
  return { dom, shadow, store, $: selector => shadow.querySelector(selector),
    reveal: () => intersect([...observed].map(target => ({ target, isIntersecting: true }))) };
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


function withPreview(id, media) {
  return row(id).replace('<div class="structItem-title">', media + '<div class="structItem-title">');
}

test('native dcThumbnail background images work inside avatar wrappers', async () => {
  const requests = [];
  const app = await setup(withPreview(1, `<a class="avatar dcThumbnail" href="/threads/topic.1/">
    <img style="background-image: url(https://cdn.example/dc_thumbnails/1.jpg?123); object-position: -99999px 99999px" src="data:image/png;base64,AA==">
    </a>`), { fetch: async url => { requests.push(String(url)); throw new Error('unexpected fetch'); } });
  try {
    assert.equal(app.$('.preview img').src, 'https://cdn.example/dc_thumbnails/1.jpg?123');
    app.$('.folder').click();
    assert.equal(app.$('.preview img').src, 'https://cdn.example/dc_thumbnails/1.jpg?123');
    assert.deepEqual(requests, []);
  } finally { app.dom.window.close(); }
});

test('folder and card previews reuse watched images without fetching posts', async () => {
  const requests = [];
  const app = await setup(Array.from({ length: 5 }, (_, i) =>
    withPreview(i + 1, '<img data-src="https://images.example/cover.jpg" src="/placeholder.svg">')).join(''),
    { fetch: async url => { requests.push(String(url)); throw new Error('unexpected fetch'); } });
  try {
    assert.deepEqual([...app.shadow.querySelectorAll('.folder-entry-title')].map(el => el.textContent), ['Thread 5', 'Thread 4', 'Thread 3']);
    assert.equal(app.$('.preview img').src, 'https://images.example/cover.jpg');
    app.$('.folder').click();
    assert.equal(app.$('.card .preview img').src, 'https://images.example/cover.jpg');
    assert.equal(app.$('.preview img').loading, 'lazy');
    assert.equal(app.$('.preview img').referrerPolicy, 'no-referrer');
    app.$('.preview img').dispatchEvent(new app.dom.window.Event('error'));
    assert.equal(app.$('.preview').querySelector('img'), null);
    assert.ok(app.$('.preview-initial'));
    app.$('[data-section="folders"]').click();
    await tick();
    assert.deepEqual(requests, []);
  } finally { app.dom.window.close(); }
});

test('missing or unsafe previews use valid old cache without fetching offscreen posts', async () => {
  const store = storage();
  store.values['citylink:watched:default:previews'] = { 1: { url: 'https://images.example/old.jpg', at: Date.now() } };
  const requests = [];
  const app = await setup(withPreview(1, '<a class="avatar"><img src="/users/1.jpg"></a><img src="javascript:alert(1)"><img src="http://insecure.example/image.jpg">') + row(2),
    { store, fetch: async url => { requests.push(String(url)); throw new Error('unexpected fetch'); } });
  try {
    app.$('[data-section="all"]').click();
    assert.equal(app.shadow.querySelectorAll('.preview img').length, 1);
    assert.equal(app.$('[data-preview-id="1"] img').src, 'https://images.example/old.jpg');
    assert.equal(app.shadow.querySelectorAll('.preview-initial').length, 2);
    await tick();
    assert.deepEqual(requests, []);
  } finally { app.dom.window.close(); }
});

test('previews from additional watched pages work without extra requests', async () => {
  const requests = [];
  const app = await setup(row(1), { pages: 2, fetch: async url => {
    requests.push(String(url));
    return { ok: true, text: async () => '<div class="structItemContainer">' +
      withPreview(2, '<img data-original="/attachments/cover.jpg">') + '</div>' };
  } });
  try {
    app.$('[data-section="all"]').click();
    assert.equal(app.$('[data-preview-id="2"] img').src, 'https://simpcity.cr/attachments/cover.jpg');
    assert.deepEqual(requests, ['https://simpcity.cr/watched/threads?page=2']);
  } finally { app.dom.window.close(); }
});

test('missing covers fetch once on visibility and persist across reloads', async () => {
  const store = storage();
  const requests = [];
  const fetch = async url => {
    requests.push(String(url));
    return { ok: true, text: async () => '<div class="message-body"><img data-src="https://cdn.example/cover.jpg"></div>' };
  };
  const app = await setup(row(1), { store, fetch });
  try {
    assert.equal(requests.length, 0);
    app.reveal(); app.reveal(); await tick(); await tick();
    assert.deepEqual(requests, ['https://simpcity.cr/threads/topic.1/']);
    assert.equal(app.$('.preview img').src, 'https://cdn.example/cover.jpg');
    app.$('.folder').click(); app.reveal();
    assert.equal(requests.length, 1);
    const fresh = await setup(row(1), { store, fetch });
    try {
      fresh.reveal(); await tick();
      assert.equal(fresh.$('.preview img').src, 'https://cdn.example/cover.jpg');
      assert.equal(requests.length, 1);
    } finally { fresh.dom.window.close(); }
  } finally { app.dom.window.close(); }
});

test('broken native preview falls back to post cover; broken cover has a failure cooldown', async () => {
  let requests = 0;
  const app = await setup(withPreview(1, '<img src="https://cdn.example/native.jpg">'), { fetch: async () => {
    requests++;
    return { ok: true, text: async () => '<meta property="og:image" content="https://cdn.example/fallback.jpg">' };
  } });
  try {
    app.reveal(); assert.equal(requests, 0);
    app.$('.preview img').dispatchEvent(new app.dom.window.Event('error'));
    app.reveal(); await tick(); await tick();
    assert.equal(app.$('.preview img').src, 'https://cdn.example/fallback.jpg');
    app.$('.preview img').dispatchEvent(new app.dom.window.Event('error'));
    app.$('.folder').click(); app.reveal(); await tick();
    assert.equal(requests, 1);
    assert.equal(app.$('.preview img'), null);
  } finally { app.dom.window.close(); }
});

test('successful cover URLs never expire, including legacy cache entries', async () => {
  for (const legacy of [false, true]) {
    const store = storage();
    const entry = { url: 'https://cdn.example/cover.jpg', at: Date.now() - 365 * 86400000 };
    if (legacy) store.values['citylink:watched:default:previews'] = { 1: entry };
    else store.values['citylink:watched:default:cover:1'] = entry;
    let requests = 0;
    const app = await setup(row(1), { store, fetch: async () => { requests++; throw new Error('unexpected fetch'); } });
    try {
      app.reveal(); app.$('.folder').click(); app.reveal(); await tick();
      assert.equal(app.$('.preview img').src, entry.url);
      assert.equal(requests, 0);
      app.$('.preview img').dispatchEvent(new app.dom.window.Event('error'));
      assert.equal(store.values['citylink:watched:default:cover:1'].url, '');
    } finally { app.dom.window.close(); }
  }
});

test('negative cache prevents repeat fetches and expired cache can recover', async () => {
  const store = storage();
  let requests = 0;
  const fetch = async () => { requests++; return { ok: true, text: async () => '<div class="message-body">No images</div>' }; };
  const app = await setup(row(1), { store, fetch });
  app.reveal(); await tick(); await tick(); app.dom.window.close();
  const cached = await setup(row(1), { store, fetch });
  cached.reveal(); await tick(); cached.dom.window.close();
  assert.equal(requests, 1);
  store.values['citylink:watched:default:cover:1'].at -= 3600001;
  const expired = await setup(row(1), { store, fetch });
  expired.reveal(); await tick(); await tick(); expired.dom.window.close();
  assert.equal(requests, 2);
});

test('429 pauses queued covers and persists cooldown across page reloads', async () => {
  for (const retry of ['120', new Date(Date.now() + 180000).toUTCString(), null]) {
    const store = storage();
    const requests = [];
    const fetch = async url => { requests.push(String(url)); return { ok: false, status: 429, headers: { get: () => retry } }; };
    const app = await setup(row(1) + row(2), { store, fetch });
    try {
      app.reveal(); await tick(); await tick();
      assert.equal(requests.length, 1);
      assert.ok(store.values['citylink:watched:cooldown:https://simpcity.cr'] > Date.now() + 100000);
      app.$('.folder').click(); app.reveal(); await tick();
      assert.equal(requests.length, 1);
      const fresh = await setup(row(1), { store, fetch, pages: 2 });
      try { fresh.reveal(); await tick(); assert.equal(requests.length, 1); }
      finally { fresh.dom.window.close(); }
    } finally { app.dom.window.close(); }
  }
});

test('cover queue runs one at a time and drops disconnected jobs', async () => {
  const pending = [];
  const app = await setup(row(1) + row(2) + row(3), { fetch: url => new Promise(resolve => pending.push({ url, resolve })) });
  try {
    app.reveal(); assert.equal(pending.length, 1);
    app.$('[data-section="favourites"]').click();
    pending[0].resolve({ ok: true, text: async () => '<div class="message-body">No image</div>' });
    await tick(); await tick();
    assert.equal(pending.length, 1);
  } finally { app.dom.window.close(); }
});

test('queued covers wait at least 1.5 seconds between requests', async () => {
  const times = [];
  const app = await setup(row(1) + row(2), { fetch: async () => {
    times.push(Date.now());
    return { ok: true, text: async () => '<div class="message-body">No image</div>' };
  } });
  try {
    app.reveal(); await tick(); await tick();
    assert.equal(times.length, 1);
    await new Promise(resolve => setTimeout(resolve, 1600));
    assert.equal(times.length, 2);
    assert.ok(times[1] - times[0] >= 1500);
  } finally { app.dom.window.close(); }
});

test('list previews support lazy attributes, srcset, and explicit preview metadata', async () => {
  for (const media of [
    '<img data-lazy-src="/cover.jpg">',
    '<img data-url="/cover.jpg">',
    '<picture><source srcset="/cover.jpg 1x, /large.jpg 2x"><img src="/fallback.jpg"></picture>',
    '<span data-preview-url="/cover.jpg"></span>',
    '<video poster="/cover.jpg"></video>',
  ]) {
    const app = await setup(withPreview(1, '<img src="/avatars/1.jpg">' + media));
    try { assert.equal(app.$('.preview img').src, 'https://simpcity.cr/cover.jpg'); }
    finally { app.dom.window.close(); }
  }
});
