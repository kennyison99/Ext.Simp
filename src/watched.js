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
  const coverPrefix = namespace + 'cover:';
  const cooldownKey = `citylink:watched:cooldown:${location.origin}`;
  const covers = new Map();
  const brokenNative = new Set();
  const coverQueue = new Map();
  let coverRunning = false;
  let nextCoverAt = 0;
  let coverTimer;
  let cooldownUntil = 0;
  const coverObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      coverObserver.unobserve(entry.target);
      queueCover(entry.target);
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
      <header><div><h2>Watched threads</h2>
        <p class="muted" data-status role="status" aria-live="polite"></p></div>
        <button type="button" data-original>Forum view</button></header>
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
    if (!nativeView) render();
    $('[data-original]').textContent = nativeView ? 'Back to CityLink' : 'Original forum view';
  });
  $('[data-retry]').addEventListener('click', () => loadPages([...failed]));

  try {
    const values = await chrome.storage.local.get(null);
    cooldownUntil = Number(values[cooldownKey]) || 0;
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith(coverPrefix) && validCover(value)) covers.set(key.slice(coverPrefix.length), value);
    }
    for (const [id, value] of Object.entries(values[namespace + 'previews'] || {})) {
      if (!covers.has(id) && validCover(value)) covers.set(id, value);
    }
    Object.entries(values).forEach(([key, value]) => { if (key.startsWith(favouritePrefix) && value === true) favourites.add(key.slice(favouritePrefix.length)); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let changed = false;
      for (const [key, value] of Object.entries(changes)) {
        if (key === cooldownKey) cooldownUntil = Math.max(cooldownUntil, Number(value.newValue) || 0);
        if (key.startsWith(coverPrefix)) {
          const id = key.slice(coverPrefix.length);
          if (validCover(value.newValue)) covers.set(id, value.newValue); else covers.delete(id);
        }
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
  function findPreview(row) {
    // Prefer media already present in the watched list.
    // The forum uses an avatar wrapper and a transparent src for thread thumbnails.
    for (const media of row.querySelectorAll('.dcThumbnail img, .dcThumbnail')) {
      const background = media.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
      const url = imageUrl(background) || imageUrl(media.getAttribute('data-src')) || imageUrl(media.getAttribute('src'));
      if (url) return url;
    }
    const candidates = row.querySelectorAll('[data-preview-url], [data-thumbnail-url], video[poster], img, picture source');
    for (const media of candidates) {
      if (media.closest('.avatar, .structItem-cell--latest') ||
        /avatar|smilie|emoji|reaction/i.test(String(media.className))) continue;
      const srcset = media.getAttribute('data-srcset') || media.getAttribute('srcset') || '';
      for (const value of [
        media.getAttribute('data-preview-url'), media.getAttribute('data-thumbnail-url'),
        media.getAttribute('poster'), media.getAttribute('data-src'),
        media.getAttribute('data-original'), media.getAttribute('data-lazy-src'),
        media.getAttribute('data-url'), ...srcset.split(',').map(part => part.trim().split(/\s+/)[0]),
        media.currentSrc, media.getAttribute('src'),
      ]) {
        const url = imageUrl(value);
        if (url && !/avatar|smilie|emoji|reaction|placeholder|spacer|transparent/i.test(new URL(url).pathname)) return url;
      }
    }
    return '';
  }
  function preview(record, small = false) {
    const box = document.createElement('span');
    box.className = `preview${small ? ' preview-small' : ''}`;
    box.dataset.previewId = record.id;
    box.dataset.threadUrl = record.url.replace(/(\/threads\/[^/?#]+\.\d+)(?:\/[^?#]*)?(?:[?#].*)?$/, '$1/');
    box.setAttribute('aria-hidden', 'true');
    box.append(text('span', record.title.trim().slice(0, 2).toUpperCase(), 'preview-initial'));
    const nativeUrl = brokenNative.has(record.id) ? '' : record.previewUrl;
    const cached = covers.get(record.id);
    const url = nativeUrl || (validCover(cached) ? cached.url : '');
    if (url) paintCover(box, url, !!nativeUrl);
    else box.dataset.needsCover = 'true';
    return box;
  }
  function paintCover(box, url, native = false) {
      box.querySelector('img')?.remove();
      delete box.dataset.needsCover;
      const img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => box.classList.add('has-image'), { once: true });
      img.addEventListener('error', () => {
        img.remove(); box.classList.remove('has-image');
        if (!native) { rememberCover(box.dataset.previewId, ''); return; }
        brokenNative.add(box.dataset.previewId);
        box.dataset.needsCover = 'true';
        observeCover(box);
      }, { once: true });
      img.src = url; box.append(img);
  }
  function validCover(entry) {
    return !!entry && typeof entry.url === 'string' && (!entry.url || !!imageUrl(entry.url)) &&
      Number.isFinite(entry.at) && (entry.url !== '' || (entry.at <= Date.now() && Date.now() - entry.at < 3600000));
  }
  function rememberCover(id, url) {
    const entry = { url, at: Date.now() };
    covers.set(id, entry);
    chrome.storage.local.set({ [coverPrefix + id]: entry }).catch(() => {});
  }
  async function respectRateLimit(response) {
    if (response.status !== 429) return;
    const retry = response.headers?.get('Retry-After');
    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - Date.now();
    cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 5 * 60000));
    await chrome.storage.local.set({ [cooldownKey]: cooldownUntil }).catch(() => {});
    $('[data-status]').textContent += ' · Requests paused; try again later';
  }
  function observeCover(box) {
    if (coverObserver) coverObserver.observe(box); else queueCover(box);
  }
  function queueCover(box) {
    if (!box.isConnected || nativeView) return;
    const id = box.dataset.previewId;
    const cached = covers.get(id);
    if (validCover(cached)) { if (cached.url) paintCover(box, cached.url); return; }
    if (!coverQueue.has(id)) coverQueue.set(id, new Set());
    coverQueue.get(id).add(box);
    drainCovers();
  }
  function postCover(doc, base) {
    for (const media of doc.querySelectorAll('.message-body img, .attachment--image img, .message-body video[poster]')) {
      if (media.closest('.bbCodeBlock--quote, .bbCodeBlock--spoiler') || /avatar|smilie|emoji/i.test(media.className)) continue;
      for (const field of ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'poster', 'src']) {
        const url = imageUrl(media.getAttribute(field), base);
        if (url && !/avatar|smilie|emoji|placeholder|spacer/i.test(new URL(url).pathname)) return url;
      }
    }
    for (const link of doc.querySelectorAll('.message-body a[href], .attachment--image a[href]')) {
      if (link.closest('.bbCodeBlock--quote, .bbCodeBlock--spoiler')) continue;
      const url = imageUrl(link.getAttribute('href'), base);
      if (url && /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(url)) return url;
    }
    return imageUrl(doc.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.content, base);
  }
  async function drainCovers() {
    if (coverRunning || loading || nativeView || Date.now() < cooldownUntil) return;
    clearTimeout(coverTimer);
    for (const [id, boxes] of coverQueue) {
      for (const box of boxes) if (!box.isConnected) boxes.delete(box);
      if (!boxes.size) { coverQueue.delete(id); continue; }
      if (Date.now() < nextCoverAt) { coverTimer = setTimeout(drainCovers, nextCoverAt - Date.now()); return; }
      const cached = covers.get(id);
      if (validCover(cached)) {
        if (cached.url) for (const box of boxes) paintCover(box, cached.url);
        coverQueue.delete(id); continue;
      }
      coverRunning = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const url = [...boxes][0].dataset.threadUrl;
        const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        await respectRateLimit(response);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const cover = postCover(new DOMParser().parseFromString(await response.text(), 'text/html'), url);
        rememberCover(id, cover);
        if (cover) for (const box of boxes) if (box.isConnected) paintCover(box, cover);
      } catch { if (Date.now() >= cooldownUntil) rememberCover(id, ''); }
      finally {
        clearTimeout(timeout); coverQueue.delete(id); coverRunning = false;
        nextCoverAt = Date.now() + 1500;
      }
      drainCovers(); return;
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
      return [{ id, url, title, tags, category, author, previewUrl: findPreview(element), unread: element.classList.contains('is-unread'),
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
        if (Date.now() < cooldownUntil) { failed.add(page); continue; }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const url = new URL(location.href); url.searchParams.set('page', page); url.hash = '';
          const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
          await respectRateLimit(response);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          const rows = [...doc.querySelectorAll('.structItemContainer .structItem--thread')];
          if (!rows.length) throw new Error('No threads found');
          pages.set(page, rows); failed.delete(page); rebuild();
        } catch { failed.add(page); }
        finally { clearTimeout(timer); render(); }
      }
    }));
    loading = false; render(); drainCovers();
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
    coverObserver?.disconnect();
    const favouriteCount = records.filter(record => favourites.has(record.id)).length;
    const unreadCount = records.filter(record => record.unread).length;
    $('[data-status]').textContent = `${records.length} threads · ${pages.size}/${pageCount} pages loaded${loading ? ' · Loading…' : ''}${Date.now() < cooldownUntil ? ' · Requests paused; try again later' : ''}`;
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
      button.append(text('strong', category), text('span', `${rows.length} threads · ${rows.filter(row => row.unread).length} unread`, 'muted'));
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
    if (!nativeView) items.querySelectorAll('[data-needs-cover]').forEach(observeCover);
  }

  function styles() {
    return `
      :host{display:block;color:inherit;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--line:rgba(140,150,168,.22);--muted:#a1a5ad;--accent:#d9dde4;--surface:rgba(128,145,170,.08);margin:24px 0;scroll-margin-top:80px}
      *{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}
      button{cursor:pointer;color:inherit;background:transparent;border:1px solid var(--line);border-radius:5px;padding:8px 12px}button:hover{background:var(--surface)}button:disabled{opacity:.45;cursor:default}
      button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}
      .library{padding:8px 4px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}header button{font-size:12px;border:0;color:var(--muted)}
      h2{font-size:26px;font-weight:600;letter-spacing:-.7px;margin:0 0 5px}h3{font-size:15px;font-weight:600;margin:0 0 2px}.muted{color:var(--muted);font-size:12px}p{margin:0}
      .search-row{display:flex;gap:10px}.search{display:flex;gap:10px;align-items:center;flex:1;border-bottom:1px solid var(--line);padding:8px 0}.search span{font-size:24px;color:var(--muted)}input{width:100%;border:0;background:transparent;color:inherit;padding:4px;min-width:0}input::placeholder{color:var(--muted)}
      nav{display:flex;gap:24px;flex-wrap:wrap;margin-top:18px;border-bottom:1px solid var(--line)}nav button{padding:10px 0;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--muted)}nav button[aria-pressed=true]{color:inherit;border-bottom-color:currentColor}
      .results-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:24px 0 20px}.controls{display:flex;gap:12px;font-size:12px}.controls label{display:flex;align-items:center;gap:7px;color:var(--muted)}select{background:#242424;color:#eee;border:1px solid var(--line);border-radius:4px;padding:6px;max-width:180px}.back{font-size:12px;border:0;padding:0;margin-bottom:8px;color:var(--muted)}
      .items{display:grid;gap:28px 24px}.folders,.cards{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.folder{display:flex;flex-direction:column;align-items:flex-start;padding:16px 0;text-align:left;gap:4px;min-width:0;border:0;border-top:1px solid var(--line);border-radius:0}.folder strong{font-size:15px;font-weight:600;overflow-wrap:anywhere}
      .card{min-width:0;display:flex;flex-direction:column;gap:8px}.card-top{display:flex;align-items:center;gap:8px;min-width:0}.tag{color:var(--muted);font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.unread{font-size:10px;color:var(--accent)}.unread:before{content:'● ';font-size:7px}.star{margin-left:auto;padding:0;width:30px;height:30px;flex-shrink:0;font-size:22px;line-height:1;border:0;color:var(--muted)}.star[aria-pressed=true]{color:inherit}
      .cover{display:block;border-radius:4px;overflow:hidden}.preview{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/10;overflow:hidden;background:var(--surface);color:var(--muted)}.preview-initial{font-size:24px;font-weight:400;letter-spacing:2px;opacity:.5}.preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.preview.has-image .preview-initial{visibility:hidden}
      .folder-contents{display:flex;flex-direction:column;gap:12px;margin-top:16px;width:100%}.folder-entry{display:flex;align-items:center;gap:12px;min-width:0}.preview-small{width:40px;height:40px;aspect-ratio:1;border-radius:3px;flex-shrink:0}.preview-small .preview-initial{font-size:13px}.folder-entry-title{font-size:12px;line-height:1.4;font-weight:400;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
      .thread-title{font-size:14px;font-weight:550;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;min-height:42px}.card-bottom{display:flex;gap:12px;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:auto}.author{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-bottom a{flex-shrink:0}
      .compact{grid-template-columns:1fr;gap:0}.compact .card{display:grid;grid-template-columns:56px 140px minmax(0,1fr) 150px;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}.compact .cover .preview{aspect-ratio:1}.compact .thread-title{min-height:0}.compact .card-bottom{margin:0;flex-direction:column;gap:2px;text-align:right}
      footer{display:flex;justify-content:center;align-items:center;gap:20px;margin-top:32px;font-size:12px}.empty{padding:48px 12px;text-align:center;color:var(--muted)}.notice{padding:12px;margin-top:12px;border-left:2px solid #aa8344;color:#dcb772}.notice button{margin-left:8px;font-size:12px}
      @media(max-width:700px){header{align-items:flex-start}h2{font-size:22px}header button{max-width:100px}.results-head{align-items:flex-start;flex-direction:column}.controls{flex-wrap:wrap}.folders,.cards{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:24px 16px}.compact .card{grid-template-columns:48px minmax(0,1fr);gap:4px 12px}.compact .cover{grid-row:1/4}.compact .card-bottom{flex-direction:row;text-align:left;grid-column:2}.compact .thread-title{grid-column:2}nav{gap:16px}nav button{font-size:12px}.search-row{flex-wrap:wrap}}
      :host([data-theme=light]){--muted:#636970;--accent:#30343b}:host([data-theme=light]) select{background:#fff;color:#242424}
    `;
  }
})().catch(error => {
  // Never strand the user without the native forum list if enhancement fails.
  document.getElementById('citylink-watched')?.remove();
  const container = document.querySelector('.structItemContainer');
  if (container) (container.closest('.block') || container).style.removeProperty('display');
  console.error('[CityLink] Watched enhancement failed', error);
});
