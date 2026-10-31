# xterm 6.0.0: scroll on submitted input

The pnpm `patchedDependencies` entry applies `@xterm__xterm@6.0.0.patch` to
both published production bundles (ESM and UMD) and the corresponding TypeScript
source. An IME-handled key is not necessarily submitted input: Shift, language
switching and candidate edits can reach `CompositionHelper.keydown` without
emitting text. Its false return must not scroll the viewport.

The patch only removes that premature scroll. It preserves CompositionHelper,
its timers and textarea diff, and CoreService's existing `wasUserInput` scrolling.
There is no forced compositionstart scrolling, onData scrolling, or key-based
commit detection. Ordinary input and candidate commits still scroll; device
responses do not. Existing IME rollover/deduplication defects are not addressed.

Published bundle sourceMappingURL comments are removed because their maps describe
the unpatched bundles. The source patch documents the actual change; bundled
vendor mappings must not misleadingly show the removed scroll call.

Run `pnpm exec playwright test --config playwright.terminal.config.ts` to exercise
both bundles in Chromium and WebKit. These tests simulate IME events; they do not
validate native Sogou language switching or candidate-window placement. While
viewing history, composition DOM can activate without its cursor being visible.
The native candidate window must still be checked on macOS before acceptance.

When updating xterm, re-evaluate the patch against upstream, regenerate it with
`pnpm patch` / `pnpm patch-commit`, and rerun the regression suite. Do not carry
forward a patch by version substitution alone.
