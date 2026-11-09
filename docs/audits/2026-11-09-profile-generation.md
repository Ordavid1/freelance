# Profile generation audit — 2026-11-09

## Observed request and saved result

- Cloud Run request: 2026-11-09 13:49:23.515833 UTC (15:49:23 Israel), HTTP 200, 29.260115242 seconds, revision freelance-engine-00014-7rm.
- Cloud trace: 9df357c9d30c210cfd00037082a1bfe9.
- Runtime model: gemini-3.8-flash; global Vertex endpoint; Google Gen AI SDK 1.52.0.
- One 144,419-byte CV PDF was uploaded at 13:49:18 UTC; the profile was saved at 13:50:13 UTC. The exact submitted source selection and raw Gemini response were not logged. The saved profile may include user edits.
- Inspected the private CV locally and compared its explicit roles/dates, team/funding/customer numbers, business percentages, stated experience durations and education with the saved profile. Those checked claims match. Removed temporary CV copies after review. This is a factual spot check, not proof of every output statement.
- The saved profile has all seven template fields: name, headline, bio, skills, portfolio, experience, education. Profile save currently retains edited fields, not the generation's facts/provenance.

## Call hardening

- Separate trusted system instructions from untrusted document, URL and social data. Social excerpts submitted by the browser are data, not authenticated factual attestations.
- Explicit JSON Schema covering every field, lengths, skills, facts and the permitted source identifiers. Distinct document identifiers map to ordered attachments.
- Validate every field and source citation after parsing; deduplicate skills. Reject truncated/safety-stopped responses.
- Preserve Gemini 3's default temperature rather than overriding it with 0.2. Cap generation at 16,384 output tokens (including room for thinking), and set a 45-second SDK timeout within the route's 60-second budget. No automatic replay of paid requests.
- Preserve URL retrieval status. Warn when a URL cannot be confirmed retrieved, omit its evidence records, and fail URL-only generation if none of the requested pages was retrieved. Successful retrieval alone does not prove semantic accuracy; user review remains required.
- Correlate a generation ID and Cloud trace with model/version, prompt version, duration, token counts, finish reason, input/output hashes, source counts and hashed URL retrieval statuses. Do not log document text, profile text, attachment bytes, credentials or raw URLs.
- Surface unavailable-source warnings in the editor. Source content and raw output are not retrospectively recoverable from hashes.

## Validation

- Live Vertex test using synthetic professional text plus example.com: schema + URL Context accepted, STOP completion, retrieval successful; unsupported employment/education stayed empty. 15.54 seconds, 3,276 total tokens including tool and thinking tokens. This small input is not a speed benchmark against the real CV request.
- Actual installed SDK wrapper live test (synthetic professional evidence): STOP, schema validation passed, 6.93 seconds, 1,161 total tokens; unsupported fields remained empty.
- Regression checks cover field/citation validation, failure on truncation/safety, configuration boundaries, redacted correlated diagnostics and failed URL-only retrieval.
- Exact real-input quality/performance should be measured on a representative consented dataset before claiming optimality. Schema correctness is separate from factual correctness.
