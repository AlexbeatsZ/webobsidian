# Markdown minimap source width

## Changes

- `web/src/lib/markdownMinimap.ts`: added `minimapSourceWidth(columnWidth, renderedWidth)`. The default source width is the measured document content column (`.cm-content` border box), rounded to CSS pixels with a 1 px scroll-rounding tolerance. The source grows only when measured rendered overflow (`contentDOM.scrollWidth`) exceeds the column by more than that tolerance.
- `web/src/components/MarkdownMinimap.tsx`: the canvas keeps its bounded sidebar thumbnail width, but horizontal drawing uses one `canvasWidth / sourceWidth` scale: content padding, text origin/clip and structure bars are all in source-column coordinates. Text size is the document font size times that scale, capped by sampled row pitch, so the miniature keeps the page's character/line proportion instead of stretching text across the panel. Removed both explanatory `markdown-minimap-description` paragraphs; the panel title, slider accessible name/roles, `aria-busy`, and real `role="alert"` error remain.
- Width invalidation: the existing `ResizeObserver` on the main `EditorView` scroll box still only updates the viewport box on scroll. A separate observer watches the content column width, and measured media/widget sizes plus body theme/appearance changes schedule a repaint. Ordinary scroll performs no whole-note scan and no canvas repaint.
- `web/src/styles/minimap.css`: removed the unused description rule.
- Tests: `web/src/lib/markdownMinimap.test.ts` covers column default, sub-pixel/1 px rounding, real overflow, fractional and invalid widths. `tests/browser/markdown-minimap.spec.ts` covers default source width vs. sidebar width, column setting change, font setting repaint, a rendered wide table expanding the source, restoring an ordinary page, narrow viewport, and confirms the two tutorial paragraphs are absent. Existing matches/drag/Undo tests are unchanged.

## Algorithm

```
column   = round(contentDOM.getBoundingClientRect().width)
rendered = round(contentDOM.scrollWidth)
source   = rendered > column + 1 ? rendered : column
scale    = canvasBackingWidth / source
textLeft = contentDOM padding-left * scale
textWidth = (column - padding-left - padding-right) * scale
fontPx   = min(DOM font-size * scale, sampled row pitch * 0.85)
```

The thumbnail width remains the sidebar panel width; the sidebar is never widened. A wide formula/image/table only changes the scale of the miniature, and click/drag/viewport mapping stays line-based and unchanged.

## Measured-layout limitation

`contentDOM.scrollWidth` and the media-size observer only describe currently mounted CodeMirror lines/widgets. CodeMirror does not render offscreen lines, so an overflow that exists only outside the mounted viewport cannot be known without rendering the whole note. This implementation deliberately does not scan or render the whole document, does not invent a second parser/editor/math renderer, and does not claim a document-wide maximum. Such overflow widens the source after it has been mounted and measured (document/width/theme/media invalidation), not while the note remains entirely offscreen. Full-document layout is not available from the existing `DocumentSession.analysis` alone.

## Acceptance follow-up 2026-10-26

Parent ran 19 focused browser tests: 14 passed. Parent also reported the 6 minimap unit tests and Web typecheck pass.

- `markdown-minimap.spec.ts:38` (source width): the implementation did extend the source (`670` vs column `450`), but the fixture's 14-column table was narrower than the assertion's `>900` expectation. This was a fixture expectation, not a product failure. The fixture now uses 24 columns while still asserting a large real overflow.
- `markdown-minimap.spec.ts:176` (narrow viewport): at a 520 px viewport the content column itself is 520 px, so `source < 520` was an off-by-boundary assertion. The test now accepts `<= 520` and still requires source == measured column within 2 px.
- No product minimap algorithm change was needed for either failure.

## PDF toolbar follow-up 2026-10-26

- `pdf-identity.spec.ts:213` (thumbnail page 6 stayed 4): real interaction bug exposed by the overlay's taller page viewport. The programmatic page jump was followed by the scroll observer re-selecting an earlier page. `PdfViewer` now records the clamped programmatic scroll top, reasserts the requested page, and ignores the matching scroll event so explicit navigation wins. Normal scrolling away clears the guard and resumes page observation.
- `pdf-toolbar.spec.ts:150` (`executeCommandById` false): the command existed and was registered, but the fixture never ran the runtime Vault sync. `CommandManager.invoke` compares `context.path` with `workspace.getActiveFile()?.path`; with an empty Vault file map that was null. The fixture now calls the existing `sharedApp.vault.sync(tree)`, asserts `canExecute`, assigns the shortcut through `updateHotkeys`, and dispatches a real `KeyboardEvent` through `dispatchHotkey`.
- `pdf-toolbar.spec.ts:185` (split PDF toolbar absent): fixture error against an existing contract. `store.openToSide` intentionally accepts `TEXT_EXT_RE` paths only and rejects PDFs. The test now uses a real Markdown split and a real PDF right-sidebar tab; the sidebar PDF keeps its non-main toolbar and the main toolbar remains the only overlay.

## Checks

Parent evidence: the initial run had 5 failures total; the minimap-related and PDF-related causes/fixes are listed above. Local shell execution remains blocked by the non-interactive permission policy (`Bash`/`PowerShell` approval unavailable), so no new local test result is claimed here. Parent owns the final rerun.
