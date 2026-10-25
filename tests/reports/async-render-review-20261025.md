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
- Exact-commit package/startup results are recorded after build completion.
- 0.1.26 includes preceding appearance settings and formula transition fixes;
  0.1.25 predates both. Installer execution is not requested in this turn.

Original Vault/profile/user processes, root server/public, old releases and
unrelated .workbuddy are protected. No physical IME, OS print, other-platform or
long-run acceptance is implied. Prior full-suite formula-adjacent click anomaly
remains unattributed unless independently reproduced and fixed; query syntax is
still explicitly partial, not complete Obsidian compatibility.
