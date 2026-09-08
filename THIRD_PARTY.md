# Third-party code

Original copyright/license notices are retained in bundled source files.
Exact source URLs and SHA-256 hashes are recorded in `vendor/provenance.json`.

| Component | Version / source | License |
| --- | --- | --- |
| ForumPostDownloader / XenForoPostDownloader | SkyCloudDev, v3.22, commit `07597429bd69968e5fa737ecc920c94fc0d26e6e` | WTFPL (upstream userscript header) |
| Popper | 2.11.8, @popperjs/core | MIT |
| Tippy | 6.3.7, tippy.js | MIT |
| FileSaver | 2.0.4, eligrey/FileSaver.js | MIT |
| JSZip | 3.1.5, Stuk/jszip | MIT or GPLv3; used under MIT |
| SHA-256 | geraintluff/sha256, snapshot in provenance | Public domain (upstream declaration) |

The GoFile website-script snapshot is a test reference, retrieved from
https://gofile.io/js/wt.obf.js on 2026-09-08. It is not injected or evaluated by the
extension. The extension uses the small local algorithm in `src/gofile-token.js`.
