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
  dom.window.fetch = options.fetch || (async () => { throw new Error('unexpected fetch'); });
  await dom.window.eval(script);
  const shadow = dom.window.document.querySelector('#citylink-watched').shadowRoot;
  return { dom, shadow, store, $: selector => shadow.querySelector(selector) };
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
