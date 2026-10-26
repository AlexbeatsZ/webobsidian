# Windows 0.1.27 installation and STEM migration

## Build and install

- Exact source: 4f942d763da3ff237740e20bd5efc9d2450c7d9e, including rendering lifecycle fixes65e05fb.
- Fresh isolated search/core/Web/Server/desktop compilation, NSIS packaging and actual packaged standalone guard passed.
- Setup: desktop/release/0.1.27/WebObsidian-0.1.27-win-x64-setup.exe,104100721bytes, PE0.1.27; BUILD-INFO.json alongside.
- Packaged isolated Edge/Vault startup passed in4.312seconds, zero renderer errors.
- Parent confirmed no WebObsidian process before upgrade. Existing physical installation was0.1.26, superseding historical0.1.24 records.
- Normal same-user NSIS overwrite upgrade exited0; installed EXE reports0.1.27. No uninstall, profile reset or forced termination.
- Desktop shortcut restored from the installed Start Menu shortcut after upgrade.

## Explicit user-authorized Vault move

- Source: C:/Users/Meta/Project/Workspaces/meta-obsidian/.local/test-vault.
- Destination: C:/Users/Meta/Documents/Obsidian/STEM.
- Destination parent was not literally empty: synchronization markers, docs and AGENTS.md remained. These were preserved; STEM did not exist.
- Sent normal WM_CLOSE to the app started for this task; save-before-close completed and processes exited. No taskkill or forced exit.
- Same-volume directory move preserved6569files and3803041470bytes. No note rewriting or content hashing performed.
- Updated desktop startup hint, authoritative server Vault path/allowed root, and nativeFeatures/hotkeys/writing path keys. Existing UI state was retained unchanged.
- Original configurations and migration inventory: C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-stem-migration-20261025.
- Restarted installed app; server log confirms new STEM path. Read-only native obsidian_get_context returned active note and retained open/recent notes.
- Did not reconfigure synchronization, migrate the Mac Vault, change original Obsidian configuration, or remove existing parent files.

## Verification boundaries

Source-focused browser16/16, unit14/14 and Web types previously passed for65e05fb. Current package is a version-only successor. Historical full247pass/2environment skips belongs to30f87dc, not a fresh full-suite result. This turn proves Windows installation, startup, moved Vault identity and native context; it does not claim physical IME, print, long-run or exhaustive native UI acceptance. Mac installation and existing MCP Tunnel retargeting have separate owners/results.
