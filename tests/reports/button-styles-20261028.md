# Button styles - 2026-10-28

## Cause and inventory

The UserscriptSettings file import is a real file input. Its browser-owned
::file-selector-button was not matched by settings' button rules, so macOS used
its native typography, border, padding and background. Baseline browser evidence
shows Arial/13.3333px, square 2px border and 0px minimum height instead of the
ordinary UI font/13px, 5px radius, 1px border and 28px minimum height.

Audited all 175 JSX button declarations, both native file inputs (the Canvas
image picker is intentionally hidden) and all 17 imperative button constructors.
Classless controls inside settings, ribbons, native canvas toolbar, palette,
hotkey capture, sidebar and tag tree already have contextual selectors. Keep
those styles rather than indiscriminately giving every control a filled box.

## Changes

- One existing obsidian.css rule now styles ordinary settings buttons, button/
  submit/reset inputs, .btn and the native file selector. Shared UI typography,
  height, border, radius and padding; original filename/picker behavior retained.
- .btn primary/secondary/warning semantics retained; enabled-only hover, disabled
  opacity/cursor and keyboard focus shared. No second styling component or hidden
  picker/button click bridge.
- Tag operation/page dialogs, prompt confirmation and formula retry reuse .btn.
  Plugin SearchComponent clear and ItemView actions reuse .tool-btn; settings
  ordinary-button rules exclude that existing icon family.
- Settings design contract documents these owners and deliberate exceptions.
  Desktop version is 0.1.33. No dependency change.

## Verification

- Baseline file-selector mismatch and unstyled prompt confirmed before repair.
  One early fixture also raced React mounting; replaced frame timing with actual
  adapter-container readiness. Later selector fixes exclude search text inputs
  from the ordinary-button comparison and use actual icon titles.
- Seven dedicated real UserscriptSettings browser cases pass in clean isolated
  dependencies: both themes/computed styles; adapter variants/hover/focus/disabled;
  source import/reimport/8MiB guard; fieldset-disabled native picker; prompt/tag
  dialogs; plugin search/view icon actions. Final UI-font refinement:7/7,14.0s.
- Frozen adjacent suite:40 passed,2 environment-dependent original-plugin tests
  skipped,1.5min. Includes the seven cases above, appearance8, tag1, math15,
  real-plugin-host1, sidebar4 and palette4. No test tolerance/retry changes.
- Frozen final Web/Desktop types,426/426 units across76 files(6.84s), fresh
  search/core/Web/Server production build pass.
- Mutable-root combined run had9 adjacent failures; source/api.ts was changing
  concurrently. Clean frozen suite passes. Do not attribute those failures to
  a product cause. A first isolated dependency-junction attempt was stopped for
  missing nested ts-dedent/browser-picomatch resolution; clean npm ci replaces it.
- Viewed final dark/light screenshots. Evidence in
  Temp/.agents/webobsidian-buttons-0133/browser-clean and browser-final-font.

## Boundaries

No live Vault/profile/configuration, installed application or user process was
changed or restarted. Browser fixture uses the actual UI and a controlled desktop
bridge, not real macOS Electron/file-picker acceptance. Cross-platform release
publication is recorded separately after actual native builds complete.
