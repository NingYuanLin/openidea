# Terminal Sogou diagnostic build

This independent diagnostic branch starts at `f48cd85d0b2e6bc11b4661ab483b8c64887272a5`.
It deliberately retains the original xterm 6.0.0 premature scroll. It does not
include the terminal fix, Java usages changes, or later main changes.
`scripts/verify-terminal-diagnostic.mjs` verifies both published bundle hashes.
The separate app identifier and product name identify this as a diagnostic app;
its update endpoint is disabled.

## Collect two runs on the same Mac

1. Open a terminal with enough history to scroll. Select 系统中文输入法 in the
   diagnostic bar and switch macOS to that input source. Click 开始新采样.
2. Select text, scroll into history, press Shift as usual, optionally extend the
   selection with a click. Click 停止并导出 and choose a local JSON file.
3. Switch to Sogou and select 搜狗中文 or 搜狗英文模式 to match its mode.
   Repeat the same steps and export a second file before starting another run.

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
key/code/keyCode values are redacted before retention. No terminal output,
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
