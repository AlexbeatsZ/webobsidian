# Native commands and templates

## Goal and implementation plan (2026-10-22)

User JavaScript commands and note templates belong to the application. Keep one
command invocation contract, one template insertion path, and the existing Vault,
document history, search, dialogs and JavaScript compiler. Do not port Templater's
plugin host, `tp.user`, shell command loader or a second Markdown parser.

Implementation order:
1. Deepen the existing command Module: stable IDs, registration/disposal, sync
   availability, awaited results, arguments and captured target context. Adapt
   the old boolean dispatch Interface to the same implementation.
2. Add Promise dialogs to the existing UI Module; persist user command source in
   Vault-local JSONC configuration, compile only changed source, and expose
   commands through the existing palette, shortcuts and configurable menus.
3. Consolidate the two template insertion Adapters into one template Module.
   Compile small declarative directives; resolve variables/commands/includes in
   order, then apply one source edit with the existing snippet placeholder state.
4. Add template command bindings and optional folder creation rules at the existing
   Vault.create seam, plus documentation and prepared regression sources.
5. Check fresh source types and isolated production bundles only. No runtime,
   unit/HTTP/browser/Electron tests, real Vault writes or new portable package.

## Reuse and performance decisions

| Existing/Templater behavior | Implementation owner |
| --- | --- |
| Command definitions, lookup and dispatch | `commands.ts`; native array and the existing contribution Map are indexed once, with native ID precedence. No template-only registry. |
| Trusted JS compilation | `javascript/execute.ts`, shared with native JS blocks. Commands do not load charts or a DOM output host. |
| Command lifetime | User command controller owns registration and abort; invocation finally releases registered cleanup. JS blocks retain their own mounted Component lifetime. |
| Files, unsaved text, properties and source preservation | Existing Vault adapter, DocumentSession and its cached analysis/MetadataCache. |
| Template choices, command search and shortcuts | Existing catalog, palette and search preferences. No template watcher/index or Vault-wide body cache. |
| Prompt and selection dialogs | Existing Modal/SuggestModal, shared Promise helpers. |
| Date formatting | Existing moment dependency. |
| Template cursor groups/history | Existing native writing tabstop state and source transaction; command results are literal data, never recompiled as snippet syntax. |
| Preferences and Vault identity checks | Vault-local `.obsidian/webobsidian/automation.jsonc`, using `vaultConfiguration.ts` shared with menus and other native configurations; existing authenticated router. |
| New-file triggers | Initiating client's Vault.create, before the initial write; only empty Markdown notes and explicit folder rules. No create-event watcher, so other clients never duplicate script execution. |

The command Interface is `register`, `canExecute`, `execute` and compatibility
`executeCommandById`. The template Interface is render/insert; palette and
Obsidian templates are Adapters at that Seam. Deleting these Modules would send
async result handling and stale-target checks back into several callers, so they
provide Depth and Locality. Per-variable helper Modules would add no Leverage.

Native IDs use a cached Map instead of `.find` and cross-array `.some` per lookup.
One boolean dispatch captures context and checks availability once. A closed
palette skips catalog ranking entirely while the editor changes. Template source
compilation uses a bounded 64-path cache; only changed user definitions compile
on reload. These reduce repeated work, with no measured latency claim.

## Template language

Templates remain Markdown. Directives use `<% ... %>`; this is a small declarative
language, not JavaScript. Directives inside code fences are still directives,
matching template generation rather than Markdown rendering. Write `<%%` for a
literal `<%`. Values returned by commands are never parsed again.

- `<% title %>`, `<% path %>`, `<% folder %>`, `<% selection %>`.
- `<% date "YYYY-MM-DD" %>`; one captured timestamp per render.
- `<% property "course" %>` reads the target note's existing metadata.
- `<% command "user:example" {"arg": 1} %>` awaits and inserts text/number.
- `<% do "user:example" {"arg": 1} %>` awaits an action without inserting its result.
- `<% let course = command "input:prompt" {"message":"课程"} %>` stores a result.
  `<% course %>` reuses it. JSON arguments can reference a variable using the
  exact object `{"$var":"course"}` (also supports own-property dotted access).
