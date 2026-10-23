# Settings interface

## Visual contract (2026-10-23)

Follow the user's Obsidian 1.14.5 references: a quiet title strip, compact search
and grouped navigation on the left, and readable setting groups on the right.
Groups use the existing secondary surface, rounded corners and fine separators;
each setting has its name/description on the left and its control on the right.
Use the current dark/light theme tokens and UI font, 13px main text, 12px help,
16px catalog icons and approximately 30px controls. Do not inherit document
typography or introduce a separate palette, decorative gradients or large cards.

`Settings.tsx` still selects existing native and plugin pages. The only shared
React primitives are `SettingRow` and `SettingGroup`: they own visual structure
and label-to-control association, with no state, persistence or registry. Native
Vault/Git/appearance/account/search/API/plugin/share pages and writing/math,
tags, automation, userscripts and configured menus consume the same structure.
Plugin pages retain their existing container/display/hide lifecycle and receive
compatible `.setting-item-*` styles within the same content surface.

The original settings CSS definitions are updated in place. The old rule that
wrapped an entire page in one oversized card is removed. Source/configuration
editors keep their existing drafts, explicit save/reload actions, monospace text
and errors. Setting IDs, values, hot-reload services, import behavior and save
handlers are retained; visible labels can be clarified within the same settings
page. There is no new settings store or form engine.

Navigation preserves the existing search and feature pages, grouped as general,
editing, extensions and services. Hover, selected and keyboard focus use the same
tokens. The title strip includes the current Vault name and close action. Narrow
windows keep the existing full-screen settings layout: navigation scrolls
horizontally, content scrolls independently, row controls stack and folder-rule
inputs wrap into two columns instead of clipping.

## Shortcuts

Search settings and shortcut assignments keep their existing `updateSearch`
semantics and shortcut grammar. The list shows each registered command's name
and its ID, with a compact editable shortcut capsule on the right. Unknown saved
IDs remain visible and editable. The command-palette jump still locates the
same `data-command` input. No new filtering, binding capture, command registry or
fake add-shortcut action is introduced.

## Delivery boundary

This follow-up is source-only at the user's request: source/Git diff inspection,
no tests, typechecks, builds, probes, app/server/browser launches or acceptance.
No new tests or portable package are created. Runtime appearance, accessibility,
narrow-window layout, plugin pages and saving/hot reload remain unverified.
