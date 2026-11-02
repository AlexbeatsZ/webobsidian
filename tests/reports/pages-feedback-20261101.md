# Pages feedback targeted acceptance — 2026-11-01

## Authorization and baseline

User reviewed `计划/Webobsidian.md` and explicitly said “可以执行了”. Approved scope is WO02 and WO05–WO08 targeted acceptance, fixing only confirmed related failures. WO01 retains its documented quote-rule policy, WO03 has no broad cleanup, and WO04 accepts the existing single left red close control. No native settings window is requested.

Source baseline: `44e9e7975a12a0af79008d245e55224c547785bd`, containing the original feedback implementation `4234492` and later math/active-pane changes. Desktop source and installed Windows resource version are0.1.49; Mac installed resources are0.1.37; Android source is0.1.44. Existing unrelated `tests/reports/mcp-builtin-20261031.md` and `.workbuddy/` remain outside this task.

## Findings and changes

No product-source failure was confirmed in the approved items. The historical PDF narrow test failed because its last `openFile('note.md')` implicitly addressed the currently focused split pane while asserting that the main PDF had disappeared. Current `store.openFile` defaults to `currentViewId`, matching the documented native active-page contract. The snapshot showed `paper.pdf` still in main and `note.md` correctly in split.

`tests/browser/pdf-toolbar.spec.ts` now first verifies that implicit open targets split and preserves the main PDF. It then explicitly passes `main` before checking removal/restoration of the main PDF toolbar. Original toolbar assertions are retained; no timeout/tolerance changes or product navigation workaround.

`tests/browser/pages-feedback.spec.ts` adds first-property creation/Undo and stale-Vault read-only coverage. Its property-candidate endpoint now returns the real `{properties: []}` schema rather than the generic unrelated fixture object. The first expanded run exposed that incomplete mock; the mock is corrected without changing production fallback behavior.

Ownership remains `propertyEditor`/`NoteLinks`/DocumentSession, existing PDF sessions/resources, shared manualSave and markdown-core mathRegions. No new parser, session/history, index, save/keyboard pipeline or renderer was added. Changes are tests and evidence only, with no product performance impact.

## Current validation

- Core package compilation passed.
- Focused units:28/28 across5 files (`math`, `properties`, `session`, writing `format`, PDF `session`). Includes recent mhchem/internal-dollar cases and bounded empty display math.
- Final focused renderer suite:13/13 in29.1seconds,0fail/skip/retry. Initial baseline11/12 reproduced the old narrow failure. After explicit target repair12/12 passed; expanded first-property case then exposed the incomplete properties mock and a fixture expectation that omitted existing quoted-scalar/newline spelling. Both harness assumptions were corrected, retaining exact source/Undo assertions. Final output: Temp/.agents/webobsidian-feedback-acceptance-20261101/renderer-accepted/results/.last-run.json.
- No full unit/renderer suite or fresh product build was required for these test-only changes.

## Windows native runtime acceptance

An isolated Electron33.4.11 / Chromium130.0.6723.191 BrowserWindow loaded the actual installed0.1.49 `resources/server` bundle. Server DATA_DIR, Vault and Electron userData all stayed in this task's Temp directory. This is a native Electron renderer acceptance of installed production resources, not an installation or a launch of the user's daily profile/main-process lifecycle.

Passed with zero renderer `pageerror` events:

1. WO02: sidebar property edit synchronizes page header; shared Undo/Redo works; Ctrl+S preserves YAML quote/comment and all unrelated bytes, with only the configured comma replacement; backlinks/outgoing appear in sidebar and document footer, whose geometry stays after content.
2. WO06: actual Ctrl+S formats a readonly reading presentation and writes exact expected bytes; ignored directory is unchanged.
3. WO07/WO08: actual keyboard dm expansion and immediate x+1 highlighting/MathJax preview without Enter; following prose and `$y$` remain exact on disk.
4. WO05: bundled PDF worker renders generated8-page PDF; page4 navigation,125% zoom and needle search1/8 pass.

