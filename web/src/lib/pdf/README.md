# PDF module integration

## Public integration contract

```tsx
import { useMainPdfSession, usePdfSnapshot } from '../lib/pdf/react';
import PdfOutlinePanel from './PdfOutlinePanel';
import PdfThumbnailsPanel from './PdfThumbnailsPanel';

const session = useMainPdfSession(activePath);
return session ? <PdfOutlinePanel session={session} /> : null;
```

Both panels accept `{ session: PdfSession }` and subscribe internally. Mount them
in the RIGHT sidebar. They share the viewer's controller/document; they must not
load another PDF. `PdfViewer` accepts `{ path: string; viewId?: string }` and is
dispatched by the existing Editor adapter for PDF paths.

`PdfSession.subscribe` and `getSnapshot` are stable methods for useSyncExternalStore.
Snapshot: status (`loading | ready | error | destroyed`), path, pageCount,
currentPage, outline (`{ title, page: number | null, children }[]`), query,
matches (`{ id, page, from, to, boxes }[]`), matchesByPage (page-number keyed
read-only arrays), activeMatch, searchPending and error. Body/thumbnail views
must consume matchesByPage rather than filtering the global match array.
Commands: `goToPage(page)`, `setQuery(query)`, `nextMatch(1 | -1)`.

Fixed right panels select the live `viewId === 'main'` session for the central
activePath, never a same-path sidebar session. The optional useActivePdfSession
hook follows viewer interaction; it is not the fixed right panel selector.
The parent/right-sidebar owner supplies the surrounding tab
selection and Markdown fallback. Outline contains only embedded PDF entries.

## Implementation plan and ownership

Vite integration (registered in web/vite.config.ts): import
`pdfAssetsPlugin` from `./src/lib/pdf/vitePlugin` in web/vite.config.ts and add
`pdfAssetsPlugin()` to `plugins`. It serves and emits official resource files
under `/pdfjs-assets/` with their original relative names. The official worker
remains a local `?url` asset. This also supports synchronous ICC and dynamic
WASM-free decoder fallback loads that a hashed-URL glob cannot satisfy.
QuickJS/sandbox assets are excluded. PDF.js v6 has removed `isEvalSupported`;
the module does not supply obsolete options or instantiate scripting services.

- Owner write set: new lib/pdf/*, components/Pdf*.tsx and styles/pdf.css;
  existing Editor.tsx/AttachmentView.tsx, web/package.json and root package-lock.json;
  focused tests/browser/pdf-identity.spec.ts, new PDF test fixtures/report.
- Preserve all earlier binary/identity guards. No public store/RightSidebar edits.
- Official pdfjs-dist document/worker local Vite asset; getDocument/getPage,
  getOutline/getDestination/getPageIndex, page render/text APIs are authoritative.
- Share document/page/text resources for visible body pages, embedded outline,
  thumbnails and search. Bound canvas concurrency globally and mount only visible
  pages; cancel render tasks and await settlement before cleanup/destroy.
- Guard all asynchronous results by resource/controller lifetime. No PDF scripts,
  remote-link actions or fabricated headings. Vault URLs remain identity scoped.
- Focused unit cancellation/search/resource tests, valid generated PDF browser
  fixtures and identity regression; no production build/install/commit.
