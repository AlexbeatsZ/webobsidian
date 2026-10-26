# Reader structure parent acceptance

Date:2026-10-26. Sol implementation owner handled minimap lifecycle; parent reviewed/integrated and handled PDF command consistency. No package/install/live Vault changes.

## Concrete changes

- Minimap drawing has no subscriptions. A concrete layout owner tracks mounted media incrementally and measures a consistent border-box; drawing no longer disconnects/reobserves every target. Component retains existing shared analysis/search/navigation and frame-coalesced interaction. See minimap-structure-20261026.md for owner evidence.
- Titlebar button and native command now both use existing getMainPdfSession, removing the separate extension-based availability predicate. Destroyed main sessions disable both entry points.
- Existing PDF navigation position guard retained rather than replaced with a new state machine. Added regression proves explicit page jumps yield to user scrolling after zoom and toolbar toggles; mixed-page-size/distant-page tests remain passing.

## Parent validation

- Final24/24 browser tests passed,1.1min. Includes9minimap,6toolbar,8PDFidentity,1integration. Evidence Temp/.agents/reader-structure-final-20261026.
- Full324/324unit tests,67files,5.51s; Web typecheck passed.
- Review confirms no second editor/parser/search/resource cache, no whole-note rendering to guess offscreen overflow, no changes to live Vault/profile or .workbuddy.
- Earlier focusedPDF13/13 and explicit-navigation1/1 also passed. No production rebuild, nativeElectron/Android or long-duration performance claims for this structural revision.

## Remaining boundaries

Minimap remains a bounded structural summary; virtualized offscreen overflow is unknown until mounted. Layout changes can remeasure within the existing animation frame; tests establish paint/subscription behavior, not a quantified latency improvement. No universal framework or wholesale rewrite introduced.
