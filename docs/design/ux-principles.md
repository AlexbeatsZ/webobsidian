# UX principles

User requirement (2026-11-02). Every UI change is checked against these rules.

| # | Principle | Rule |
| --- | --- | --- |
| 1 | Object-driven | Act where the object is shown (row context menu, inline edit), not in a manager that asks for the object again. |
| 2 | Reusable selection | Selecting is separate from acting; one selection feeds merge, delete and other batch actions. |
| 3 | No repeated input | Information already known (selected tags, the clicked tag, scope) is never asked for again. |
| 4 | Spatial consistency | Batch actions appear at the top, where multi-select is turned on. |
| 5 | Consistent visual language | Controls of one level use one form (icon-only, text-only or icon+text), not a mix. |
| 6 | Task-first structure | Panels are organized by the user's goal, not by program modules. |
| 7 | State-driven UI | Adapt the existing UI to state (fold on success, open with the fix on failure) instead of stacking new panels. |
| 8 | Progressive disclosure | Secondary and batch controls appear only when needed. |
| 9 | Clear semantics | Position, icon and text together state the action; an add button sits beside what it adds to. |

## Current applications

- **Shared selection bar** (`SelectionBar`): file tree and tags panel. It appears above the list only while a
  multi-selection exists (file tree: two or more; tags: also while the 多选 toggle is on), shows `已选 N`, the
  list's batch actions as icon+text buttons and a close x. Ctrl/Cmd-click toggles, Shift-click selects a range,
  right-clicking inside the selection opens the batch menu, outside it acts on that row alone.
- **Tags**: no separate batch-manager button. Rename edits the row; merge/delete act on the selection; dialogs
  opened for known objects hide the operation picker and source fields and preview immediately. See
  [native-tags.md](native-tags.md).
- **MCP sidebar**: 上下文 (add button in its header) → 候选修改 → 连接 (state in header, folded when connected).
  The review badge opens that list instead of a second list dialog. See [native-mcp.md](native-mcp.md).
- **Icons**: removing an item from a list uses `x`; `trash` means deleting data.

## Known remaining items

- File explorer header mixes creation, view and the 回收站 entry with a `trash` icon; consider moving 回收站
  out of the creation group.
- The generic file/folder tag batch dialog still uses an operation picker because no tag object is chosen there.
