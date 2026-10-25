# Asynchronous rendering review and Windows 0.1.26

## Scope and ownership

User requested investigation and repair of errors similar to formula-click raw
source flicker, followed by a new build. Baseline is f876b44. Three GPT-6.1 Sol
workers handled disjoint media/embed, processor/query and math-surface ranges;
parent reviewed integration and owns final regression, Git and package acceptance.

Existing authoritative owners remain RenderLifetime/JavascriptRun for cancellation,
MarkdownView/mountMarkdownFragment for Markdown, MathJax queue/cache for formulas,
DocumentSession for source/history and sourceControls for explicit editing. No
new parser, input pipeline, global clipping or general rendering framework.

## Investigation matrix

| Surface | Confirmed issue / disposition |
| --- | --- |
| Mermaid | Successful SVG lost during update; stale finally could clear current pending. Reuse DOM and guard current lifetime. |
| Note embeds | Refresh cleared successful content before fragment readiness. Stage replacement and remove raw Markdown fallback. |
| Formula tooltip | Failure erased successful formula; preserve SVG and show error. Visible pending text widening was caught in parent review and removed for warm output. |
| Equation suggestions | Delayed/failed previews lacked visible state. Distinguish same selected identity from new formula; abort obsolete requests. |
| Plugin math adapter | Ignored finally derivative caused unhandled rejection. Handle cleanup on original promise without swallowing finishRenderMath failure. |
| Query blocks | Refresh emptied successful results before response. Build rows and replace only at success; preserve rows with visible error on failure. |
| Code processors | Cold async output was blank and destruction left pending state. Initial short status and lifetime cleanup. |
| Public MarkdownRenderer | Repeated mounts shared React root/cleanup ownership. Per-call child host, current-lifetime publication, strict source/path identity. |
| Configured effects | Dependency refresh cleared successful output. Preserve completed run while replacement is staged. |
| Native JavaScript blocks | Real compiled script showed eight blank cold/refresh frames. Retain completed run while staging replacement, visible failure and dependency retry. |
| External link hover previews | Subscription refresh cleared the successful preview. Reuse existing lifetime, same-width stage, guarded readiness/error and non-executing context. |
| Sanitized HTML / entities | Synchronous DOM installation or intended decoded text; no async raw-source placeholder found. No speculative change. |
| Images / executable HTML iframe | Existing browser loading/error or explicit sandboxed srcdoc, not raw note placeholder. Existing regression coverage retained. |
| Table-cell and review source toggles | Explicit source/reading identity change, not background refresh; no blanket retention applied. |

Parent rejected display:none staging (zero formula width) and requested real
formula/table/image checks, plus embed staging versus final column width checks.
Retained successful content during refresh is not claimed to be the new result:
pending/error state remains explicit. Uncooperative third-party code retaining DOM
references cannot be forcibly cancelled by the cooperative lifetime contract.

## Validation and delivery

- Full unit suite: 290/290 passed on 2026-10-25, 59 files, 4.09 seconds.
- Worker evidence and red/green reproduction are in async-media-transition,
  async-processor-transition and async-math-surfaces reports dated 2026-10-25.
- Parent frozen-source full browser run: 247 passed, 2 skipped, 0 failed, 5.4min,
  one Edge worker, no retries. Includes all three new specs, appearance, formula
  transition, navigation, tables, HTML/images, integration, workspace and palette.
  The two original-plugin environment-gated cases remain skipped. Evidence:
  C:/Users/Meta/AppData/Local/Temp/.agents/async-render-parent-20261025/full-browser.log
- Final Web, Server and desktop typechecks passed. The prior formula-adjacent
  click case passed this run; its earlier intermittent failure is not attributed
  to these fixes. No assertion/tolerance was weakened.
- Exact source30f87dce784c5cc9404a75b2a5331391c31fe1b6 archived under Temp;
  fresh search/core/Web/Server/desktop compilation, NSIS and actual packaged
  standalone guard passed. Delivered setup is104100689bytes, PE0.1.26:
  desktop/release/0.1.26/WebObsidian-0.1.26-win-x64-setup.exe.
  BUILD-INFO.json beside it records source, commands, evidence and boundaries.
- Actual packaged server/SPA startup passed in an isolated Vault/profile with
  Edge in4.671s, zero renderer errors: real input/disk save, snippets/templates,
  JS widgets/native blocks/equation reference, modes/search/menu/attachments/tabs.
  This is not native Electron UI or installer execution acceptance.
- Parent inspected the final pending/committed preview screenshots, physical
  setup size/version, BUILD-INFO and packaged startup/guard logs. Root public
  index metadata stayed909bytes and UTC2026-10-23T12:05:49.8534997Z; old releases
  retained. Build evidence: Temp/.agents/meta-obsidian-win-0126-async-render-20261025.
- 0.1.26 includes preceding appearance settings and formula transition fixes;
  0.1.25 predates both. Installer execution is not requested in this turn.

Original Vault/profile/user processes, root server/public, old releases and
unrelated .workbuddy are protected. No physical IME, OS print, other-platform or
long-run acceptance is implied. Prior full-suite formula-adjacent click anomaly
remains unattributed unless independently reproduced and fixed; query syntax is
still explicitly partial, not complete Obsidian compatibility.
