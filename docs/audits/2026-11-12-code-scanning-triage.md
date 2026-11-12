# Code scanning: 21-finding triage and remediation

Reviewed 2026-11-12. Repository: `Ordavid1/freelance`. Reviewed main commit: [`4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727`](https://github.com/Ordavid1/freelance/commit/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727).

## Assessment

All 21 findings were reproduced locally: **8 production-code findings and 13 test-only findings**. CodeQL labels 20 High (7.8) and one Medium (6.1). Those are rule-level scores; review of the actual data paths supports a different remediation order:

| Actual exposure | Findings | Recommended response |
| --- | ---: | --- |
| Medium: production HTML parsing / decoding defects | 3: L08, L09, L15 | Fix first. Two affected production helpers; malformed script handling and ambiguous decoding have observable effects. No executable XSS demonstrated. |
| Low: production correctness, hardening, or likely false positives | 5: L01, L05, L07, L20, L21 | Fix parser consistency and Markdown escaping; make navigation validation explicit and robust. Two sign-in findings concern the same sink. |
| Informational / low: test-only patterns and assertion weaknesses | 13 | Repair assertions and HTML inspection without weakening coverage. No production sanitizer or authorization boundary is implemented by these tests. |

No Critical or High exploit was demonstrated in the reviewed paths. That is a scoped triage conclusion, not a claim that the whole application is vulnerability-free. Existing CSP is defense in depth, not the reason for downgrading these findings.

**Implementation:** all 21 entries below are addressed by this change, with no alert dismissals, query suppressions, or scan exclusions. The table preserves the baseline risk assessment and fix rationale. Implementation was updated onto current main `0ae2110` before final validation. See the verification section below for the final scan and test results. Application deployment and publishing extension 0.2.1 are separate release steps.

## Implemented changes

- Replaced XPlace HTML fallback regex extraction with a parse5 document tree. Script, style, template, noscript, and comment content cannot supply metadata or fallback fields. Flight JSON keeps its precedence; existing project ID, partial-result, and privacy checks still run.
- Normalized bounded Dribbble HTML using browser parsing rules before plain-text conversion. Script/style content is skipped and entities undergo one effective decode; nested encodings remain literal. Raw conversion input is capped at 30,000 characters.
- Updated both XPlace plain-text scanners for alternate comment endings and unusual script/style closing tags, retaining their bounded/linear behavior and existing unterminated-input contract. They remain text extractors, not HTML sanitizers. Server and extension share regression fixtures.
- Reconstructed sign-in destinations from allowed path constants and an encoded validated token. Portfolio links now use a caught URL parse and explicit HTTP(S)/credential checks, so malformed entries remain editable text instead of crashing rendering.
- Escaped backslashes as well as brackets in Markdown labels and used independent expected results in tests.
- Replaced affected test HTML stripping/extraction with inert DOM inspection; strengthened logo-origin and structured-log assertions; preserved the hostile script-string fixture variants with correct escaping.
- Prepared extension **0.2.1**, added extension tests and package checks to application CI, and made its optional browser test use Playwright's portable executable path and an explicit headless option.
- Initial full-suite validation found a stale project-rendering assertion, also reproduced on an untouched checkout of `baf4226`. Main independently fixed it in `0ae2110`; this branch incorporates that commit without carrying a separate test or project-behavior change.

## Evidence and completeness boundary

- The supplied screenshot shows 21 open alerts on `main`, with nine visible rule/location/alert-number combinations.
- GitHub's Code scanning REST endpoint returned **HTTP 403, Resource not accessible by integration**. Its response identifies `security_events=read` as the needed permission. Existing repository and Actions read access works. This is an integration permission restriction, not an automatic approval rejection.
- **Access recheck after the owner updated GitHub settings:** the existing workspace API credential still returned HTTP 403. The connected GitHub plugin is installed and enabled; its `Ordavid1` installation ([configure](https://github.com/settings/installations/150320683)) covers all repositories. However, that plugin's generic fetch tool rejects Code scanning URLs as unsupported endpoints (HTTP 400), and no dedicated Code scanning MCP tool is currently exposed in this Codex chat. The CLI permission rejection and plugin endpoint limitation are separate. This does not establish whether the GitHub-side update succeeded; a previously issued credential may not reflect an installation permission change. Live alert ID/state reconciliation remains pending.
- Actions run [`43220891396`](https://github.com/Ordavid1/freelance/actions/runs/43220891396), for the reviewed commit, successfully uploaded JavaScript and Python SARIF. Its logs identify CodeQL **2.27.4**, `codeql/javascript-queries` **2.5.0**, and `codeql/python-queries` **1.9.0**. The run has no downloadable Actions artifacts containing SARIF.
- Downloaded the same official CodeQL bundle and verified its published SHA-256: `da3e952c7fe978a0b6b93e75d9cbabbdf8535667ca0810bd4b2ae37bc840ffee`.
- Recreated databases and ran both default `*-code-scanning.qls` suites used by the workflow: **JavaScript/TypeScript: 21 results; Python: 0**. All nine visible screenshot rule/location pairs match.
- Thus this is a complete **21-result local rule/location inventory** matching the screenshot's count, not a live GitHub alert-state export. Dismissal status, alert history, and the other 12 GitHub alert numbers remain unverified. IDs `L01`–`L21` below are explicitly local IDs, not invented GitHub numbers.
- The original workspace was at `b56c5c7`; review and probes used an isolated worktree at `/workspace/freelance-security-triage` on current main. Source links below pin the reviewed commit rather than mutable `main`.
- Machine-readable rule metadata, locations, screenshot ID mappings, and relevant data-flow paths: [inventory](2026-11-12-code-scanning-inventory.json). Raw local evidence remains in `/tmp/freelance-triage-javascript.sarif`, `/tmp/freelance-triage-python.sarif`, and `/tmp/freelance-codeql-run.log` for this environment's lifetime.

## Individual dispositions

`P1` means first production fix batch; `P2` means subsequent low-risk production work; `P3` means test maintenance. Priority is distinct from CodeQL severity. Unknown GitHub IDs must be reconciled by rule + path + location after access/export becomes available.

| Local / known GitHub ID | Rule and location | Risk / disposition | Planned resolution |
| --- | --- | --- | --- |
| L01 / unknown | `js/client-side-unvalidated-url-redirection` — [sign-in-form.tsx:33](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/components/sign-in-form.tsx#L33) | P2, Low; likely false positive. `safeNextPath` permits only fixed local handoff paths plus an exact UUID query; no arbitrary redirect demonstrated. Same path as L21. | Return a newly constructed allowed destination, using fixed path constants and an encoded validated token; reject extra parameters, fragments, and control characters. Verify both rules with a rerun. |
| L02 / #15 | `js/incomplete-url-substring-sanitization` — [seo-schema.test.mjs:68](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-schema.test.mjs#L68) | P3, test assertion weakness. `startsWith(ORIGIN)` would accept an origin-prefix lookalike. The generated logo URL is currently fixed. | Parse the logo URL and compare `origin` exactly; retain any intended path constraints. Check the assertion rejects a lookalike host and a userinfo URL. |
| L03 / #21 | `js/incomplete-url-substring-sanitization` — [xplace-fetch.test.mjs:192](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/xplace-fetch.test.mjs#L192) | P3, false positive for URL authorization. This is a negative assertion that logs contain neither host nor project ID; it does not authorize fetches. | Assert the complete parsed log schema, expected URL hash, and field values so no raw URL/ID can hide in an extra property. Preserve the privacy guarantee. |
| L04 / #17 | `js/incomplete-sanitization` — [extension pages.test.js:71](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/extensions/xplace-import/tests/pages.test.js#L71) | P3, fixture encoding issue. Only apostrophes are escaped for a synthetic single-quoted script string; scripts are not executed by the harness. | Build fixtures using a proper JS-string serializer or explicit single-quoted fixtures that also cover backslashes and line terminators. Preserve the distinct single/double/template/comment/JSON spoofing cases. |
| L05 / unknown | `js/incomplete-sanitization` — [seo/llms.ts:36](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/lib/seo/llms.ts#L36) | P2, Low correctness defect. Brackets are escaped but existing backslashes are not. Input is repository-owned registry text and output is `text/plain`; no browser HTML sink or public title-writing path found. | Escape backslashes and brackets together for Markdown labels. Test odd/even backslash sequences and bracket pairs with independent expected results. |
| L06 / unknown | `js/incomplete-sanitization` — [seo-llms.test.mjs:82](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-llms.test.mjs#L82) | P3, test duplicates the same escaping assumption as L05. | Replace mirrored escaping expectations with fixed expected strings and adversarial title fixtures. Land with the L05 fix. |
| L07 / #18 | `js/bad-tag-filter` — [extension shared/clean.js:43](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/extensions/xplace-import/src/shared/clean.js#L43) | P2, Low text-extraction defect. The custom scanner recognizes `-->` but not the HTML comment ending `--!>`. Output goes through plain-text DOM/React sinks, not an HTML insertion sink. | Make comment/script/style extraction follow parser semantics and share a conformance fixture corpus with the server. Include `--!>` and unusual script end tags. Land with the parser batch. |
| L08 / #19 | `js/bad-tag-filter` — [xplace/clean.ts:104](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/lib/imports/xplace/clean.ts#L104) | P1, Medium content-integrity defect. `withoutScripts` fails on `</script data-extra>`; fake metadata inside a JS string can be imported as project data. Authenticated, attested, rate-limited link import from allowlisted XPlace pages is required. | Replace regex HTML interpretation with parser-based extraction that excludes script/style/comment nodes. Metadata must come from actual parsed elements. Retain flight-JSON precedence, project-ID checks, caps, and partial warnings. |
| L09 / unknown | `js/bad-tag-filter` — [integrations/dribbble.ts:60](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/lib/integrations/dribbble.ts#L60) | P1, Medium parsing/robustness issue, shared with L15. Script end-tag handling is incomplete. The later generic tag strip does not provide correct HTML text extraction. Result is source/profile text, not trusted HTML. | Use parser-based plain-text conversion with an explicit script/style exclusion and one entity-decoding policy. Bound input before conversion. Fix together with L15. |
| L10 / unknown | `js/bad-tag-filter` — [seo-pages-harness.mjs:31](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/helpers/seo-pages-harness.mjs#L31) | P3, test HTML-inspection weakness. Script-removal regex misses uppercase tags. | Use a shared parsed-document helper to obtain visible text while excluding scripts/styles/comments. Preserve whitespace and entity expectations. |
| L11 / unknown | `js/bad-tag-filter` — [seo-pages-harness.mjs:35](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/helpers/seo-pages-harness.mjs#L35) | P3, same test-only root cause. | Collect IDs from actual parsed elements, excluding discarded script nodes; preserve duplicate-ID and fragment-link checks. Fix with L16. |
| L12 / #12 | `js/bad-tag-filter` — [seo-guide-article.test.mjs:16](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-guide-article.test.mjs#L16) | P3, test-only script-removal helper. | Replace with the shared parsed-document helper. Fix with L17. |
| L13 / #13 | `js/bad-tag-filter` — [seo-schema.test.mjs:160](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-schema.test.mjs#L160) | P3, test-only JSON-LD extraction. | Select actual `script[type="application/ld+json"]` elements and inspect their text, preserving the assertion that serialized data has no raw `<`, `>`, or `&`. |
| L14 / #14 | `js/bad-tag-filter` — [seo-pages.test.mjs:471](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-pages.test.mjs#L471) | P3, test-only assertion removes scripts with a fragile regex. | Assert the visible glossary DOM contains text nodes rather than injected `i`, `b`, or `em` elements, and separately preserve JSON-LD round-trip checks. Fix with L19. |
| L15 / unknown | `js/double-escaping` — [integrations/dribbble.ts:59–66](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/lib/integrations/dribbble.ts#L59) | P1, Medium in the same conversion boundary as L09. Sequential `&amp;` then `&lt;`/`&gt;` decoding can create a new decoding opportunity after stripping tags. No executable downstream HTML sink found. | One parser/decoder pass with an explicit output contract. Test nested encoding and literal comparison symbols; do not recursively decode until stable. |
| L16 / unknown | `js/incomplete-multi-character-sanitization` — [seo-pages-harness.mjs:35](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/helpers/seo-pages-harness.mjs#L35) | P3, same site as L11. One regex replacement can reveal another tag. | Remove regex-based stripping in favor of parsed element inspection; retain all existing ID checks. |
| L17 / unknown | `js/incomplete-multi-character-sanitization` — [seo-guide-article.test.mjs:16](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-guide-article.test.mjs#L16) | P3, same helper as L12. | Resolve via the shared parser helper, not repeated replacement until no matches remain. |
| L18 / unknown | `js/incomplete-multi-character-sanitization` — [seo-guide-article.test.mjs:142](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-guide-article.test.mjs#L142) | P3, test-only tag stripping before comparing disclaimer text. | Read the actual disclaimer element's text using the helper; retain exact disclaimer equality. |
| L19 / unknown | `js/incomplete-multi-character-sanitization` — [seo-pages.test.mjs:471](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/tests/seo-pages.test.mjs#L471) | P3, second rule on the same site as L14. | Replace the stripping assertion with actual DOM structure and text assertions. |
| L20 / unknown | `js/xss-through-dom` — [profile-studio.tsx:36](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/components/profile-studio.tsx#L36) | P2, Low; likely false positive for XSS. URL extraction begins with `http://` or `https://`; React escapes attribute/text values. A separate malformed-URL crash is reproducible. | Extract a parsed URL helper with `try/catch`, require HTTP(S) explicitly, reject credentials, use the normalized URL for `href` and hostname, and fall back to text editing for invalid input. Preserve `noopener noreferrer`. |
| L21 / #16 | `js/xss` — [sign-in-form.tsx:33](https://github.com/Ordavid1/freelance/blob/4e0b9e4bb6fdc94d52a3ff9ce0c9c0d04949d727/src/components/sign-in-form.tsx#L33) | P2, Low; likely false positive. Same source, custom validator, and sink as L01. A `javascript:` payload cannot satisfy the current path-and-UUID allowlist. | Resolve with the L01 navigation refactor and verify both taint findings disappear or have a precise evidence-backed disposition. |

## What the code exploration established

**XPlace import boundary.** `src/lib/imports/xplace/pipeline.ts` requires feature flags, same origin, an authenticated session, bounded JSON, attestation, input validation, and a per-account rate limit. `safe-fetch.ts` parses URLs and compares exact HTTPS hostnames (`www.xplace.com`, `xplace.com`), forbids credentials/ports, revalidates manual redirects, limits redirects to two, caps streamed data at 2 MiB, and applies request timeouts. L03 does not reveal an SSRF bypass: the production fetch boundary uses parsed hostnames. The affected `withoutScripts` function feeds the project's HTML/meta fallback, while the preferred flight layer intentionally parses JSON data from script text without executing it.

**XPlace text sinks.** Ingest payloads are revalidated and strings/lists are bounded. Extension UI uses `createElement` and `textContent`; reviewed React consumers use ordinary text or form values. The bad filtering rules identify real parsing disagreements, but incomplete stripping alone is not evidence that an attacker reaches executable HTML.

**Dribbble.** Provider bio/shot descriptions flow through `cleanDribbbleText` into profile text and AI source text. Its output is not an HTML-safe value, and should never be treated as one. Current transformations both mishandle HTML syntax and decode entities sequentially. Generic tag stripping also scans unbounded strings before applying the output cap. Upstream provider field limits were not verified, so the local CPU result below is not proof of a remotely exploitable denial of service.

**Navigation.** The two sign-in traces start at `window.location.search`, enter `safeNextPath`, and end at `window.location.assign`. The validator accepts `/profile/import`, or one of two exact handoff routes with exactly one lowercase UUID-shaped token. The flagged profile flow starts with editable DOM text and ends at a React anchor; the HTTP(S) substring constraint and React serialization prevent the demonstrated markup payloads from becoming executable attributes. However, `new URL(url)` during rendering can throw.

**SEO.** The Markdown label input comes from the repository's registry and is served with `Content-Type: text/plain; charset=utf-8`. JSON-LD goes through `serializeJsonLd`, which escapes `<`, `>`, `&`, U+2028 and U+2029 before the dedicated script sink. Keep this protection and its assertions intact while fixing test inspection.

## Concrete probes

All probes were local, with synthetic data and no provider calls or production writes.

1. **XPlace metadata spoofing:** passed the following HTML into the actual `parseXPlaceProjectHtml` with project ID `123456`:

   ```html
   <html><head><script>const str = `<meta property="og:title" content="SCRIPT_CANARY_TITLE"><meta property="og:description" content="SCRIPT_CANARY_DESCRIPTION">`;</script data-extra><title>XPlace</title></head><body></body></html>
   ```

   A jsdom document contains **zero actual meta elements**, but the production parser returns title `SCRIPT_CANARY_TITLE`, description `SCRIPT_CANARY_DESCRIPTION`, and `partial: true`. This establishes fallback data contamination. It does not establish that an attacker can inject that exact source into a live XPlace page; the attacker must control suitable upstream content and induce an authenticated import.

2. **Extension comments:** `FPX.clean.cleanText('before <!--hidden --!>after', 1000)` returns `before <!--hidden --!>after`; a parsed document's visible text is `before after`. This confirms L07's comment syntax mismatch.

3. **Redirect validation:** exercised 75 synthetic inputs against actual `safeNextPath`, including script URLs, protocol-relative/external URLs, encoded slashes, backslashes, control characters, and suffixes around the allowed handoff destinations. **Zero returned destinations escaped the same origin or the three intended pathnames**. Existing tests independently cover round-trip sign-in and refusal of extra parameters/fragments.

4. **Portfolio rendering:** transpiled the unchanged `PortfolioLine` function from the reviewed source, rendered it with React, and inspected the resulting DOM. `javascript:alert(1)` produced no link; quote/event-handler and `<img onerror>` text payloads produced **zero injected event-handler attributes**. The entry `https://[` raised **Invalid URL** during rendering. These are focused component probes, not a full authenticated browser-session test.

5. **Dribbble processing cost:** calling actual `cleanDribbbleText` with `'<a'.repeat(n)` took approximately **42 ms / 167 ms / 676 ms** for 10,000 / 20,000 / 40,000 input characters on this worker. The approximately fourfold increase per input doubling supports quadratic work. Do not treat these numbers as production latency measurements.

## Remediation batches

Batches A–D below are implemented. They preserve the original plan's risk order and acceptance criteria. Batch E's live GitHub ID/state reconciliation remains limited by the access constraints documented above; local analysis verifies that every original rule/location is absent and that no replacement findings were introduced.

Estimates are engineering time, excluding review/deployment queues. Suggested ownership is by code area, not an assignment to a named person.

### Batch A — production import parsing, first (about 1–2 days)

Owner: import/backend maintainer, with extension maintainer for L07. Findings: **L07, L08, L09, L15**.

- Replace server-side HTML regex interpretation with a real parser. Prefer direct extraction from a parsed tree so script contents cannot masquerade as elements. Keep structured flight JSON extraction as a separate, intentional data layer.
- Reuse the existing `html-to-text` dependency for server plain-text conversion where its behavior matches the required contract, with script/style explicitly skipped. If a DOM/tokenizer package is imported directly for metadata extraction, declare it as a direct dependency rather than relying on a transitive installation.
- Define one decode policy: parse/decode HTML once; nested encodings remain literal text at the remaining level. Preserve intended math/comparison text, Hebrew, newlines, caps, and surrogate-pair safety. Do not market the result as safe HTML.
- Align extension and server behavior using the same fixture corpus. Existing extension source is classic scripts, so account for its packaging constraints; do not introduce Node-only dependencies into content scripts. Any parsed document must remain inert with resource loading and script execution disabled.
- Bound raw input before expensive text conversion. Test sustained malformed openers and comments as well as normal provider data. Do not solve CodeQL by adding increasingly complex stripping regexes or repeatedly decoding/replacing until stable.
- Regression gates: the spoofing sample must not yield metadata; script/style content stays excluded for mixed-case tags, unusual end-tag attributes, `--!>`, nested encoding, and quoted `>` characters. Existing flight/HTML/meta priority, ownership/attestation checks, partial warnings, and publisher confirmation must continue to work. Retain current no-network hostile-input performance coverage.
- Run XPlace app tests, extension tests, focused Dribbble conversion tests, app typecheck/build, and CodeQL. Ship application and extension updates through their normal separate release paths. Verify both deployed versions; merging source alone does not update a published extension.

### Batch B — navigation and rendering hardening (about half a day)

Owner: frontend/auth maintainer. Findings: **L01, L20, L21**.

- Refactor `safeNextPath` to parse/refuse the incoming value, choose a fixed permitted pathname, and construct a fresh result with a validated and encoded token. Keep exact query cardinality and reject trailing controls. Never generalize to arbitrary same-origin URLs just to silence a rule.
- Replace portfolio substring use with a helper that catches URL parse errors and explicitly enforces HTTP(S); use a normalized return value for the anchor, favicon input, and hostname. Invalid candidates remain editable text. Preserve external-link behavior and tab isolation.
- Regression gates: successful `/profile/import` and both token handoffs; refusal of script/data URLs, external/protocol-relative targets, encoded separators, credentials, malformed hosts, duplicate/extra query parameters and fragments; malicious text produces no active markup; malformed portfolio text does not crash rendering.
- Rerun CodeQL and inspect the actual data-flow result. If a remaining finding is a modeling limitation, document the exact guard and tests before proposing a narrow false-positive disposition. No global suppression or test-path exclusion.

### Batch C — Markdown correctness (about 1–2 hours)

Owner: SEO maintainer. Findings: **L05, L06**.

- Escape backslashes and brackets together for link labels. Replace the test's duplicate implementation with independent expected text, including odd/even backslash runs.
- Keep the registry-derived link destinations, plain-text response headers, indexability policy, and deterministic output. Run SEO tests and CodeQL.

### Batch D — test inspection and assertion cleanup (about half a day)

Owner: test/SEO maintainer. Findings: **L02, L03, L04, L10, L11, L12, L13, L14, L16, L17, L18, L19**. L06 is already in Batch C.

- Add one explicitly declared dev parser dependency/helper for test HTML inspection. Parse without script execution or network resource loading. Select actual elements/text/attributes rather than stripping tags with regexes; do not reuse the production extraction algorithm as the test oracle.
- Preserve and strengthen observable assertions: JSON-LD round trips, raw script delimiter escaping, exact visible disclaimer text, duplicate IDs, fragment links, and absence of injected glossary elements. A parser must not normalize away the very injection the test is meant to catch; retain raw serialization assertions where required.
- Replace the logo prefix check with parsed-origin equality and the log substring assertion with exact structured schema/value checks. Replace partial JS fixture escaping without deleting the hostile ownership/session tests.
- Run SEO tests, XPlace fetch tests, and extension tests; rerun CodeQL with test files still included.

### Batch E — reconciliation and closure (about 1–2 hours after fixes)

Owner: repository security maintainer.

1. Obtain Code scanning alerts **Read-only** access or a live export. Match all 21 local entries by rule, path, and location/fingerprint; fill the 12 unknown GitHub IDs. Track drift if `main` moves.
2. Ensure all batches cover the full 21-item set; findings sharing a sink/helper may close together. Re-scan the actual candidate head using both languages and the same suites, keeping tests in scope.
3. Require zero remaining open items from this inventory. Prefer automatic fixed closure after the code changes reach `main`. Any irreducible false-positive dismissal must be a separate, explicit, evidence-backed disposition for that specific alert; do not dismiss test findings wholesale.
4. Check new findings as well as the original count. A successful CodeQL workflow only means analysis/upload succeeded; it does not mean there are no alerts.
5. Run the normal repository application/security checks before merge. After merge, verify the `main` analysis commit and alert states; after release, verify the affected application/extension behaviors.

## Baseline validation before remediation

- Targeted application tests: `node --experimental-transform-types --experimental-test-module-mocks --test tests/xplace*.test.mjs tests/dribbble*.test.mjs tests/seo*.test.mjs` — **311 passed**. There is no dedicated `dribbble*.test.mjs` file in this snapshot; the wildcard does not establish dedicated Dribbble conversion coverage. Add that coverage in Batch A.
- Extension tests: `npm test --prefix extensions/xplace-import` — **97 passed**.
- Additional profile-source test: `node --experimental-transform-types --experimental-test-module-mocks --test tests/profile-sources.test.mjs` — **1 passed**.
- Total executed baseline tests: **409 passed, zero failed**. These are baseline results before remediation, not proof the findings are fixed. No full build or live provider/OAuth exercise was performed because application source was not changed.
- Local CodeQL reproduction:

  ```sh
  codeql database create /tmp/freelance-triage-db --db-cluster \
    --language=javascript,python --source-root=/workspace/freelance-security-triage \
    --threads=4 --ram=10000 --build-mode=none
  codeql database analyze /tmp/freelance-triage-db/javascript javascript-code-scanning.qls \
    --format=sarif-latest --output=/tmp/freelance-triage-javascript.sarif --threads=4 --ram=10000
  codeql database analyze /tmp/freelance-triage-db/python python-code-scanning.qls \
    --format=sarif-latest --output=/tmp/freelance-triage-python.sarif --threads=4 --ram=10000
  ```

  The binary used was `/tmp/freelance-codeql-tools/codeql/codeql` from the verified 2.27.4 bundle. Local reproduction used a full database, while CI's logs indicate an overlay-base database. Matching version/packs, count, and visible locations provide strong corroboration; only GitHub's alert API/export can establish the live state mapping.

## Remediation verification

Final candidate: branch `codex/fix-code-scanning`, based on main `0ae211030daaf7db53093d6a21b4e160565932a8`. [Machine-readable verification](2026-11-12-code-scanning-verification.json) records the source-input fingerprint and SARIF digests; the [inventory](2026-11-12-code-scanning-inventory.json) records the outcome for every original entry.

| Check | Result |
| --- | --- |
| Full default JavaScript/TypeScript CodeQL suite, including tests | **0 findings**, down from 21 |
| Full default Python CodeQL suite | **0 findings** |
| `npm test` | **530 passed**, 0 failed |
| Extension tests | **98 passed**, 0 failed |
| Python tests | **6 passed**, 0 failed |
| Typecheck and production build | Passed |
| Production dependency audit | 0 vulnerabilities |
| Extension 0.2.1 package checks | Passed; 42,470-byte ZIP |
| Extension browser flow | All six checks passed using Playwright's bundled Chromium in headless mode |
| Diff whitespace validation | Passed |

The final full database cluster is `/tmp/freelance-release-db`; SARIF files are `/tmp/freelance-release-javascript.sarif` and `/tmp/freelance-release-python.sarif`. Reproduction uses the same commands and CodeQL 2.27.4 bundle as above with those database/output paths. No query was suppressed, and no test or source path was excluded to obtain zero results.

Browser verification covered the consent boundary (nothing staged before the click), extension invitation, handoff tab URL, staged payload privacy canaries, the 0.2.1 bridge marker, and reading the payload through the bridge. It used local routed fixtures, not real XPlace accounts or production provider calls. Additional regressions verify the metadata-spoofing sample and attribute/comment/template variants fail, unusual script closers preserve real Dribbble text, nested entities decode once, malformed portfolio URLs remain text, and malformed closing-tag sequences do not cause quadratic scanner work.

GitHub's existing alerts are on `main`; they are not claimed closed by a branch-local scan. Verify the PR checks and, after merge, the main analysis and alert states. Application deployment and Chrome Web Store publication remain separate release actions.
