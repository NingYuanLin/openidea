# Terminal Sogou diagnostic build

This independent diagnostic branch starts at `f48cd85d0b2e6bc11b4661ab483b8c64887272a5`.
It deliberately retains the original xterm 6.0.0 premature scroll. It does not
include the terminal fix, Java usages changes, or later main changes.
`scripts/verify-terminal-diagnostic.mjs` verifies both published bundle hashes.
The separate app identifier and product name identify this as a diagnostic app;
its update endpoint is disabled.

## v2: compare four controls in one window

The application is named **OpenIDEA Terminal Diagnostic v2**. Open the ordinary
Terminal pane; its bar says `诊断 v2 · 原版 f48cd85d`. All controls belong to the
same document/WKWebView, with no iframe or external browser.

1. Manually select the system Chinese input method, and choose 系统中文输入法 in
   the bar. Click 开始新采样.
2. Click 聚焦 1 普通输入框, press and release LEFT Shift; repeat with buttons 2,
   3 and 4. Optionally repeat with RIGHT Shift after at least one second: rapid
   double Shift opens the original Search Everywhere shortcut. If it opens,
   press Escape and click the focus button again. Button 3 focuses a transparent
   textarea programmatically; the current-focus indicator confirms its target.
3. For target 4 (the actual terminal), optionally select text and scroll upward
   before Shift to reproduce the original jump. No content is automatically
   inserted or cleared in the terminal. Do not type private content in controls.
4. Click 停止并导出 and choose a local JSON file. Repeat with 搜狗中文 and
   搜狗英文模式, changing the native input method yourself. Export each run.

Target 3 copies relevant terminal textarea IME/accessibility attributes and its
current computed cell dimensions/styles, but uses a local position in the panel;
it does not copy text, selection, or xterm handlers. This is a controlled partial
match, not a byte-for-byte reproduction of the terminal layout/focus history.
Targets 1/2 use ordinary input/textarea defaults. State differences are retained
and labeled rather than silently reset. Buttons work when stopped as an optional
no-recording comparison. Starting over or clearing requires explicit discard
confirmation; exporting first is available. Increase terminal-pane height if
needed; the panel itself scrolls rather than covering terminal content.

The label is chosen by you; the app cannot detect which native IME is enabled.
Sampling is OFF initially, per terminal, and visibly marked while active.
It stops automatically at 6000 records, on terminal disposal or window unload.
New sampling replaces the previous in-memory run. Clear or disposal erases it.
Export stops sampling first. Cancelling the native save dialog writes nothing.
Export bypasses remote-development routing and writes only to the chosen LOCAL
path. There is no automatic upload, persistent capture, or console log.

## Privacy and interpretation

Records contain relative monotonic times, trusted-event flags, safe control-key
identities, modifier flags, allowlisted input types, text LENGTHS, xterm state,
selection LENGTH, viewport positions and fixed call-source enums. Printable
key/code/keyCode/which/prototype-getter values are redacted before retention. No terminal output,
commands, actual input/composition/clipboard text, paths, project names,
environment variables, arbitrary user-agent strings, or stack traces are stored.
Lengths and timing still reveal interaction patterns; review the plain JSON
before choosing whether to share it. The terminal itself still holds its normal
contents; this guarantee concerns the diagnostic record buffer and export.

Synchronous wrappers observe xterm's original calls and return values without
changing arguments, event cancellation, input timers or scroll behavior. They
add some execution overhead; native IME timing may therefore differ. Core and
helper calls have enter/leave records, while capture/bubble event records bracket
normal processing where propagation permits. An absent bubble record is not
proof that the browser did not generate an event. `bottom` with caller `keydown`
after `composition-key` returned false identifies the original premature-scroll
path. `bottom` with caller `user-data` identifies existing user-input scrolling.
An asynchronous callback's earlier parent is not inferred from a stack trace.

Automated tests preserve the original jump, check ordering and input fidelity,
privacy sentinels, cancellation, buffer limits and handler restoration. Browser
automation is not a native Sogou capture. Compare event sequences, not only OS
labels. Candidate-window placement is not measured by this recorder.

Run `pnpm exec vitest run src/features/terminal/diagnostic.test.ts` and
`pnpm exec playwright test --config playwright.diagnostic.config.ts`.

## v2 event ordering

`diagnosticEarly.ts` is the first import in `main.tsx`, installing dormant window
capture listeners before application modules/feature key handlers. Only active
subscribers cause event reads; only registered comparison controls or the selected
terminal contribute records. The active subscriber is removed on stop/disposal.
A WeakMap correlates the same event across stages without retaining event keys.
`order` identifies DOM events; `seq` orders all observations. Window capture is
before app handlers, terminal-root capture is before xterm's target listener, and
terminal target-capture is registered AFTER xterm. Propagation cancellation can
therefore omit later observations. This is the earliest application JavaScript
measurement, not an NSEvent/input-method/native WebKit trace.

Schema 2 records the original KeyboardEvent prototype getter separately from
normal keyCode access, plus a boolean own-property flag. Getter failures (such as
non-keyboard events) produce null. All numeric channels share a control-key
allowlist and printable keypresses are redacted, including punctuation whose
character code coincides with a control keycode. No prototype objects are dumped.
The `target` field uses fixed enums. Terminal helper/buffer/selection state always
refers to the associated actual terminal, even for another target; `targetLength`
refers to that event's target. `label` is manual. No native input-source detection
or trusted-event claim of human origin is made.

The recorder adds synchronous state reads and wrapper overhead, and this panel
changes layout. Compare all controls within the same run and account for those
limits. Automated Linux/runner-browser tests cannot establish native Sogou
behavior or candidate-window placement.
