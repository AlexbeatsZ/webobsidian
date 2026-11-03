# Block corner references: source verification, 2026-11-02

## Scope

Continues `omen:claude:be408770`. PRD 1.27 adds hover-only clipboard (`![[^id]]`)
and link (`[[^id]]`) buttons to display equations, tables, fenced code (including
Mermaid/HTML previews), Callouts and HTML blocks. Existing source controls share
the corner group where available. Desktop package version: 0.1.53.

`contentReferenceCommands.copyContentReference` is the shared command/button
implementation. Core content targets own table/HTML identities and source edits;
their standalone ID line follows one blank line. Existing IDs are reused, and
creating an ID is one undoable editor transaction. Fragment views omit reference
buttons; reading views can copy existing IDs but cannot create them.

## Current verification

- `npm run typecheck`: passed, including a fresh core build.
- `npm run test:unit -- --reporter=dot`: 513 passed / 514 total, 90 passed / 91 files.
  The existing real-Git periodic-backup test exceeded its 5000ms deadline and
  cleanup then found its disposable Vault busy. No sync implementation was changed.
- `npx vitest run server/src/services/fileSyncGit.test.ts --testTimeout=30000 --hookTimeout=30000`:
  5/5 passed, 11.53s total. The periodic-backup case took 4839ms in isolation;
  this result does not make the default-deadline full run green.
- Focused Edge renderer regression: 14/14 passed, 29.5s total, one worker,
  isolated render harness at loopback port 5187. Covered all five button types,
  hidden/revealed hover state, both clipboard syntaxes, reuse and undo; existing
  heading/range commands, missing targets and global completion; Mermaid font
  cancellation/concurrent parse failures; quoted Callout native input; whole-block
  quoted geometry/modes/folding; native-sync workspace lease refresh.

## Earlier session evidence and limits

The earlier full renderer run had 358/363 passes. Three failures counted new
button icon SVGs as diagram output; those selectors now count only diagram SVGs.
All five former failures pass in the current focused run. The full renderer suite
was not repeated in this continuation.

On a narrow table, the hover group covers the upper-right header area; the top
edge and right edge remain occupied by column-drag and add-column controls.
These results verify source/harness behavior. They do not establish installed
desktop interaction, physical-device behavior or native clipboard acceptance.