Final receipt `Temp/.agents/webobsidian-feedback-acceptance-20261101/native-windows-1793577610614/result.json`, `passed=true`,5 checkpoints,errors[]. Screenshots `properties-links.png`, `dm-immediate.png`, `pdf-search.png` were retained.

Early standalone harness attempts used a Windows absolute ESM path rather than a file URL, an old “入链” label rather than “反向链接”, and a filename helper that expected Markdown after opening a PDF. Corrected only the harness; final complete run passed. Each attempt used separate disposable fixture data.

## Mac native PDF and manual save

Actual installed0.1.37 resources were served into isolated Electron33.4.11/Chromium130 with a copied real `数学物理方法 第三版.pdf` (33,721,979bytes,417pages). Original PDF and live Vault were read-only. Actual daily app/profile was not launched/restarted or altered.

Passed:

- Initial PDF rendering has no alert or Map.getOrInsertComputed failure.
- Navigate to page12 and zoom125%; wait for completed `.is-ready` canvas and sample painted pixels. Final canvas2250×2939 had251 sampled nonwhite points, preventing a falsely successful blank/unfinished screenshot.
- Native Electron Cmd+E selects reading view; actual Cmd+S executes the configured comma formatter and writes exact isolated `format.md` bytes.
- No render-process-gone event or controlled PDF alert captured. The chosen textbook has no embedded outline; it correctly shows that state. No OCR/search guarantee is inferred from this scanned file.

Mac receipt `/tmp/.agents/webobsidian-feedback-acceptance-20261101/mac-result.json`; final screenshot `mac-textbook.png` was inspected and visibly contains the Chinese textbook. Receipt and screenshot also copied to the Windows evidence directory.

The first cached Electron ZIP extraction lost framework symlinks; restoring ZIP symlink metadata fixed the isolated runtime. An initial post-zoom screenshot caught an unfinished canvas; the final harness waits for finished nonblank paint, rather than claiming that intermediate frame is success.

## Per-item result and remaining acceptance

| Item | Result |
| --- | --- |
| WO01/F01 | Retained with reason, unchanged; one outer quote rule, no duplicate formula wrapper. |
| WO02/F02 | Existing implementation accepted in current Windows native resources and renderer; first-property/stale-Vault case extends coverage. Android touch/IME and Mac property editing not individually accepted. |
| WO03/F03 | No broad cleanup or live migration. Existing reviewed removal retained. |
| WO04/F04 | User accepted single left red close on2026-11-01; no new development or independent settings window. |
| WO05/F05 | Current Mac installed-resource PDF load/page/zoom and Windows page/search pass. Narrow failure is fixed in the stale fixture, not the product. Physical Android and broad malformed/all-PDF corpus remain outside accepted evidence. |
| WO06/F06 | Windows Ctrl+S and Mac Cmd+S in reading views pass; ignored-directory behavior checked on Windows. Full user46-rule corpus and physical IME are not reaccepted. |
| WO07/F07 | Existing fix accepted by real Windows Electron keyboard dm+x+1 without Enter, plus current core and renderer cases. Android keyboard/physicalIME pending. |
| WO08/F08 | Empty bounds/quoted empty/math suffix/five-dollar rejection and current formula change cases pass. No placeholder inserted. Android physical input/long-run performance pending. |

ADB reported no reachable devices. No product code changed and no new Android build was necessary, so no stale0.1.37 APK was recopied or installed. Preserve the user's future delivery rule: when a new approved APK is actually needed and devices are unreachable, place the matching signed identities on Desktop for self-installation.

Original new-path Pages/prose/screenshots/eight historical comments are preserved. Results are written to the approved same-name `Webobsidian.处理状态.md` and plan. Direct native comment append is not used because a safe anchored write preserving the current document is unavailable; no whole-document DOCX round trip. Pages annotation append remains pending, with the sidecar as the completed readable update.

Own Mac temporary extracted Electron/runtime/profile and copied PDF were removed after verifying the fixture had exited; result/screenshot/scripts remain. Windows isolated receipts and screenshots remain in the task evidence directory.

No new version/tag/release/build/install: only regression-fixture and evidence changes, so an empty product release would duplicate unchanged code. Do not infer general CI all-green or physical all-device completion.
