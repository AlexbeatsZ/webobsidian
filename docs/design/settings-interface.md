# Settings interface

## Visual contract (2026-10-23)

Follow the supplied Obsidian references: compact title strip, searchable left
navigation grouped into options and native features, and ordinary rows with names
and descriptions at left and controls at right. Search and Hotkeys are separate
pages. About identifies AlexbeatsZ/webobsidian, AlexbeatsZ and the upstream fork.
Account, API-key, public-sharing and plugin-install pages and their internal
implementations are removed. Installed plugins retain the existing enable API;
plugin-owned settings tabs retain their display/hide/container lifecycle.

SettingRow and SettingGroup own visual structure only; pages keep their existing
state and saving services. Settings uses the existing theme tokens, UI typography,
small catalog icons, quiet groups and dividers. The original CSS is updated in
place. Formatter categories contain flat setting rows, including normal suboption
rows; no nested rule details/cards or embedded JSON/code editors remain.

The backdrop centers Settings on every open. The title strip drags the existing
modal with pointer capture and viewport bounds; no other modal drag mechanism was
present. Closing drops its DOM/position; reopening centers it. Small windows keep
the full-screen layout and horizontal navigation and disable title dragging.
No editor selection/input subscriptions are added.

### Shared buttons (2026-10-28)

The existing obsidian.css button block owns ordinary native settings controls,
the plugin ButtonComponent adapter (.btn) and the native file picker's
::file-selector-button. They share UI typography, 28px minimum height, padding,
border and radius; file inputs retain the real browser picker, filename, keyboard
access and disabled semantics. File selection is not replaced by a hidden input
and a second JavaScript-triggered button. Submit/reset/button inputs in settings
use this same block, not the text-input presentation.

.btn keeps the primary action, .secondary keeps neutral actions and .danger keeps
warning actions. Hover applies only to enabled controls, including file pickers
and fieldset-disabled controls; focus-visible uses the shared accent outline.
Tag and prompt dialogs and formula retry actions reuse these classes rather than
leaving ordinary buttons to the platform appearance.

Toolbar/icon actions keep the existing .tool-btn family, including plugin search
clear and ItemView actions. Ordinary settings rules exclude that family. Ribbon,
tab, navigation, menu, table-handle, source-control and content-tree buttons keep
their contextual styles; there is no global reset of every button.

## Configuration ownership

### Document typography (2026-10-25)

Appearance exposes document font size (integer12–36px, default18) and readable
column width (integer320–2000px, default700). Width includes the existing32px
padding on each side; the default net text area is636px. Narrow panes still
shrink to their available width. Defaults preserve existing layout rather than
silently widening every Vault. Restore defaults changes only these two fields.

The existing server settings `ui` object owns persistence. The shared pure
`contracts/uiSettings` schema supplies defaults/ranges to storage, route validation
and the Appearance controls. Invalid partial updates fail before persistence.
Successful UI saves notify the mounted App through the existing API facade;
App projects values into `--font-text-size` and `--file-line-width` on the body.
There is no extra storage/index, editor recreation or page reload. Failed saves
leave the last applied appearance and expose a retryable error.

UI-only writes are ordered to prevent old responses restoring obsolete sizes.
Vault switches retain their separate maintenance behavior and must not be
queued behind ordinary UI writes in a way that deadlocks pending-mutation drain.
Existing document sessions, undo and selection remain untouched. Main title,
content and both view modes consume the same typography; UI control font sizes
remain separate. Existing CodeMirror geometry updates and MathJax measurement
own formula invalidation; no additional resize observer or renderer is introduced.

User CSS remains possible, but an explicitly scoped custom override can still
supersede inherited document variables. These preferences do not promise exact
visual parity with every Obsidian theme or change monospace font glyph metrics.

Settings exposes ordinary toggles, file paths, external open, copy-path and reload.
ConfigurationFile is the shared visual row, consuming desktop.openVaultPath. It
owns no configuration store or editor. Browser clients can copy paths; desktop
opens existing paths through the single main-process API. Missing files report
an error. Explicit create actions use the existing feature save services and
exclusive-create/revision semantics; opening never creates or replaces a file.

- WritingSettings calls updateWriting/refreshWriting. Advanced LaTeX, snippets,
  custom regexes and formatter arrays live in .obsidian/webobsidian/writing.jsonc.
  Missing native configuration uses native defaults, without reading old app or
  plugin settings. Snippets default to .obsidian/webobsidian/snippets; an absent
  directory is empty and is not created on read. Existing explicit source paths
  and inline definitions in writing.jsonc remain authoritative.
- MathSettings keeps package toggles through updateWriting. Macros, preamble and
  package options are edited externally in math.jsonc or its preamble file; the
  MathJax candidate validation and queue/cache remain unchanged.
- AutomationSettings lists command enable toggles and template folder/counts,
  opens automation.jsonc, and uses the same automation.save/reload/import APIs.
  Settings no longer holds JS or JSON drafts, add/remove/edit command code, or
  a second template-rule editor.
- ConfiguredMenuSettings lists root/include paths and reload diagnostics through
  the existing MenuConfigurationController. Source drafts, inline example editing,
  save/discard and settings-local export UI are removed. Existing export commands
  and the menu engine remain available.
- UserscriptSettings removes source/GM/import/pending-code editors. The desktop
  store remains authoritative. External source copies are for review; edited
  scripts re-enter existing file-import/prepare/approval. It displays the real
  store path and uses the existing management boundary for open and settings.

No new watcher, parser, settings registry or note-content path is introduced.

## Shortcuts

HotkeySettings is owned by the existing palette/command implementation. Settings
only selects its independent page; SearchSettingsPanel retains search preferences
and history selection keys and no longer reads or edits command bindings.

## Delivery boundary

Source/Git diff inspection only. No tests, typechecks, builds, probes, app/server/
browser launches, acceptance or new tests/package. Runtime appearance, dragging,
accessibility, saving/hot reload and desktop external open remain unverified.

## Native categories and CSS snippets

Options now select About, Appearance, Interface, Editor, Files and Links,
Hotkeys and installed Plugins. Interface uses the existing sidebar/auto-reveal
store actions; Editor uses the existing workspace view mode. Search remains its
own native feature page. No placeholder page or parallel preference store exists.

Appearance includes the actual Vault CSS list, filter, toggles, external folder
open and refresh. It uses the one original enabledCssSnippets list in
.obsidian/appearance.json, the existing Vault IO revision protection and the
Plugins/runtime stylesheet lifetime. See css-snippets.md. Settings has no embedded
CSS editor, and does not rewrite snippet source files.

The 2026-10-23 follow-up removes standalone engineering/migration explanations
outside setting cards, including Plus migration flags and CSS storage details.
Names, short actionable row descriptions, file-open controls and real errors or
operation results remain. No replacement tooltip/help UI is added.

The 2026-10-24 debug page reuses SettingGroup/SettingRow and the existing UI settings
service. It exposes recording/source inclusion, explicit capture, local export and
clear-after-stop controls. The shared recorder also serves three existing-registry
commands; Settings owns no log buffer, input handler or alternate diagnostic state.
See editor-debugging.md for lifecycle, retention and evidence boundaries.
