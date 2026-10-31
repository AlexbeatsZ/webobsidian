# Pages feedback 2026-10-30

## Source and scope

Feedback: `/Users/meta/Documents/Personal Document/Webobsidian.pages`, eight groups read from native Pages. Original native file backed up to `/tmp/.agents/webobsidian-pages-feedback-20261030/Webobsidian.original.pages` before edits. Original prose is retained; anchored replies are added only after verification.

Implementation baseline: `3ceb05d`, desktop 0.1.36. Only pre-existing unrelated `.workbuddy/` was dirty/untracked. New desktop/Android version is 0.1.37/code37. No daily app installation/restart, live Vault writes, synchronization or user configuration migration is part of this task.

## Decisions and implementation

| Item | Result and shared owner |
| --- | --- |
| F01 quote line in math preview | Investigated and intentionally retained. The formula DOM contains no extra quote wrapper or literal `>`; the one containing quote wrapper paints its continuous white rule across the preview. Removing that rule only over the preview would break quote continuity or add a second coordinate/layout policy. User explicitly allowed keeping this low-impact behavior with an explanation. |
| F02 properties and note links | Existing property DOM controls moved from livePreview into `propertyEditor.ts`; both original page header and new right Properties panel use its scalar/list/type/menu/YAML-token patches. Sidebar edits use the same DocumentSession/Undo and reject stale YAML or locked sessions. Incoming/outgoing panels moved once into `NoteLinks.tsx` and reused in the sidebar and document footer. Footer is outside contentDOM and original source, inside the same scrollDOM, omitted from embeds/fragments. |
| F03 superseded syntax | Removed runtime special `> **old subheading**` / `#-title` resolution; JS outline consumes native heading metadata including level7 body headings. Old converters/resolver are now only on `markdown-core/migration`, preserved for explicit offline migration/recovery. Ordinary file/heading/block/footnote links remain supported. |
| F04 Mac settings close | Mac in-app settings modal now has a functional red 12px close circle on the left; hover/focus reveals its close mark. Main BrowserWindow keeps native traffic lights. No fake inactive minimize/zoom controls are added to the modal. |
| F05 Mac PDF | Reproduced with installed0.1.28 production resources and a copied real PDF in Electron33.4.11/Chromium130: `UnknownErrorException: this._requestsByChunk.getOrInsertComputed is not a function`. Modern Chrome read the same resources/files successfully. Runtime+worker now both use PDF.js official legacy build, without a bespoke polyfill or changing Electron globally. |
| F06 format on Save | Actual Mac and Windows native configs already had lintOnSave=true and Mac API loaded46 custom rules. Removed manualSave's reading-view early return so manual Save follows configured formatting in both live and reading presentation. Background autosave remains persistence only. |
| F07 immediate dm highlighting | Empty display regions now remain in the shared core model before ordinary characters are typed, invalidating cached analysis at the body insertion point. Real keyboard dm expansion followed immediately by x+1 produces token marks and preview without Enter/blur. |
| F08 empty $$$$ | Parsed as exactly one closed empty display region; following prose/inline math remains independent. No source placeholder is needed; five-dollar runs remain invalid. |

## Architecture and performance

No second Markdown/TeX parser, document state, history, index or save pipeline. Property editor and note-link panel extraction serves two concrete UI callers. Existing source-token patches preserve unrelated YAML comments/quotes and document bytes. Formula invalidation is fixed in the existing immutable source model/cache; selection-only math analysis remains cached. PDF queue/resource lifetimes remain unchanged. Property suggestion dropdowns now dispose on host unmount and refuse late writes.

## Source validation

- Web, Server and Desktop type checks passed.
- Full unit suite:460/460 in82 files.
- Offline migration/apply/restore suite:24/24; old subheading conversion remains available to the explicit script.
- Targeted nine-file suite:32/32, covering shared math, old migration and PDF resources/queues/sessions.
- Four original feedback browser cases passed, including real dm keyboard expansion, quote DOM policy, shared property patches/Undo/footer layout, and reading-view Save formatting.
- Expanded browser final run and native Mac post-fix production validation: pending at source freeze; append actual results below.

The first new snippet fixture omitted explicit file-source flags, and the first Mac settings fixture missed the trailing slash on settings API; both fixtures were corrected. A first expanded browser run reloaded its custom navigation fixture during Vite dependency optimization; its unchanged focused repeat passed. These attempts do not replace final frozen results.

## Build, publication and document annotations

Pending exact-commit production builds, native Electron33 verification, release publication and original Pages annotation readback. Do not interpret this section as delivered until the recorded completion below.