- `<% include "Templates/Part.md" %>` renders a child with the same target and
  variables. Cycles and excessive depth fail with the template path and line.
- `<% cursor 1 %>` / `<% cursor 2 %>` define ordered placeholders; equal numbers
  share a multi-cursor group, reusing native writing navigation.

Simple legacy `tp.file.title`, `tp.file.path()`, `tp.file.folder()`,
`tp.file.selection()`, `tp.date.now("format")`, `tp.frontmatter.key` and
`tp.file.cursor(n)` map to these same directives. Legacy `<%* ... %>`, dynamic
commands and arbitrary expressions fail explicitly; move their code into a user
command, and call that command from the template. No silent regex conversion of
personal scripts or original notes is performed.

## Execution and migration contract

One render captures target identity, document/selection, unsaved source and time.
It checks the target before command calls and before insertion. Errors or canceled
dialogs leave template text unapplied. External actions already executed by a
command are not rolled back. Commands which mutate the insertion target invalidate
the baseline; use a standalone command for such workflows.

User command source receives `app`, `args`, `context`, `signal`, `onCleanup`,
`prompt`, `choose`, and `execute`. The last helper preserves the current context
and recursion stack. `context.assertCurrent()` must be called before target edits
after an await. Trusted code can access app/Vault and global JS; this is not a
sandbox and synchronous loops cannot be preempted by an AbortSignal.

No startup user code is executed when loading definitions. Only enabled registered
commands execute on explicit invocation or an explicitly configured template rule.
Disabling/replacing a command aborts in-flight helper operations and releases its
registrations. Editing settings drafts does not change active commands until saved.

## Portable configuration and file creation

`automation.jsonc` owns `version:1`, `commands` and `templates` (folder, bindings,
folderRules). JS source is stored directly in the command definition in this Vault
file. Template bodies remain their existing Vault Markdown files. Nothing is
installed into the application directory. Missing configuration reads defaults
without creating files. Settings offers an explicit import of old application
automation/search-template preferences; it preserves the original fields. No
personal scripts are converted or populated automatically.

Configuration reads/writes share menu storage: UTF-8, directory traversal/symlink
refusal, bounded file size, Vault token, revisions and exclusive new-file creation.
Existing JSONC comments are retained through structural edits. Invalid reloads
keep the prior registered definitions; explicit reload and application save events
replace only changed definitions. External editor changes also use the shared
`vault-configuration-changed` socket event when the narrow native-configuration
watcher is available; the reload command remains available. No second watcher or
file-tree/index invalidation is introduced by automation.

`Vault.create` prepares an automatic template before writing. The server then adds
fixed folder tags using the existing planner before the initial bytes are stored.
The shared text writer uses exclusive create for new notes/configuration, so a
concurrent file cannot be overwritten after an earlier existence check. Existing
text save/revision behavior is unchanged. Template-based creation explicitly skips
the automatic rule to avoid applying a template twice, including empty outputs.

Creation rules deliberately cover app-originated blank notes. Externally created
files and notes with existing starter bodies (including the current daily-note
heading) are preserved; there is no unattended post-creation mutation.

Existing Templater files/settings remain intact. This first native merge does not
claim arbitrary Templater JS compatibility and does not automatically suppress its
plugin: users can migrate their scripts gradually. Native folder rules must reject
activation while an enabled original Templater new-file trigger is present, to
avoid duplicate creation handlers. Native manual template calls share one path.

Runtime behavior, old-script migration, IME, undo/cursor navigation, and measured
performance remain pending user acceptance after static verification.

## Static evidence

An isolated source snapshot containing only this task's changes passed fresh
core/search compilation, Web types (including 24 prepared command/template
regression cases, later extended with a readonly-transition case), server compilation and desktop types. The production Web build
and standalone server bundle/relative-require guard/syntax checks passed. Known
dependency externalization/dynamic-import and large-chunk warnings remain. No
test cases or runtime/HTTP/browser/Electron acceptance were executed. The live
Vault, server/public and desktop release artifacts were preserved.
