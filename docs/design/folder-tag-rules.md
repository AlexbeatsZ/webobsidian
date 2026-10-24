# Folder tag rules

## User workflow

Settings → 标签 contains editable folder/tag rules, a recursive flag per rule,
an automatic create/save switch and an optional ancestor-tag pruning switch.
Rules are per Vault under native feature tag settings. Automatic behavior defaults
off, with no rules. Saving settings does not batch-modify notes. An explicit
“预览补齐已有笔记” button and `tags-folder-rules` command reuse the existing
tag preview/apply/cancel dialog. Preview works even with automatic saves disabled.

All matching rules accumulate. A folder `04资料` matches its descendants only when
recursive is enabled, never `04资料库`. Empty folder means the Vault root; exact
root applies only to root notes. Visible Markdown files only. Folder and tag
comparison is NFC/case insensitive, while stored spelling follows the first rule.
Existing unrelated YAML tags remain. With pruning enabled, an existing or newly
added tag whose descendant exists is removed from YAML, e.g. `_资料` is replaced
by `_资料/AI`. Inline tags, aliases and unrelated metadata are untouched. Without
pruning, parent and descendant tags both remain. Moving a note out of a matching
folder never removes its previous tags automatically.

## Legacy import

The original template calls `09插件/templates_scripts/folder_tag_sync.js` and reads
`@管理/按文件夹补标签配置.md`. The native import button reads that note into a
settings draft, preserving the original note and script. It accepts the marked
data-only object literal, JSONC comments/trailing commas and known bare keys;
expressions/functions/spread/unknown or duplicate keys are rejected. No eval or
JavaScript execution is used. Import clips typeRules/subjectRules to managedRoots,
retains recursive coverage, enables ancestor pruning, and leaves auto-run off.
Review and save the imported draft explicitly. It does not require Templater.

## Ownership, timing and source safety

- `packages/markdown-core/src/tags/folderRules.ts` is the shared matching/planning owner. It delegates
  YAML source changes to `planTagSource`; no second YAML writer/parser is added.
- WorkspaceDocumentSession prepares automatic additions before the existing save.
  Edits enter shared session history as one group, then normal saves/autosaves
  persist them. No keystroke hook, background scan, watcher or new file index.
- Initial app-created Markdown without a session uses the same planner inside
  the existing Vault write path. Subsequent session saves own history and revisions;
  the server does not transform their source behind the client's saved snapshot.
- Existing external/plugin writes or file moves are not watched for automatic
  mutation. A moved note gets its destination tags on its next app session save,
  or through the explicit folder-rule batch command.
- Rules use the existing per-Vault settings queue. Changes broadcast over the
  existing socket and refresh native preferences in other pages. A Vault switch
  invalidates old-page mutations, preserving the old sessions until reload.
- Unsafe YAML causes an explicit per-file skip in preview. Automatic tagging
  instead reports the skip and continues saving the user's unchanged source.
  BOM, mixed line endings, comments and unknown values follow core source patches.
- Batch snapshots bind the folder rules to preview. Changed rules require a new
  preview; changed disk revisions skip rather than overwrite. Open/dirty notes use
  DocumentSession; unopened notes reuse the Vault CAS writer. Existing cancellation,
  partial-result reporting, cleanup maintenance exclusion and file updates remain.

Enabling automatic rules means a later save may re-add a deliberately removed
fixed tag. Disable automatic rules before making a lasting exception. The feature
does not promise to track which historical tags came from which old rule.

## Verification

Static only: complete source and isolated scoped-source types, production web and
standalone server bundles, syntax/relative-require checks. Regression source covers
hierarchy/roots/path segments, BOM/CRLF, pruning/idempotence, protected YAML and
data-only import; cases remain unexecuted. UI, undo/redo, migration, real saves,
multi-client behavior and performance remain user acceptance. No app/service/browser,
live Vault, server/public, release or portable output is changed for this task.
