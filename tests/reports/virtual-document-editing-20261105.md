# Virtual document editing and status controls — 2026-11-05

Desktop 0.1.60 / PRD 1.33. macOS Apple Silicon, system Chrome for renderer contracts.

- Build and server/web/desktop typechecks passed.
- Unit: 539/540. The existing case-only rename test in operations.test.ts fails on the host's case-insensitive filesystem; no new failures. Seven additional tests cover independent transient session lifetime, undo retention, configuration validation/refresh and native reveal paths.
- Browser: 44/44 virtual-document and split-editing cases. Final virtual-document layout rerun: 3/3. Includes long chapter heading visibility, adjacent chapter edits/independent undo, unedited registry eviction, highlighted configuration save/refresh, native menu dispatch, PDF boundaries/bookmarks and bounded canvases.
- Packaged arm64 application with an isolated copy of real materials: independent keyboard edits save only to the selected source; Undo persists; malformed JSON returns 400 and retains the last valid disk configuration while preserving the editable draft; valid configuration changes update menus; JSON tokens use three distinct colors; actual Electron shell reveals the configuration and opens its folder. No uncaught renderer errors. Sampled three chapters mounted and one PDF canvas.
- Production screenshots were inspected. Specific selectors preserve the group label/flex layout and configuration code typography when the general stylesheet loads later. Configuration content respects floating docks.
- Installed arm64 application was verified in the existing Vault without changing chapter contents. All 24 manifests / 231 sources resolve. Original 30 tabs, active page, sidebar layout, settings and Vault identity were restored and checked. The final application uses a normal launch without test debugging flags; health returned ok.
- Mac arm64/x64 packages built and passed signature verification. x64 execution and other platforms were not tested.

Native harness: `VIRTUAL_REAL_VAULT=<source vault> VIRTUAL_OUTPUT=<evidence> node --import tsx tests/desktop-virtual-documents.mjs <packaged executable>`. All harness writes target an isolated temporary Vault and profile.
