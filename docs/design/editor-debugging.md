# Local editor debug recording

The recorder is explicitly enabled in Settings > 调试 or the existing command
palette (`debug:toggle`, `debug:capture`, `debug:export`). It defaults off. The
existing server UI settings own debugRecording/debugSource; App applies them on
startup, and the same service updates them from Settings and commands. No Vault
source, workspace/session history, parser or recovery behavior is changed.

One application recorder outlives editor instances. The MarkdownView extension
observes CM transactions and native input/composition/pointer/focus events; the
existing exceptionSink captures plugin failures without hiding normal console
errors. Existing sourceControls and MathJax renderMath supply source requests and
render request/result/error/abort events. App's existing document registry supplies
version/dirty/saving/locked/conflict state. Window errors, rejected promises,
console errors/warnings, visibility and supported long-task entries are recorded
only while enabled. Each event has a page-session UUID, sequence, wall timestamp
and monotonic elapsed time. Pagehide may duplicate an unacknowledged event; use
session+sequence to identify it.

Each new view, explicit capture, enable/options change and caught editor error
records a baseline: source, selection and frozen IME selection, mode, readonly,
source-region/forced-render region, live-plugin presence, viewport, fonts, scroll
and up to40 visible node boxes. Later input records contain source-range patches.
Baseline/insert text over65536 UTF-16 units is explicitly truncated; exports are
diagnostic evidence rather than an exact replay guarantee after truncation or
rotation. Source-disabled new records retain lengths, ranges and timings but omit
note/insert/character-key text. Earlier records remain until explicitly cleared.
Paths and error messages remain diagnostic fields. Exports are local downloads;
the app does not upload them to a third-party service.

Off-path cost is an enable-flag branch in the existing CM/math/event hooks; no
timers, global error/console/longtask subscriptions, source serialization or layout
reads run while off. When on, source deltas use existing transactions and cached
syntax facts. Geometry reads occur only on baseline/explicit/error captures,
never on every keystroke. This is not a measured performance improvement claim.

The bounded memory queue holds at most4MiB/4096 records; individual events over1MiB
are dropped and the dropped count is exported. A2s timer flushes acknowledged
batches (at most256 events/1.5MiB) through the existing local settings API. Failed
batches stay queued and surface an error; export includes unsaved buffered data
even if the local service cannot be read. Disabling drains pending data before
persisting off, and reports a failed drain instead of claiming success. Best-effort
pagehide beacon sends only small batches; a sudden process/OS crash can still lose
the last unflushed events.

The local server accepts appends only while enabled and validates batch shape and
size. One serialized DebugLog owns write/read/clear/rotation under DATA_DIR/debug,
four editor-N.jsonl generations at8MiB each (32MiB maximum). Read/clear of absent
logs do not create a directory. Debug requests do not count as document mutations
for Vault maintenance. No network telemetry, autosaving of notes, full DOM dumps,
new watcher, second source parser or automatic view restart is introduced.

The reported global failure recovered after a page switch before logs existed.
Its cause is unconfirmed. Capturing a controlled CM plugin failure verifies the
recorder, not the cause or repair of that earlier incident. Preserve the user
window/session when the next incident occurs; record/export before restarting.
