# Native JavaScript blocks

## Accepted scope (2026-10-22)

Ordinary `js` / `javascript` stays in CodeMirror, including highlighting. The
dedicated `js-widget` / `javascript-widget` names execute automatically. Preserve
the first-nonempty-line `// @obsidian-js` convention for existing notes without
rewriting their source. Interactive JS 0.1.0 is the migration reference at
`C:/Users/Meta/Project/Scripts/TypeScript/obsidian-interactive-js/src`.

The user explicitly chose trusted execution with DOM and full existing `app`
access, including Vault writes. Private reading views allow these interactive
blocks: text readOnly does not sandbox trusted JS. Restricted contexts, public
shares and print do not execute scripts. Keep HTML's iframe execution separate.

## Ownership and dependency direction

- The existing `obsidian/markdown.ts` code-block host owns selection, decoration,
  mounting, source controls and destruction for native and plugin processors.
  Native registration has a predicate so ordinary JS never takes a replacement
  or a second highlighting path. One registry, no second parser or watcher.
- Startup passes the existing app into the native JS installer. JS modules may
  import app types, never the app singleton/runtime as a value.
- `javascript/execute.ts` is the shared strict AsyncFunction compiler for note
  blocks and the concurrently implemented user-command/template entry points.
  It has no DOM/chart/lifecycle dependency; each caller owns its run resources.
- `javascript/runtime.ts` owns one controller per mounted block and one Component
  per run. Source, declared dependency changes and explicit rerun replace a run.
  Disposal aborts helpers, detaches old output and releases owned resources.
- `javascript/charts.ts` loads in a dynamic chunk before the first script runs.
  Share one loading promise and retain synchronous chart/echarts interfaces.
- `javascript/widgets.ts` retains the five personal views. Reuse DocumentSession
  analysis and the existing file tree/events. UpTimer's domain parsing remains
  local. Do not create a Vault-wide body cache, index, registry or generic host.

## Identity, data and resource rules

Map existing decorated block spans through source changes and reuse identity only
for matching source/language/processor/context. Equal-source siblings stay
independent. Prefix edits update source controls and lazy section information
without recreating output. DOM-owned cleanup uses a WeakMap, not WidgetType
instance fields (equal replacement widgets can share the existing DOM).

Open-document reads use their current session and cached analysis; other widget
targets enter the existing registry on demand. Deduplicate watched paths per run;
reuse Vault modify/create/delete/rename events and session version notifications.
Directory queries walk the relevant TFolder subtree, not all Vault bodies.

Callout output uses target-note context for relative links/media. Nested output
disables executable blocks, including through embeds, to avoid recursive runs.
Custom `> **subheadings**` and their duplicate-label targets remain supported;
ordinary headings share core metadata. Do not rewrite original Markdown to add
anchors. Shared syntax-derived results are keyed by immutable MarkdownModel.

Per-run Component registration owns chart observers, mounted fragments, event
subscriptions and user cleanup callbacks. Late registrations dispose immediately.
Arbitrary trusted code can still create unmanaged global side effects or block
the main thread; a Promise timeout cannot preempt synchronous JS. No sandbox or
automatic cleanup of arbitrary user globals is claimed. Offscreen virtual widget
unmounts and source-mode transitions dispose output; there is no global retained
DOM/control-state cache.

## Verification and concurrent work

Static only: types and isolated production bundles. Regression sources may be
prepared but not executed. Never start browser/Electron/server, touch the original
Vault, replace server/public or build a new portable package. Preserve the active
four-feature integration's changes in shared files; commit only this task's hunks.

Checks must cover inert fences, directive placement, equal-source siblings, prefix
position mapping, source controls, rerun/unmount during async work, late cleanup,
dependency create/delete/rename, unsaved target reads, target-relative Callouts,
nested execution suppression and share/print capability denial. Actual UI,
compatibility and performance acceptance remain unverified until user testing.

## Implementation evidence

Fresh core/search compilation, web/server/desktop types, prepared regression-source
types, isolated production web and standalone server static guard/syntax checks
passed. ECharts is emitted as its own dynamically loaded chunk, with no CDN.
Vite reports its usual large-chunk warning (the full ECharts chunk is about
1.14 MB uncompressed); preserving the complete synchronous echarts interface is
intentional. No measured speedup or runtime compatibility is claimed.
