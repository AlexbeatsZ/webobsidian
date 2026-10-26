# PDF reading and right-sidebar document navigation

## Parent review and implementation scope

User requested application PDF viewing, file-type-aware right outline, and a
fixed RIGHT thumbnails panel. Markdown gets a whole-document minimap and drag
viewport; PDFs get page thumbnails. Search matches must appear in thumbnails.

PDF binary opening previously entered the text document path. A successful PDF
response lacked the text JSON vault field and incorrectly invalidated the entire
workspace. The fix keeps binary files outside writable sessions, distinguishes
malformed text responses from true identity conflicts, and retains the actual
Vault safety gate. Details: pdf-identity-20261025.md.

PDF.js is locally bundled and lazy-loaded; its document resource is shared by
viewer pages, native outline, thumbnails and text extraction. Search boxes are
shared between body and thumbnails. Render/text queues are limited to two jobs;
canvas allocation is visible-page-only with a pixel cap, text cache48pages,
search progress publishes in batches and matches are indexed by page. No iframe,
second SPA, external PDF scripting or writable PDF DocumentSession.

Markdown uses its existing DocumentSession.analysis, main-view navigation owner,
CodeMirror query and saved search results. The server returns already-computed
occurrence ranges independently of20context previews; there is no extra request,
parser, phonetic matcher or index. Stale draft coordinates are rejected by exact
text. The minimap is a bounded512x2048 structural/text overview, not a pixel-
perfect screenshot of separately rendered formulas/images. Scroll changes the
viewport overlay, not the canvas or document; drag preserves cursor and Undo.

## Parent findings corrected during acceptance

- PDF search at the toolbar right was hidden by the floating right sidebar.
  Moving it left alone failed with the left sidebar open in the REAL production
  App. Toolbar now uses existing sidebar width variables to avoid both docks;
  document layout remains unchanged.
- Missing chevron-up glyph fell back to the file icon. Added it to the existing
  shared icon catalog, rather than an ad-hoc inline icon.
- Per-page match filtering would multiply page count by total matches during
  updates. Shared matchesByPage replaces repeated whole-match filtering.
- Rotated PDF highlights must use displayed axes after page transform, not raw
  text matrices.90/270degree tests cover direction and fractional box sizing.

## Final parent verification

- Parent final full unit suite323/323 passed,67 files,4.74s, including final rotation/registry/assets changes.
- Parent final integrated browser14/14 passed (final2/results/.last-run.json confirms passed): actual right-sidebar PDF60pages,
  named destinations, far jump50, matching body/thumbnail boxes, clearing search,
  no-outline PDF, switch back to Markdown, workspace PUT, real SearchPanel query,
  long-note minimap, drag/source/Undo ownership, and binary identity regressions.
- Adjacent sidebar suite4/4 passed7.5s; retained editor/plugin lifecycle remains.
- Web/Server types and isolated Vite production compilation passed. No root
  server/public build was performed.
- Real production App test with copied installed server027 and temporary new
  web assets/Vault/profile passed after toolbar correction:12page PDF, actual
  search click with both docks open, local worker, native outline and thumbnails;
  zero page exceptions and asset failures. Final evidence: Temp/.agents/pdf-production-JhMBFQ.
  Final production compilation passed22.55s with the local static-resource plugin.
  Parent independently fetched representative CMap/font/WASM/ICC assets and
  compared their response bytes with build output; all four passed. Final screenshot
  was visually inspected with both docks open and matching body/thumbnail highlights.
  This is deliberately NOT an exact new installer or updated server-package
  acceptance. This final rerun includes the static-resource/selector revision.

## Limits

Scanning images has no OCR. Missing native outline remains empty. PDF text-run
highlight widths are approximated proportionally, so unusual shaping/ligatures
need further visual coverage. No PDF annotations/editing, Intel device, physical
IME/print or long-run memory claim. Installed Windows027 predates this feature;
Mac027 was built but not installed because no existing WebObsidian target was
found; original Obsidian.app was intentionally preserved.
