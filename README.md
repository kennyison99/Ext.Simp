# CityLink — Watched & Downloads

Chrome MV3 extension with watched-thread grouping, Turbo embed ad filtering, and
[SkyCloudDev's ForumPostDownloader](https://github.com/SkyCloudDev/ForumPostDownloader).
No Tampermonkey installation is needed. The old link collector and floating panel
have been removed.

## Install / upgrade

1. Open `chrome://extensions` and enable Developer mode.
2. Load this folder as an unpacked extension, or click Reload on the existing installation.
3. Accept the new download, storage, cookie, and supported-host permissions if Chrome asks.
4. Reload any already-open forum pages. A matching post now has the upstream **Download** control.

Click **Options** beside a post's Download control to configure its download. The upstream options
include ZIP output, host selection, duplicate skipping, generated links/logs, and
skipping media downloads when only links are needed. Chrome saves files under its
configured Downloads directory and handles filename collisions. Large ZIP archives
use memory in the forum tab; upstream's unzipped mode avoids building one large ZIP.

The watched page opens on category folders. Open a folder to see compact cards,
or use All threads, Favourites and Unread. Search spans all loaded pages and folders;
each view shows at most 24 items per page. A compact list layout is also available.
Folders preview their three most recently updated threads with thumbnails and titles.
Thread cards and compact rows prefer the watched list's native thumbnail, including
CSS background images and lazy image attributes. Only missing or broken previews
fall back to a cached cover or fetch the canonical thread's first page near the viewport.
Successful cover URLs persist without an expiry and are invalidated if the image fails
to load; empty results and failures are cached for one hour before another attempt.
Fallback requests run one at a time per tab, at least 1.5 seconds apart, after list loading.
A 429 pauses new list and cover requests until Retry-After (at least one minute), or
five minutes without a valid header. The cooldown is saved and shared across watched
tabs; revisit the view or retry after it expires. Already running requests can finish.
The cache stores image URLs, not image bytes: image hosts and other forum activity
can still return 429. Fetching a thread may affect forum read tracking.
Missing images show quiet title initials; user avatars are excluded.
The layout uses simple tabs, fine dividers and unframed cards. The unread count
reflects the loaded watched list.
Stars persist in extension-local storage and follow the thread ID even after a rename.
View/search/page state is remembered in the current tab. Forum view restores
the native current-page list and bulk-management controls. Failed page loads show an
incomplete-results notice and a retry button; loading uses at most three requests at once.

## Integration

- `vendor/forum-post-downloader.user.js` is the unmodified upstream snapshot (v3.22).
  `vendor/provenance.json` records the exact commit, source URLs and SHA-256 hashes.
- Popper 2.11.8, Tippy 6.3.7, FileSaver 2.0.4, JSZip 3.1.5 and the upstream SHA-256
  dependency are bundled locally. No executable JavaScript is fetched at runtime.
- `src/gm-bridge.js` supplies the GM APIs in Chrome's isolated content-script world.
  It hydrates synchronous settings before starting upstream and forwards storage
  changes between tabs. Stored settings are extension-local, not cloud-synced.
- `src/background.js` handles cross-origin streaming, download completion/progress,
  GoFile's account-token cookie, and owned helper tabs. Temporary request-header
  rules are scoped to extension requests and cleaned up after transfers.
- The host allowlist and permissions come from upstream `@connect` and `@match`.
  Unknown host families need a reviewed extension update. Page scripts cannot call
  the bridge; messages are accepted only from matching top-level content scripts.
- Only the GoFile `accountToken` cookie is exposed through the adapter. Upstream
  retains its cookie restoration logic.
- `src/gofile-token.js` replaces upstream's remote `new Function` evaluation with
  the local website-token algorithm. Verified against the captured website script
  on 2026-09-08; a future GoFile algorithm/salt change needs an update.
- `scripts/build-downloader.mjs` applies storage/DOM-ready startup, local GoFile
  token generation, click-to-open Options buttons and a bounded startup auth request.
  It fails if upstream patch anchors change.

Downloads retain upstream behaviour and still depend on each file host's availability,
login requirements and rate limits. Automated fixtures cannot establish that every
supported live host works with a particular account or file.

## Development

```powershell
rtk cmd /c npm install
rtk cmd /c npm test
rtk cmd /c npm run check
rtk cmd /c npm run build
```

To deliberately update vendored sources, run `npm run vendor:update`, review the
changes and provenance, then run `npm run build` and the checks. The build is offline;
the vendor command is the only update step that downloads code. Review GoFile's
algorithm separately if it changes. See [THIRD_PARTY.md](THIRD_PARTY.md) for attribution.
