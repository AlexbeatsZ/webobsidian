# Native menus, attachment cleanup and tags

The owner removed embedded webpage browsing and userscripts on 2026-11-01.
Their former implementation, startup/IPC/commands/settings and design document
are deleted. They must not be reintroduced as compatibility adapters. See
[native application boundary](native-only.md).

## Shared owners

| Workflow | Existing owner and integration |
| --- | --- |
| Configured menus | `ContextMenuItem`, React ContextMenu, Obsidian Menu and extendFileMenu share one declarative transformation after native/plugin contributions. Stable IDs, contexts and command dispatch retain their existing owner. |
| Unused attachments | VaultCatalog, TargetIndex, link graph and the file-update queue provide reference evidence. Preview, explicit selection and fresh revalidation precede existing Vault trash/restore operations. Unknown/dynamic reference data never authorizes deletion. |
| Tags | Shared source/property tools, TagsPanel and the catalog own hierarchy, batches, rename/merge, Tag Pages and counts. Local source patches and DocumentSession history preserve unrelated YAML and text. |

App initializes/disposes native menu integration. Settings and nativeCommands use
the existing configuration and command owners. Vault changes invalidate old menus
and mutation requests. This does not add a second watcher, index, command registry
or plugin runtime. Original plugin/configuration files remain intact. Migrated
legacy modules are suppressed by the existing nativePluginPolicy boundary.

Attachment cleanup drains HTTP/background Git and file updates, inspects native
workspace clients and freezes input during revalidation/trash. Dirty/conflict/
saving sessions, pending Canvas edits, trusted direct-filesystem plugins and
unknown/disconnected clients block the operation. These checks retain their
existing owners after browser-product removal.

## Design references

- [Configured menus](configured-menus.md): JSONC, passive examples, context and command limits.
- [Attachment cleanup](attachment-cleanup.md): reference coverage, dynamic/unknown data, preview tokens and partial failures.
- [Native tags](native-tags.md): source ranges, merge confirmation, saved and unsaved catalog state.

Historical 2026-10-22 static evidence is recorded in the project logs. Current
validation and release evidence is recorded in tests/reports/native-only-20261101.md.
Native/device/physical acceptance remains distinct from renderer checks.
