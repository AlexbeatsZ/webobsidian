# Reader controls parent acceptance — 2026-10-26

Implementation delegated to CodeBuddy CLI deepseek-v4.1-flash with --effort max.
Parent reviewed changes and independently ran verification. No installer or live Vault changes.

## Results

- First browser run: 14 passed, 5 failed. Not accepted.
- Repair: a real PDF explicit-page/scroll-observer race was fixed by retaining the clamped navigation position until scrolling moves away. Four fixture assumptions were corrected: insufficient table width, inclusive narrow-column boundary, missing runtime Vault synchronization, and unsupported PDF openToSide usage. Tests retain actual overflow, command availability and sidebar ownership checks.
- Final browser run: 19/19 passed,52.4s; includes toolbar placement, default hidden, unchanged reading geometry/scroll/session, retained query/page/zoom, assigned hotkey dispatch, Ctrl+F, narrow viewport, main/sidebar ownership, no hover/outside-click hiding, minimap width and search/Undo regressions.
- Full unit suite:324/324,67 files,5.31s. Web typecheck passed.
- Isolated production Vite build passed. Production frontend with copied installed027 server and temporary Vault passed real titlebar-toggle/search/outline/thumbnails and static PDF resource checks; no page exceptions or failed observed assets. Evidence Temp/.agents/pdf-production-79Z8kR. Parent inspected production screenshot and final Markdown screenshot.

## Behavior and limits

Main PDF toolbar is session-local, initially hidden, opened by titlebar button or existing command pdf:toggle-toolbar. No default shortcut assigned. Existing shortcut settings can bind it. Ctrl/Cmd+F explicitly reveals search. No hover or outside-click hiding. Other PDF panes retain their existing toolbars.

Markdown explanatory paragraphs removed. Width uses actual content column and mounted DOM overflow, not a hard-coded sidebar source width. Canvas resolution remains bounded; scroll-only work moves the viewport box. Offscreen virtualized content cannot provide unrendered overflow measurements; this is still a structural minimap, not a second full document renderer.

Mobile coverage is browser narrow-layout coverage, not Android hardware acceptance. No native Electron caption-controls, physical keyboard/IME or long-run memory acceptance claimed. Installed027 remains unchanged.
