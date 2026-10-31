# Semantic Java usages

The app-owned OSGi command `openidea.java.usages` returns `{location, kind, access}`.
`kind` retains field/getter/setter/unknown identity for compatibility. Optional
`access` is read/write/readWrite/unknown. Missing access metadata is unknown;
old servers and ordinary LSP locations remain visible under either filter.
An absent command uses standard LSP references. An advertised command error is
reported. Cancellation and source-document version checks remain in the Rust bridge.
No global `includeAccessors` preference is changed.

## Search plan and access semantics

For source fields on the verified JDT LS implementation, a single plan merges
field, native getter/setter, native builder and explicit Lombok Accessors targets.
Targets are deduplicated by JDT element identity before search, retaining native
search scope and ranges. Builder results remain unknown. The optimized native
plan is guarded by SHA-256 of ReferencesHandler.class:
`31ff5a10c7d69d58c6a9b619ef17e3ec41b11b545751ba428618a76cc1341064`
(JDT LS 1.63.0.202610191322). Different implementations, non-field selections and
library/decompiled selections retain native discovery plus deduplicated category
searches. This conservative fallback preserves coverage when the server changes;
it does not promise the same speedup on unverified versions.

SearchEngine resolves exact targets. A query-local syntax AST per referenced source
file supplies expression context without another reference search: simple field
assignment is write, compound assignment/increment is readWrite, ordinary field
use is read. Writing an array element or a receiver's member reads the array or
receiver field. Getter/setter call expressions are read/write respectively.
Method references, declarations, unavailable/changed source, and unclassified
search targets remain unknown. No call text or get/set prefix classifies a usage.
Explicit `@Accessors` is resolved to JDT method signatures as in the prior bundle.

For larger result sets, a query-local AST range index avoids repeating NodeFinder
traversals. It indexes only requested exact AST ranges and verified invocation
selector-to-call-end spans; duplicate, recovered, malformed or uncontained ranges
fall back to NodeFinder. Method references do not get invocation aliases. Source
snapshot checks remain per result, and the index is discarded after the query.
There is no cross-request cache or binding-resolution shortcut.

Popup and Find share persisted read/write toolbar switches. Both initially show;
turning the last one off automatically enables the other. Unknown and readWrite
entries survive both single-access modes. Filtered-out selections are not previewed.
Exact original ranges and access metadata survive transfer to Find. Closing or
superseding a popup request prevents late responses from reopening it.

The interaction and primary-field/secondary-accessor design were checked against
[JetBrains IntelliJ Community e992ff4](https://github.com/JetBrains/intellij-community/tree/e992ff4750b4c36afe2caadfa8b191a8f36fb7a2):
`LombokFieldFindUsagesHandlerFactory`, `LombokReadWriteAccessDetector`,
`UsageFilteringRuleStateRWAware`, `ReadAccessFilteringRule`, and
`WriteAccessFilteringRule`. This implementation does not copy those sources and
is not a claim of full IntelliJ feature parity.

## Rebuild and delivery

The checked-in jar is embedded by ide-sdk `include_bytes!`, installed as
`java-usages-1.1.1.jar`, and added alongside existing initialization bundles.
Users need no compiler, Maven or Python. Manifest/install version must change
when replacing the bundle because OSGi caches bundles.

Build dependency: [JDT LS 1.63.0 build 202610191322](https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz).
Use its shipped ECJ and plugin jars, with Java 25; emitted bytecode targets Java 21.
The build uses sorted inputs and fixed zip timestamps and does not resolve Maven
artifacts. Build twice and compare SHA-256. Current dependency hashes and output
hash are recorded in the task's validation deliverable.

```sh
export PATH=/path/to/jdk25/bin:$PATH
python3 plugins/java-usages/build.py /path/to/jdtls
```

## Real server and browser verification

```sh
python3 plugins/java-usages/tests/verify.py /path/to/jdtls /path/to/lombok.jar
python3 plugins/java-usages/tests/read-write.py /path/to/jdtls /path/to/lombok.jar > /tmp/read-write.json
OPENIDEA_USAGES_INDEX_STRESS=1 python3 plugins/java-usages/tests/read-write.py /path/to/jdtls /path/to/lombok.jar > /tmp/read-write-indexed.json
pnpm exec vite --port 1451 --strictPort
OPENIDEA_TEST_URL=http://localhost:1451 node plugins/java-usages/tests/browser.mjs /tmp/read-write.json /tmp
```

The first harness verifies legacy category coverage, standard-reference inclusion,
boolean/fluent/prefix/chain naming, overloads, inheritance and includeAccessors=false.
The second runs actual JDT LS/Lombok and checks structural read/write cases, interface
and inherited calls, nested same-line calls, method references, receiver/array
reads and a real `$/cancelRequest` response (`-32800`). The browser replays that actual response into real Chromium components,
checks counts, mutual toggle behavior, viewport placement, Find transfer and
persistence. It is not a native Tauri/backend end-to-end test. Start a fresh Vite
server to avoid stale HMR module instances in dynamic imports.

Older `evidence-*.json` files document the previous category-only implementation
on JDT LS 1.46.1 and 1.63.0. They are not evidence for the new read/write implementation.

## Reproducible performance comparison

```sh
python3 plugins/java-usages/tests/performance/prepare.py /path/to/jdtls /tmp/usages-bench
python3 plugins/java-usages/tests/performance/measure.py /path/to/jdtls /path/to/lombok.jar /tmp/usages-bench
python3 plugins/java-usages/tests/performance/compare.py /tmp/usages-bench > /tmp/usages-summary.json
```

Requires git baseline `0dad7de27ffd680efd7467f2f6f3f60c693b7a0e`, JDK javac and
JDT's ASM jar. `prepare.py` builds test-only instrumented variants and an agent
counting actual SearchEngine calls. Production jars contain no counter code.
`measure.py` first verifies counts, then runs three fresh JVMs per implementation
in alternating order, sequentially. Each case has one first-touch query, five
warmups and thirty measured queries. Only the first field query follows a fresh
workspace import; other first-touch queries share that JVM, so they are not cold
server measurements. Warm samples total 90 per case. Avoid builds/other workloads
while measuring. Full legacy locations, kinds and ranges must match; newly added
access metadata is verified separately. A forced-fingerprint-mismatch variant
checks fallback coverage. The 150-use fixture includes 600–750-result fields,
builder unknowns, explicit/fluent Accessors, method selection, declarations,
includeAccessors=false and library references.

## Boundaries

- `lombok.config`-only naming, unusual generic spellings, custom capitalization or
  ambiguous annotations retain the prior limitations; no speculative mapping.
- Method references are conservatively unknown rather than asserted immediate reads/writes.
- Constructor initialization is outside this product change.
- Internal JDT APIs still require compatibility testing on updates; guarded native
  planning is intentionally limited to a verified implementation.
- Packaged desktop/macOS WebKit and the user's own project require separate testing.
