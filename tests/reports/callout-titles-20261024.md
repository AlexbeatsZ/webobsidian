# Callout title and nested frame correction — 2026-10-24

User's latest rule: all wrapped title text rows share the first text row's left
edge. Icon center matches the rectangle between the left rule center and text
left edge, over the complete multirow title. Earlier first-line-only expectations
were wrong and have been removed from implementation and tests.

- Existing head widget/type marker and native title mark now form an intrinsic
  flex pair. The type marker's presentation also owns its source separator;
  raw quote source boxes and source bytes remain intact. No fixed title column,
  absolute icon, font-specific transform, extra observer or coordinate pipeline.
- Nested neutral frame paint is now owned by the existing spacing wrapper's
  intrinsic parent-prefix grid. Native lines still span the original source origin.
  Inner left border aligns to outer body and retains a matching right inset.
  The former direct container background/border is deleted.
- Baseline latest-axis regression failed at1.9452875px horizontal error; the old
  first-line icon rule and missing text column also failed wrapped-title checks.
  Corrected seven types at18px and24px, two views: line-left error0px, vertical
  center0px and horizontal center below0.001px (CSS serialization rounding).
- Exact two-line user title, bold/nested/default titles, real second-row pointer
  input and Ctrl+Z, independent fold/source reveal are exercised. Three nested
  frames, quoted table, native origins and symmetric painted insets are measured.
- Real slow25ms and immediate0ms keyboard sequences start from empty source,
  type `> [!tip]`, Enter, body, nested header/body, exit quote, select/delete and
  Undo. No stale title/frame was reproduced in those sequences.

Earlier51-case full pass preceded the nested-frame change. Latest full result is
recorded with the debug integration in editor-debugging-20261024.md. Snapshot
failures from test setup are retained: an obsolete query looked inside the native
text title for its preceding icon; another measured fold-button glyph rectangles
as title text. Final tests inspect actual title character ranges.

An additional throwaway Backspace probe produced `> [!tip]\nnnsdfjk`: Markdown's
lazy continuation keeps that prefix-free line in the quote and its text starts at
the source origin. This is a separate source-layout observation; it does not
reproduce the reported global input/math-source failure. Its screenshot/source
remain in Temp results-lazy-red2; no speculative keyboard or parser change was
added, and the exploratory assertion was not adopted as a passing regression.

The user reported that switching pages recovered the global failure before a
runtime exception could be captured. Cause remains unconfirmed. Browser tests
do not establish physical IME, native EXE window or long-run behavior.
