(async () => {
  if (document.getElementById('citylink-watched')) return;
  const container = [...document.querySelectorAll('.structItemContainer')]
    .find(item => item.querySelector(':scope > .structItem--thread'));
  if (!container) return;
  const original = container.closest('.block') || container;
  const originalDisplay = original.style.display;
  const PAGE_SIZE = 24;
  const ignored = new Set(['request', 'identify', 'megathread!', 'onlyfans', 'fansly', 'pornhub', 'patreon',
    'fantia', 'fanbox', 'twitter', 'twitter / x', 'twitter / 𝕏', 'tiktok', 'instagram', 'reddit', 'snapchat', 'twitch', 'youtube']);
  const account = document.querySelector('.p-navgroup-link--user [data-user-id]')?.dataset.userId ||
    document.querySelector('.p-navgroup-link--user')?.textContent.trim() || 'default';
  const namespace = `citylink:watched:${encodeURIComponent(account)}:`;
  const stateKey = namespace + 'view';
  const favouritePrefix = namespace + 'favourite:';
  const previewKey = namespace + 'previews';
  const previews = new Map();
  const previewJobs = new Map();
  let previewActive = 0;
  let previewSaveTimer;
  const previewObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      previewObserver.unobserve(entry.target);
      queuePreview(entry.target);
    }
  }, { rootMargin: '150px' }) : null;
  const favourites = new Set();
  const saving = new Set();
  const pages = new Map();
  const failed = new Set();
  let records = [];
  let loading = true;
  let nativeView = false;
  let touched = false;
  let storageError = '';
  let state = { section: 'folders', folder: '', query: '', order: 'updated', layout: 'cards', page: 1, scroll: 0 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(stateKey) || 'null');
    if (saved && typeof saved === 'object') state = { ...state, ...saved };
  } catch { /* Session storage is optional. */ }
  if (!['folders', 'all', 'favourites', 'unread', 'folder'].includes(state.section)) state.section = 'folders';
  if (!['updated', 'newest', 'oldest', 'title'].includes(state.order)) state.order = 'updated';
  if (!['cards', 'compact'].includes(state.layout)) state.layout = 'cards';
  state.query = typeof state.query === 'string' ? state.query : '';
  state.page = Math.max(1, Math.floor(Number(state.page) || 1));
  const restoreScroll = Math.max(0, Number(state.scroll) || 0);
  const currentPage = Number(new URL(location.href).searchParams.get('page')) || 1;
  const pageCount = Math.max(currentPage, 1, ...[...document.querySelectorAll('a[href*="/watched/threads"]')].map(a => {
    try { return Number(new URL(a.href, location.href).searchParams.get('page')) || 1; } catch { return 1; }
  }));
  pages.set(currentPage, [...container.children].filter(item => item.matches('.structItem--thread')));

  const host = document.createElement('section');
  host.id = 'citylink-watched';
  const inherited = getComputedStyle(original).color.match(/\d+/g)?.map(Number) || [220, 220, 220];
  host.dataset.theme = document.documentElement.dataset.colorScheme ||
    (inherited[0] * .299 + inherited[1] * .587 + inherited[2] * .114 > 140 ? 'dark' : 'light');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${styles()}</style>
    <div class="library">
      <header><div><div class="eyebrow">CITYLINK / YOUR LIBRARY</div><h2>Watched threads</h2>
        <p class="muted" data-status role="status" aria-live="polite"></p></div>
        <button type="button" data-original>Original forum view</button></header>
      <div class="workspace">
        <div class="search-row"><label class="search"><span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Search titles, tags or authors…" aria-label="Search all watched threads">
        </label><button type="button" data-clear hidden>Clear search</button></div>
        <nav aria-label="Watched views">
          <button type="button" data-section="folders">Folders</button>
          <button type="button" data-section="all">All threads</button>
          <button type="button" data-section="favourites">★ Favourites</button>
          <button type="button" data-section="unread">Unread</button>
        </nav>
        <div class="notice" data-error role="alert" hidden></div>
        <div class="notice" data-partial hidden><span></span> <button type="button" data-retry>Retry missing pages</button></div>
        <div class="results-head"><div><button class="back" type="button" data-back hidden>← Folders</button>
          <h3 data-heading></h3><span class="muted" data-count></span></div>
          <div class="controls"><label>Sort <select aria-label="Sort watched threads">
            <option value="updated">Recently updated</option><option value="newest">Thread created: newest</option>
            <option value="oldest">Thread created: oldest</option><option value="title">Title A–Z</option></select></label>
          <label>View <select aria-label="Watched layout"><option value="cards">Cards</option><option value="compact">Compact list</option></select></label></div>
        </div>
        <div class="items"></div>
        <p class="empty" hidden></p>
        <footer><button type="button" data-prev>← Previous</button><span data-page aria-live="polite"></span><button type="button" data-next>Next →</button></footer>
      </div>
    </div>`;
  original.before(host);
  original.style.display = 'none';
  const $ = selector => shadow.querySelector(selector);
  const input = $('input');
  input.value = state.query;
  $('select[aria-label="Sort watched threads"]').value = state.order;
  $('select[aria-label="Watched layout"]').value = state.layout;

  function saveState() {
    try { sessionStorage.setItem(stateKey, JSON.stringify({ ...state, scroll: window.scrollY })); } catch { /* Optional. */ }
  }
  window.addEventListener('pagehide', saveState);
  function change(update, scroll = false) {
    touched = true;
    state = { ...state, page: 1, ...update };
    saveState(); render();
    if (scroll) host.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }
  input.addEventListener('input', () => change({ query: input.value }));
  $('[data-clear]').addEventListener('click', () => { input.value = ''; change({ query: '' }); input.focus(); });
  $('[data-back]').addEventListener('click', () => change({ section: 'folders', folder: '' }));
  shadow.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    input.value = ''; change({ section: button.dataset.section, folder: '', query: '' });
  }));
  $('select[aria-label="Sort watched threads"]').addEventListener('change', event => change({ order: event.target.value }));
  $('select[aria-label="Watched layout"]').addEventListener('change', event => change({ layout: event.target.value, page: state.page }));
  $('[data-prev]').addEventListener('click', () => change({ page: state.page - 1 }, true));
  $('[data-next]').addEventListener('click', () => change({ page: state.page + 1 }, true));
  $('[data-original]').addEventListener('click', () => {
    nativeView = !nativeView;
    original.style.display = nativeView ? originalDisplay : 'none';
    $('.workspace').hidden = nativeView;
    $('[data-original]').textContent = nativeView ? 'Back to CityLink' : 'Original forum view';
  });
  $('[data-retry]').addEventListener('click', () => loadPages([...failed]));

  try {
    const values = await chrome.storage.local.get(null);
    for (const [id, entry] of Object.entries(values[previewKey] || {})) {
      if (entry && typeof entry.url === 'string' && Number.isFinite(entry.at) &&
        Date.now() - entry.at < (entry.url ? 7 * 86400000 : 3600000)) previews.set(id, entry);
    }
    Object.entries(values).forEach(([key, value]) => { if (key.startsWith(favouritePrefix) && value === true) favourites.add(key.slice(favouritePrefix.length)); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let changed = false;
      for (const [key, value] of Object.entries(changes)) {
        if (!key.startsWith(favouritePrefix)) continue;
        const id = key.slice(favouritePrefix.length);
        if (saving.has(id)) continue;
        if (value.newValue === true) favourites.add(id); else favourites.delete(id);
        changed = true;
      }
      if (changed) render();
    });
  } catch { storageError = 'Favourites cannot be loaded. Reload the extension and this page to enable saving.'; }
  rebuild(); render();
  await loadPages(Array.from({ length: pageCount }, (_, index) => index + 1).filter(page => page !== currentPage));
  if (!touched && restoreScroll) requestAnimationFrame(() => window.scrollTo(0, restoreScroll));

  function text(tag, value, className = '') {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function timeValue(element) {
    return Date.parse(element?.dateTime || '') / 1000 || Number(element?.dataset.timestamp) || Number(element?.dataset.time) || 0;
  }
  function safeLink(value) {
    try { const url = new URL(value, location.href); return url.origin === location.origin ? url.href : ''; } catch { return ''; }
  }
  function imageUrl(value, base = location.href) {
    if (!value) return '';
    try {
      const url = new URL(value, base);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function findPreview(doc, base) {
    const candidates = [];
    const add = value => {
      const url = imageUrl(value, base);
      if (!url || candidates.includes(url)) return;
      const parsed = new URL(url);
      if (/\/(?:smilies|emoji|avatars|emoticons)\//i.test(parsed.pathname) ||
        /(?:avatar|smilie|emoji|reaction)/i.test(parsed.pathname + parsed.search)) return;
      candidates.push(url);
    };
    // Prefer an explicit forum attachment or the page's OpenGraph image.
    doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(meta => add(meta.content));
    for (const img of doc.querySelectorAll('.message-body img, .attachment--image img, .bbImage')) {
      if (img.closest('.bbCodeBlock--quote, .bbCodeBlock--spoiler') ||
        /smilie|emoji|avatar/i.test(String(img.className)) ||
        (img.getAttribute('width') && Number(img.getAttribute('width')) < 80)) continue;
      for (const value of [img.getAttribute('data-src'), img.getAttribute('data-original'), img.getAttribute('data-lazy-src'), img.getAttribute('data-url'), img.currentSrc, img.getAttribute('src')]) add(value);
    }
    // Some forum hosts render an image as a normal attachment link without an img tag.
    for (const link of doc.querySelectorAll('.message-body a[href], .attachment a[href], .attachment--image a[href], a.js-lbImage-attachment')) {
      const href = link.getAttribute('href') || '';
      const dataHref = link.getAttribute('data-url') || link.getAttribute('data-src') || href;
      if (/\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(href) ||
        /(?:goonbox\.[^/]+\/img\/|attachment|image|lightbox|media)/i.test(`${href} ${link.className}`)) add(dataHref);
    }
    for (const media of doc.querySelectorAll('.message-body video[poster], .message-body iframe[data-src], .message-body [data-preview-url]')) {
      add(media.getAttribute('poster') || media.getAttribute('data-preview-url') || media.getAttribute('data-src'));
    }
    return candidates[0] || '';
  }
  function preview(record, small = false) {
    const box = document.createElement('span');
    box.className = `preview${small ? ' preview-small' : ''}`;
    box.dataset.previewId = record.id;
    box.dataset.previewTitle = record.title;
    // Fetch the canonical first page rather than an /unread URL that can jump between pages.
    box.dataset.previewUrl = record.url.replace(/(\/threads\/[^/?#]+\.\d+)(?:\/[^?#]*)?(?:[?#].*)?$/, '$1/');
    box.dataset.previewLatestUrl = record.latestUrl || box.dataset.previewUrl;
    box.append(text('span', record.title.trim().slice(0, 2).toUpperCase(), 'preview-initial'));
    box.append(text('span', 'Preview', 'preview-caption'));
    box.setAttribute('aria-hidden', 'true');
    return box;
  }
  function paintPreview(box, url) {
    if (!box.isConnected) return;
    box.querySelector('img')?.remove();
    box.classList.remove('has-image');
    const fallback = !url;
    const source = url || placeholderUrl(box.dataset.previewTitle || '?');
    box.querySelector('.preview-caption').textContent = fallback ? 'Generated cover' : 'Preview';
    const img = document.createElement('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { box.classList.add('has-image'); if (fallback) box.classList.add('generated'); }, { once: true });
    img.addEventListener('error', () => {
      if (!fallback) { rememberPreview(box.dataset.previewId, ''); paintPreview(box, ''); }
    }, { once: true });
    img.src = source; box.append(img);
  }
  function placeholderUrl(title) {
    const label = String(title || '?').trim().slice(0, 2).toUpperCase() || '?';
    const hue = [...label].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 56% 30%)"/><stop offset="1" stop-color="hsl(${(hue + 55) % 360} 46% 18%)"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><circle cx="535" cy="72" r="130" fill="white" opacity=".06"/><text x="320" y="225" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="108" font-weight="700" fill="white" opacity=".82">${escapeXml(label)}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  function escapeXml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character])); }
  function rememberPreview(id, url) {
    previews.set(id, { url, at: Date.now() });
    clearTimeout(previewSaveTimer);
    previewSaveTimer = setTimeout(() => {
      const entries = [...previews].sort(([, a], [, b]) => b.at - a.at).slice(0, 600);
      chrome.storage.local.set({ [previewKey]: Object.fromEntries(entries) }).catch(() => {});
    }, 300);
  }
  function queuePreview(box) {
    const id = box.dataset.previewId;
    if (previews.has(id)) { paintPreview(box, imageUrl(previews.get(id).url)); return; }
    if (!previewJobs.has(id)) previewJobs.set(id, { urls: [box.dataset.previewLatestUrl, box.dataset.previewUrl].filter((url, index, list) => url && list.indexOf(url) === index), boxes: new Set(), running: false });
    previewJobs.get(id).boxes.add(box);
    drainPreviews();
  }
  function drainPreviews() {
    for (const [id, job] of previewJobs) {
      if (previewActive >= 2) break;
      if (job.running) continue;
      if (![...job.boxes].some(box => box.isConnected)) { previewJobs.delete(id); continue; }
      job.running = true; previewActive++;
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let url = '';
        for (const sourceUrl of job.urls) {
          try {
            const response = await fetch(sourceUrl, { credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            url = findPreview(new DOMParser().parseFromString(await response.text(), 'text/html'), sourceUrl);
            if (url) break;
          } catch { /* Try the canonical page if the latest page is unavailable. */ }
        }
        clearTimeout(timer);
        rememberPreview(id, url);
        for (const box of job.boxes) paintPreview(box, url);
      })().finally(() => { previewJobs.delete(id); previewActive--; drainPreviews(); });
    }
  }
  function rebuild() {
    const seen = new Set();
    records = [...pages].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows).flatMap(element => {
      const link = element.querySelector('.structItem-title a[href*="/threads/"]');
      const url = link && safeLink(link.getAttribute('href'));
      if (!url) return [];
      const id = element.className.match(/\bjs-threadListItem-(\d+)\b/)?.[1] || new URL(url).pathname.match(/\.(\d+)(?:\/|$)/)?.[1];
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const tags = [...element.querySelectorAll('.structItem-title .label')].map(label => label.textContent.trim()).filter(Boolean);
      const forum = element.querySelector('.structItem-parts a[href*="/forums/"]')?.textContent.trim() || '';
      const category = tags.find(tag => !ignored.has(tag.toLowerCase())) || forum || tags[0] || 'Untagged';
      const latest = element.querySelector('.structItem-latestDate, .structItem-cell--latest time');
      const author = element.dataset.author || element.querySelector('.structItem-parts .username')?.textContent.trim() || '';
      const title = link.textContent.trim();
      return [{ id, url, title, tags, category, author, unread: element.classList.contains('is-unread'),
        created: timeValue(element.querySelector('.structItem-startDate time')), updated: timeValue(latest),
        latestText: latest?.textContent.trim() || 'No update date', latestUrl: safeLink(latest?.closest('a')?.getAttribute('href') || url),
        search: `${title} ${tags.join(' ')} ${category} ${forum} ${author}`.normalize('NFKC').toLowerCase() }];
    });
  }

  async function loadPages(numbers) {
    loading = true; render();
    const queue = [...numbers];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const page = queue.shift();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const url = new URL(location.href); url.searchParams.set('page', page); url.hash = '';
          const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          const rows = [...doc.querySelectorAll('.structItemContainer .structItem--thread')];
          if (!rows.length) throw new Error('No threads found');
          pages.set(page, rows); failed.delete(page); rebuild();
        } catch { failed.add(page); }
        finally { clearTimeout(timer); render(); }
      }
    }));
    loading = false; render();
  }

  async function toggleFavourite(record) {
    if (saving.has(record.id)) return;
    const previous = favourites.has(record.id);
    saving.add(record.id);
    if (previous) favourites.delete(record.id); else favourites.add(record.id);
    render();
    try {
      await chrome.storage.local.set({ [favouritePrefix + record.id]: !previous });
      storageError = '';
    } catch {
      if (previous) favourites.add(record.id); else favourites.delete(record.id);
      storageError = 'Favourite could not be saved. Your previous selection has been restored.';
    } finally { saving.delete(record.id); render(); }
    shadow.querySelector(`[data-favourite="${record.id}"]`)?.focus();
  }

  function card(record) {
    const item = document.createElement('article');
    item.className = 'card'; item.dataset.threadId = record.id;
    const top = document.createElement('div'); top.className = 'card-top';
    top.append(text('span', record.category, 'tag'));
    if (record.unread) top.append(text('span', 'Unread', 'unread'));
    const star = text('button', favourites.has(record.id) ? '★' : '☆', 'star');
    star.type = 'button'; star.dataset.favourite = record.id;
    star.setAttribute('aria-label', `${favourites.has(record.id) ? 'Remove from' : 'Add to'} favourites: ${record.title}`);
    star.setAttribute('aria-pressed', String(favourites.has(record.id)));
    star.title = favourites.has(record.id) ? 'Remove favourite' : 'Add favourite';
    star.disabled = saving.has(record.id);
    star.addEventListener('click', () => toggleFavourite(record)); top.append(star);
    const title = text('a', record.title, 'thread-title'); title.href = record.url; title.title = record.title;
    const bottom = document.createElement('div'); bottom.className = 'card-bottom';
    const latest = text('a', record.latestText); latest.href = record.latestUrl; latest.title = 'Open latest post';
    bottom.append(text('span', record.author || 'Thread', 'author'), latest);
    const cover = document.createElement('a'); cover.className = 'cover'; cover.href = record.url;
    cover.setAttribute('aria-label', `Open thread: ${record.title}`);
    cover.append(preview(record));
    item.append(cover, top, title, bottom);
    return item;
  }

  function render() {
    const favouriteCount = records.filter(record => favourites.has(record.id)).length;
    const unreadCount = records.filter(record => record.unread).length;
    $('[data-status]').textContent = `${records.length} threads · ${pages.size}/${pageCount} pages loaded${loading ? ' · Loading…' : ''}`;
    $('[data-error]').hidden = !storageError; $('[data-error]').textContent = storageError;
    $('[data-partial]').hidden = !failed.size;
    $('[data-partial] span').textContent = `${failed.size} pages could not be loaded. Search and counts are incomplete.`;
    $('[data-retry]').disabled = loading;
    $('[data-clear]').hidden = !state.query;
    const query = state.query.trim().normalize('NFKC').toLowerCase();
    for (const [section, label] of [['folders', 'Folders'], ['all', `All threads (${records.length})`], ['favourites', `★ Favourites (${favouriteCount})`], ['unread', `Unread (${unreadCount})`]]) {
      const button = $(`[data-section="${section}"]`);
      button.textContent = label; button.setAttribute('aria-pressed', String(!query && state.section === section));
    }
    const folders = state.section === 'folders' && !query;
    $('[data-back]').hidden = state.section !== 'folder' || !!query;
    $('.controls').hidden = folders;
    $('[data-heading]').textContent = query ? 'Search results · all folders' :
      ({ folders: 'Your folders', all: 'All threads', favourites: 'Favourites', unread: 'Unread threads', folder: state.folder })[state.section];
    previewObserver?.disconnect();
    const items = $('.items'); items.replaceChildren();
    items.className = `items ${folders ? 'folders' : state.layout}`;
    let results;
    if (folders) {
      const groups = new Map();
      records.forEach(record => { if (!groups.has(record.category)) groups.set(record.category, []); groups.get(record.category).push(record); });
      results = [...groups].sort(([a], [b]) => a.localeCompare(b));
    } else {
      results = records.filter(record => query ? query.split(/\s+/).every(word => record.search.includes(word)) :
        state.section === 'favourites' ? favourites.has(record.id) : state.section === 'unread' ? record.unread :
        state.section === 'folder' ? record.category === state.folder : true);
      results.sort((a, b) => {
        if (state.order === 'title') return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        const value = state.order === 'newest' ? b.created - a.created : state.order === 'oldest' ? a.created - b.created : b.updated - a.updated;
        return value || a.title.localeCompare(b.title);
      });
    }
    const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    if (!loading || touched) state.page = Math.min(state.page, totalPages);
    const displayPage = Math.min(state.page, totalPages);
    results.slice((displayPage - 1) * PAGE_SIZE, displayPage * PAGE_SIZE).forEach(result => {
      if (!folders) { items.append(card(result)); return; }
      const [category, rows] = result;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'folder';
      const icon = text('span', '', 'folder-icon'); icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg width="30" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/><path d="M3 9h18"/></svg>';
      button.append(icon, text('strong', category), text('span', `${rows.length} threads · ${rows.filter(row => row.unread).length} unread`, 'muted'));
      const contents = document.createElement('span'); contents.className = 'folder-contents';
      [...rows].sort((a, b) => b.updated - a.updated || a.title.localeCompare(b.title)).slice(0, 3).forEach(record => {
        const entry = document.createElement('span'); entry.className = 'folder-entry';
        entry.append(preview(record, true), text('span', record.title, 'folder-entry-title'));
        contents.append(entry);
      });
      button.append(contents);
      button.setAttribute('aria-label', `Open folder ${category} (${rows.length} threads)`);
      button.addEventListener('click', () => change({ section: 'folder', folder: category })); items.append(button);
    });
    $('[data-count]').textContent = `${results.length} ${folders ? 'folders' : 'threads'}${query ? ' matching your search' : ''}`;
    const empty = $('.empty'); empty.hidden = results.length > 0;
    empty.textContent = loading ? 'Loading your library…' : query ? 'No matching threads. Try another name or tag.' :
      state.section === 'favourites' ? 'No favourites yet. Add a star to any thread to keep it here.' :
      state.section === 'unread' ? 'No unread threads in the loaded pages.' : 'No threads in this folder.';
    $('footer').hidden = results.length <= PAGE_SIZE;
    $('[data-page]').textContent = `Page ${displayPage} of ${totalPages}`;
    $('[data-prev]').disabled = displayPage <= 1;
    $('[data-next]').disabled = displayPage >= totalPages;
    items.querySelectorAll('[data-preview-id]').forEach(box => {
      if (previews.has(box.dataset.previewId)) paintPreview(box, imageUrl(previews.get(box.dataset.previewId).url));
      else previewObserver?.observe(box);
    });
  }

  function styles() {
    return `
      :host{display:block;color:inherit;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--line:rgba(140,150,168,.26);--muted:#939dac;--accent:#79bfff;--surface:rgba(128,145,170,.07);margin:16px 0;scroll-margin-top:80px}
      *{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}
      button{cursor:pointer;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:8px 12px}button:hover{border-color:var(--accent);background:rgba(100,170,230,.1)}button:disabled{opacity:.45;cursor:default}
      button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}
      .library{border:1px solid var(--line);border-radius:14px;padding:24px;background:var(--surface)}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}header button{font-size:12px}
      h2{font-size:26px;letter-spacing:-.7px;margin:2px 0 5px}h3{font-size:18px;margin:0 0 2px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.8px;color:var(--accent)}.muted{color:var(--muted);font-size:12px}p{margin:0}
      .search-row{display:flex;gap:10px}.search{display:flex;gap:12px;align-items:center;flex:1;border:1px solid var(--line);border-radius:10px;padding:8px 14px;background:rgba(128,145,170,.06)}.search span{font-size:24px;color:var(--muted)}input{width:100%;border:0;background:transparent;color:inherit;padding:4px;min-width:0}input::placeholder{color:var(--muted)}
      nav{display:flex;gap:7px;flex-wrap:wrap;padding:16px 0 20px;border-bottom:1px solid var(--line)}nav button{border-color:transparent;background:transparent}nav button[aria-pressed=true]{color:var(--accent);background:rgba(84,161,229,.13);border-color:rgba(84,161,229,.3)}
      .results-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px 0 16px}.controls{display:flex;gap:12px;font-size:12px}.controls label{display:flex;align-items:center;gap:7px;color:var(--muted)}select{background:#242a34;color:#eef2f7;border:1px solid var(--line);border-radius:7px;padding:7px;max-width:180px}.back{font-size:12px;border:0;background:none;padding:0;margin-bottom:8px;color:var(--accent)}
      .items{display:grid;gap:12px}.folders,.cards{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}.folder{display:flex;flex-direction:column;align-items:flex-start;padding:18px;text-align:left;gap:5px;min-width:0}.folder strong{font-size:16px;overflow-wrap:anywhere}.folder-icon{color:var(--accent);font-size:34px;line-height:1.1;margin-bottom:10px}
      .card{min-width:0;border:1px solid var(--line);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;background:rgba(128,145,170,.045)}.card:hover{border-color:rgba(120,180,230,.55)}.card-top{display:flex;align-items:center;gap:8px;min-width:0}.tag{color:var(--muted);font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.unread{font-size:10px;color:var(--accent)}.unread:before{content:'● ';font-size:8px}.star{margin-left:auto;padding:0;width:30px;height:30px;flex-shrink:0;font-size:23px;line-height:1;border-color:transparent;background:transparent;color:var(--muted)}.star[aria-pressed=true]{color:#efc668}
      .cover{display:block;border-radius:7px;overflow:hidden}.preview{position:relative;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;width:100%;aspect-ratio:16/10;overflow:hidden;background:linear-gradient(135deg,rgba(95,155,215,.2),rgba(155,115,190,.1));color:var(--muted)}.preview-initial{font-size:32px;color:var(--accent);opacity:.7}.preview-caption{font-size:10px}.preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .15s}.preview.has-image img{opacity:1}.preview.has-image .preview-initial,.preview.has-image .preview-caption{visibility:hidden}
      .folder-contents{display:flex;flex-direction:column;gap:9px;border-top:1px solid var(--line);padding-top:12px;margin-top:8px;width:100%}.folder-entry{display:flex;align-items:center;gap:10px;min-width:0}.preview-small{width:48px;height:48px;aspect-ratio:1;border-radius:6px;flex-shrink:0}.preview-small .preview-initial{font-size:20px}.preview-small .preview-caption{display:none}.folder-entry-title{font-size:12px;line-height:1.4;font-weight:400;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
      .thread-title{font-size:15px;font-weight:650;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;min-height:44px}.card-bottom{display:flex;gap:12px;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:auto}.author{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-bottom a{flex-shrink:0}
      .compact{grid-template-columns:1fr}.compact .card{display:grid;grid-template-columns:64px 140px minmax(0,1fr) 190px;align-items:center;gap:16px;padding:10px 14px}.compact .cover .preview{aspect-ratio:1}.compact .cover .preview-caption{display:none}.compact .thread-title{min-height:0}.compact .card-bottom{margin:0;flex-direction:column;gap:2px;text-align:right}
      footer{display:flex;justify-content:center;align-items:center;gap:20px;margin-top:24px;font-size:12px}.empty{padding:40px 12px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:10px}.notice{padding:12px;margin-top:12px;border:1px solid #aa8344;border-radius:8px;color:#dcb772}.notice button{margin-left:8px;font-size:12px}
      @media(max-width:700px){.library{padding:16px}header{align-items:flex-start}h2{font-size:22px}header button{max-width:110px}.results-head{align-items:flex-start;flex-direction:column}.controls{flex-wrap:wrap}.folders,.cards{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.compact .card{grid-template-columns:64px minmax(0,1fr);gap:8px 12px}.compact .cover{grid-row:1/4}.compact .card-bottom{flex-direction:row;text-align:left;grid-column:2}.compact .thread-title{grid-column:2}nav{gap:3px}nav button{padding:7px 9px}.search-row{flex-wrap:wrap}}
      :host([data-theme=light]){--muted:#687486;--accent:#2474b5}:host([data-theme=light]) select{background:#fff;color:#243345}
    `;
  }
})().catch(error => {
  // Never strand the user without the native forum list if enhancement fails.
  document.getElementById('citylink-watched')?.remove();
  const container = document.querySelector('.structItemContainer');
  if (container) (container.closest('.block') || container).style.removeProperty('display');
  console.error('[CityLink] Watched enhancement failed', error);
});
