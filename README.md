# Image Compression for SiYuan

![Image Compression for SiYuan](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/marketing/header-en.png)

Offline image compression comes first. An independent image-renaming tab simplifies
image filenames while preserving terminal SiYuan IDs. Desktop SiYuan 3.8.5 or newer is required;
the kernel must also expose `findAssetReferences` and `relinkAsset`. If those APIs
are unavailable, or any part of the workspace cannot be scanned, writes are blocked.

## Install and use

Once listed, search for “Image Compression” in SiYuan Settings → Bazaar → Plugins.
Alternatively, download `package.zip` from
[GitHub Releases](https://github.com/lisontowind/sy-imgcompression/releases/latest). Unzip its contents into
`<workspace>/data/plugins/sy-imgcompression/`, then enable the plugin in SiYuan.
Open a document and use the top-bar image button, the document menu, or commands.
The document title-icon menu and single-document tree context menu show the total size
of all local attachments, with duplicate paths counted once. Filters and selections do
not affect the total; unavailable sizes are reported separately. Empty documents show
zero bytes. The old breadcrumb More menu entry has been removed.
Right-click an image to see its original dimensions and file size, open the panel,
or run Quick compress without a dialog. A separate Quick compression settings dialog
can be opened directly from the image context menu or the panel, without loading the
attachment list. Independent quick settings and global settings
are persisted in `settings.json`; quick compression also uses the durable job journal.

Compression supports static JPEG/PNG/WebP, local WebP output by default, presets
90/82/70 (default 82), an explicit Custom preset, and optional downscaling. Choose
original dimensions, 75/50/25%, a custom percentage (1–100), or an advanced width,
height or longest-edge limit. All resizing preserves aspect ratio and never enlarges.
Each image can inherit global settings or keep independent settings; global edits do
not overwrite overrides. Reset one or all overrides, or rescan to reset the session.
Thumbnails open original images in child dialogs. Compression preview runs only after
clicking Generate compression preview; changes invalidate the result. Reference dialogs
list locations and embed read-only document content without changing workspace tabs.
Closed notebooks remain closed and their references remain listed.
Original PNG uses lossless byte
optimisation when not resized. Animated images, external URLs, unsupported formats,
images above 50 MiB or 40 million pixels, and results with no savings are skipped.
An image worker is terminated after every image to release its codec memory.

Renaming applies only to images. Set a batch filename prefix (default `image`), or
override the name portion of individual images in the table. Individual names survive
batch prefix changes; clear an individual name or choose Use batch prefix to inherit.
The result is `<prefix-or-individual-name>-<SiYuan ID>.<original extension>`.
The ID and extension are added automatically. Names are kept in the current panel
session; rescanning clears individual names.
A complete terminal ID (14-digit timestamp and seven lowercase letters/digits) is
retained; otherwise a new ID is generated. Already normalized images need no changes.
PDF and other non-image files are excluded. Conflicting destinations are skipped,
never overwritten. Compressed outputs use `image-<new ID>.<output extension>`.
Old journals, including document-prefix renames, remain recoverable.

## Illustrated guide

The illustrations below use the actual plugin interface with example documents.
Guide and promotional images are hosted in the repository and require an internet
connection to view. Image compression itself remains fully offline.

1. Choose batch settings and review attachment totals before applying.

![Batch compression](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/guide/en/01-batch-compression.png)

2. Set independent parameters for individual images.

![Individual image settings](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/guide/en/02-individual-settings.png)

3. Generate a preview explicitly, compare the results, then apply from the main panel.

![Compression preview](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/guide/en/03-compression-preview.png)

4. Use a batch prefix or individual names while retaining SiYuan IDs and extensions.

![Custom image names](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/guide/en/04-custom-names.png)

5. Save independent quick settings and compress directly from the image context menu.

![Quick compression settings](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/guide/en/05-quick-compression.png)

6. Review job results and restore matching references. Original files are retained.

![History and recovery](https://raw.githubusercontent.com/lisontowind/sy-imgcompression/main/assets/guide/en/06-history-recovery.png)

## Shared attachments and recovery

The current document chooses the source files; native references throughout the
workspace are migrated together, including closed notebooks, title images,
database assets, PDF annotations and OCR metadata. Source files and the task journal
are retained for recovery. Renaming safely copies the file to its previewed name
and migrates references; the old unreferenced copy is retained too. Disk usage can
increase. No original attachment is deleted automatically.

The verified kernel migration API reads and updates closed notebooks directly,
without opening/closing them or changing the user's notebook state. It performs
structural reference rewriting, concurrent-write checks and native history backups.
This replaces the planned temporary notebook opening with the kernel's safer native
operation. Ambiguous resource paths, skipped encrypted notebooks (including unlocked
encrypted notebooks), missing database definitions, symlinks, unreadable data and
unsupported references block writes. Unlocking alone cannot make an unsupported
encrypted notebook eligible; resolve that workspace limitation before using this plugin.
Third-party private data and references outside this workspace cannot be migrated.

Jobs are persisted through the plugin's `jobs.json` storage. An operation whose result
is unknown after a crash is never replayed automatically. Use **Task history & recovery**.
Recovery verifies source/target hashes and the reference locations/values before
relinking back; changed or newly added references block recovery rather than overwrite
new edits. Keep the original files until recovery is no longer needed. Cancellation
waits for an in-flight mutation to finish and verifies/reverts the current attachment;
earlier completed attachments remain completed and can be restored from history.

## Development

```sh
npm ci
npm test
npm run build
npm run dev
```

Build output is in `dist/`; `package.zip` has plugin files at the archive root.
Guide and promotional artwork is excluded from the plugin package; `icon.png` and
`preview.png` are retained. Run `npm run package:assets` for the separate artwork archive.
Image processing uses no CDN, external API key or cloud compression. Automatic paste
handling and background original-file cleanup are disabled.
See `THIRD-PARTY-NOTICES.md` and `licenses/` in the package.

For verification results and platform coverage, see `VALIDATION.md` in the source repository.
