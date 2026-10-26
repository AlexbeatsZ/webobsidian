# PDF viewer source handoff — 2026-10-25

## Freeze and ownership

Product source frozen after main-only registry selection and Vite PDF asset registration. No further product writes planned. Parent owns final integration, production verification, documentation integration and Git closeout. No application restart, live Vault edit, installation or commit performed in this closeout.

Owned implementation: web/src/lib/pdf/*, components/Pdf*.tsx, styles/pdf.css, Editor PDF dispatch, AttachmentView and prior binary API guards; web/package.json/package-lock.json dependency; final authorized PDF-only web/vite.config.ts increment. RightSidebar selector integration belongs to Popper; store/other sidebar/minimap/search changes belong to their existing owners. Preserve all concurrent changes.

## Final contract

- Fixed right outline/thumbnails use useMainPdfSession(activePath), selecting a live viewId='main' controller, not a focused same-path sidebar controller. Unregister notifies even for a non-active main; repeated unregister is inert; late focus cannot reactivate an unregistered/destroyed controller. Active fallback skips destroyed controllers.
- PdfOutlinePanel and PdfThumbnailsPanel take {session: PdfSession}; they never load a second document. Embedded outline destinations only; no-outline is explicit. Remote/action destinations are not executed.
- Shared PdfResource owns PDF.js document/pages/text; per-view PdfSession owns navigation/search. Canvas concurrency is bounded at two, near-visible pages only; page cleanup waits for settled work, final owner release cancels/destroys resources.
- Search caches matchesByPage and batches progress publication; body and thumbnail consume identical boxes. Display-axis/direction comes from viewport-transformed text, including tested 90/270 degree rotations. Boxes remain proportional within a text item, not exact glyph widths; no OCR or complex typography precision claim.
- Main toolbar alone reserves existing sidebar/ribbon width CSS variables for both open floating docks. Document body and global dock layout remain unchanged.
- Prior binary/session and Vault identity protections remain: PDF never enters writable DocumentSession, scoped file URL/header retained, real VAULT_CHANGED still blocks layout writes.

## Static resources (supersedes BinaryDataFactory production result)

pdfAssetsPlugin is registered in web/vite.config.ts. Development middleware serves an exact allowlisted file map; generateBundle emits bytes under pdfjs-assets/{cmaps,standard_fonts,wasm,iccs}/ with original filenames. Runtime constructs same-origin directories under Vite BASE_URL and PDF.js performs worker fetches. Keeping filenames supports ICC and decoder fallback module loading. The official pdf.worker.min.mjs stays a locally bundled ?url asset.

Included extensions: bcmap, pfb, ttf, otf, woff/woff2 if present, wasm, icc, decoder JS and LICENSE files. Installed v6 fonts are pfb/ttf; no fabricated woff requirement. QuickJS assets are excluded. No scripting manager/sandbox/annotation actions are instantiated; v6 removed isEvalSupported so no obsolete flag is passed. This is a read-only viewer, not a promise of full PDF application compatibility.

## Owner verification on final source

- npx vitest run web/src/lib/pdf: 17/17 passed, 635 ms. Includes 90/270 rotation, same-path main/sidebar selection, hidden main removal, destroyed fallback, idempotent unregister, resource sharing/cancellation, shared match index, search race suppression, and exact resource emission.
- npx tsc --noEmit -p web/tsconfig.json: passed after selector/plugin integration.
- npx playwright test tests/browser/pdf-identity.spec.ts --project=render: 8/8 passed, 22.6 s; Edge, isolated Vite port 5198, RENDER_TEST_SKIP_CORE_BUILD=1. Output: C:/Users/Meta/AppData/Local/Temp/.agents/pdf-final-20261025/results.
- Browser covers PDF read-only/layout identity, stale async replacement, sidebar/split binary draft retention, same-path sidebar focus with main-only outline jump and close/destroy, genuine 409 rejection, named destination and identical body/thumbnail match boxes, mixed-size distant jump and 80-page bounded canvas/no-outline behavior.
- Parent's previously reported 13-browser/320-unit and BinaryDataFactory production pass are historical. They do not certify this final static-resource/selector revision. Parent is running final full checks and production acceptance separately; current report does not claim that result.

## Reusable fixture and limits

tests/browser/fixtures/pdf.ts exports makePdfFixture({pages?: number | readonly string[], outline?: boolean, pageSizes?: readonly (readonly [number, number])[], documentScript?: string} = {}): Buffer. Default six text pages, alternating needle alpha/beta, native outline with named chapter-two destination; outline:false omits outline. Optional page sizes exercise distant layout correction; optional document script is a non-execution test payload.

No new installer/native Electron acceptance, physical IME, OCR, complex shaping, arbitrary PDF codec/font corpus, or long-duration memory claim. Existing installed 0.1.27 and live user session remain untouched. Parent production test must validate current local worker/static resources and actual both-dock-open click; owner custom browser shell does not replace that acceptance.
