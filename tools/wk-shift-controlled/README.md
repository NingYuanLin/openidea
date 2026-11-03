# Controlled WKWebView Shift experiment

This is an isolated synthetic experiment, not an OpenIDEA change or a user diagnostic package.
It tests whether `InputMethodUsesCorrectKeyEventOrder` plus a native empty `insertText:` can change a Shift keydown from 229 to 16.
The prediction comes from WebKit tag `WebKit-7624.2.5.11.4` (commit `7c696f573290ed8ba774ff24f2dfda07af822a31`). The actual runner framework version is recorded in every result; it must not be assumed to match the user's `21624.2.5.11.8`.

Each of 24 conditions starts a new process, WKWebView, ephemeral data store and focused HTML input. The feature is enumerated, set before constructing the view, and read back. Two Shift press/release cycles are posted as native `NSEventTypeFlagsChanged` events through NSApplication. There is no JS keyboard dispatch. Left/right, feature off/on and synchronous/20ms delayed completion are crossed with three controlled IM responses:

- handled=true, no command;
- handled=true, empty native insertText on press (no insertion on release);
- handled=false, no command.

The test replaces the input-context method only for the exact expected synthetic NSEvent object and exact context, forwarding all other calls. For these controlled events it deliberately supplies a mock IM result rather than invoking the real IM. It invokes the actual WKWebView native insertText method for the empty-command case, then returns the mock result to WebKit's real completion. Thus the observed DOM is produced by the installed WebKit engine, but the IM side is synthetic. This never establishes what Sogou or Safari actually does.

The original IMP is restored on completion. Unsupported features, ABI mismatches, missing callbacks and timeouts are explicit invalid results. A contrary but structurally valid result is preserved, not converted into a passing prediction. The runner neither opens Safari nor modifies global preferences. Only its own synthetic app is instrumented. No accessibility permission or global event monitor is used. Results contain only fixed synthetic controls and metadata, not user files or traces.

Run `python3 tools/wk-shift-controlled/test_validation.py` anywhere; on a standard ARM Mac run `bash tools/wk-shift-controlled/build.sh`. Outputs are ignored by git. The workflow uploads only synthetic results, not a user-facing DMG. The native app's timeout is a failure boundary, never a readiness assertion.
