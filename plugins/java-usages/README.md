# Semantic Java usage categories

OpenIDEA loads this app-owned OSGi bundle alongside java-debug. `openidea.java.usages`
returns `{location, kind}` entries. The Rust LSP bridge converts positions with the
server's negotiated encoding and transports optional classifications to the popup
and Find Usages window. Servers that do not advertise the command use ordinary LSP references. An advertised
command failing is reported as an error; it is not silently treated as unavailable.
Cancelled requests and results for an edited/closed source document are discarded.
No global `includeAccessors` setting is changed.

The command preserves the normal ReferencesHandler result (unclassified entries
remain `unknown`) and searches exact JDT field/getter/setter objects separately.
Explicit Lombok `@Accessors` naming is resolved from field/enclosing-type annotations,
then matched to method signatures before JDT searches their references. Reference
text is never used to decide a category. Same-line calls remain separate ranges.

## Build

The checked-in jar contains only this project's command, no third-party classes.
It is embedded into ide-sdk and installed in the app data directory, so users do not
need Python or a Java compiler. Keep its manifest version and installation filename
in sync when releasing an updated bundle (OSGi caches bundles).

```sh
python3 plugins/java-usages/build.py /path/to/jdtls-1.46.1
```

Pinned build dependency: [JDT LS 1.46.1 build 202504011455](https://download.eclipse.org/jdtls/milestones/1.46.1/jdt-language-server-1.46.1-202504011455.tar.gz).
Archive SHA-256: `f435fdf6db3aa0d1598ef0f11f80bb20e09e67009001382719c313eff07de02c`.
The archive contains the ECJ compiler and all compile-time jars; no Maven resolution is involved.
Verified rebuilding from a fresh extraction with OpenJDK 21.0.12.1 produces jar SHA-256
`8d61a71380afda865fe5a0e0b6463cb3238c728c2612618930b83f922c4e2495`.

Requires Java 21 and the JDT LS distribution's ECJ compiler. Build twice to verify
identical SHA-256. This bundle uses JDT internal APIs; rerun the integration test
when updating the supported server versions.

## Actual server tests

```sh
python3 plugins/java-usages/tests/verify.py /path/to/jdtls /path/to/lombok.jar
```

The harness starts a real JDT LS with the real Lombok agent, imports an Eclipse Java
project, builds it, queries standard references and the extension, and asserts
exact category counts plus preservation of every standard reference. It also
changes `includeAccessors` to false and asserts only direct field references remain.
There is no mocked Java language server.

Recorded successful runs: JDT LS 1.46.1 / Lombok 1.18.38 / OpenJDK 21.0.12.1 and
JDT LS 1.63.0 / Lombok 1.18.48 / Oracle JDK 25. Raw before/after responses, source,
server identity and Lombok manifest/hash are in `tests/evidence-*.json`.

| Selected field                                  | Getter | Setter | Direct field |
| ----------------------------------------------- | -----: | -----: | -----------: |
| `@Data name`                                    |      2 |      2 |            2 |
| `@Data active` (boolean)                        |      1 |      1 |            0 |
| explicit fluent/chain/prefix `mTitle`           |      1 |      1 |            0 |
| explicit chain/prefix `mLabel`                  |      1 |      1 |            0 |
| handwritten `size`, overload and inherited call |      2 |      1 |            2 |

These fixtures include same-line get/set calls and method references. Standard
references returned zero for the fluent/prefixed fields; the extension found both
accessors using resolved JDT method targets.

Browser verification replays those actual results into the real UI, not a mock
component. Start a fresh Vite server (avoid mixing HMR module versions with dynamic
imports), then run:

```sh
pnpm exec vite --port 1451 --strictPort
OPENIDEA_TEST_URL=http://localhost:1451 node plugins/java-usages/tests/browser.mjs \
  plugins/java-usages/tests/evidence-1.63.0.json /tmp
```

Requires Chromium at `/usr/bin/chromium`. Checks counts, viewport bounds and transfer
to Find Usages. This is UI verification, not a full native Tauri end-to-end test.

## Remaining limits

- Naming configured solely in `lombok.config` is not resolved here. Such accessors
  can remain missing from the standard JDT search, especially fluent/prefix cases.
  This is a scoped repair, not full IntelliJ Lombok parity.
- Explicit naming support uses exact JDT signatures. Unusual generic/type spelling,
  custom capitalization or ambiguous annotations may remain unclassified/missing.
- Non-field selections and additional JDT results (such as builder methods) remain
  unknown; no categories are invented from `get`/`set` text.
- macOS WebKit, a packaged DMG, and the user's own project were not exercised.
- The app's existing JDT LS automatic updates make internal-API compatibility an
  ongoing maintenance requirement. Missing command support falls back to normal references; an advertised command failure
  is reported through the existing request error path.

Review also verifies that fluent methods returning an unrelated type are excluded,
unknown-only updates remain visible, and popup-to-Find preserves the result note.

## Final aggregate checks

After review, `cargo check -p ide-host`, clippy for ide-host/ide-lsp/ide-sdk with
`--all-targets -- -D warnings`, and `cargo fmt --all --check` passed. The complete
ide-lsp/ide-sdk library suites passed 135 tests (2 intentionally ignored).
Frontend typecheck, build, knip and repository-wide format checks passed. Lint's
14 warnings match a clean 9c31a27 checkout exactly. The full frontend suite first
caught three missing Chinese labels introduced here; those translations were added. The final full rerun passed all 4007 tests across
389 files.

Full-workspace clippy cannot complete in this cloud image: both this patch and a
clean 9c31a27 checkout fail compiling glib-sys because `glib-2.0.pc` is absent.
This does not constitute a successful native desktop build. The verification
layers remain distinct: real JDT LS/Lombok semantic tests; actual-response replay
in Chromium; no complete packaged desktop or macOS WebKit run.
