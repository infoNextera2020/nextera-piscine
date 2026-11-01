# Exam1 trace processor: source integration boundary

> Source follow-up: `EXAM_TRACE_NATIVE_READER_SOURCE_001.md` now supplies the
> restricted PostgreSQL adapter and an unregistered RPC/comparator draft.
> The missing-source inventory below describes the earlier processor milestone;
> native SQL, authority, durability and live delivery are still unverified.

Generic grading details are approved in owner message
`Sentinel_e849fe300ea88191acd6431b61521c7a`, replying to proposal
`Sentinel_772f0614fef88191b978c186a2bf8248`. The exact approval timestamp was not
provided; no timestamp or execution authorization is manufactured. The separate
PowerShell fake-test approval remains pending.

## Implemented source

- The named `crlf_lf_optional_terminal_lf_v1` comparator validates UTF-8, converts
  CRLF to LF, removes at most one terminal LF per side, then compares every
  remaining byte. It does not rewrite stored answers. Historical `exact_utf8`
  retains its old meaning. Intrinsic typed-array bounds ignore shadowed metadata,
  getters and iterators; Buffer/subarray remain supported and shared/resizable/
  detached/unsupported views are denied.
- The A-D rubric source records the approved group weights and manual splits.
  New preparation requires the new comparator and exact source/private-criteria
  provenance; a valid-looking message ID/hash is not proof of owner identity.
- `prepareScoredExamTraceOracle` binds a selected form/question/paper/criterion,
  reviewed reference program/output/checkpoint document and review-evidence hashes
  to an immutable evaluator digest. Expected bytes stay in a private WeakMap.
  It validates supplied bytes; the server artifact loader must verify authentic
  source/review/approval provenance independently.
- `createScoredExamTraceProcessor` composes one explicitly supplied q6/q7 pending
  receipt through required reader, criteria and publication-retention ports into
  the existing restricted `recordExamFunctionalEvidence` writer. No caller supplies
  `matched`, points or a role claim. Missing ports/client/limits make it unavailable
  before client-method access. `available` indicates structural configuration,
  not actual native authority or runtime readiness.

## Receipt and publication contract

The authoritative reader must prove the evaluator's current native authority and
return the exact receipt/outbox binding: learner/cohort/attempt/curriculum/node,
form/question, whole canonical JSON bytes/hash/length, answer kind/contract,
accepted time, definition/snapshot, evaluator route, rubric/source/published
criteria and current scoring revision. The processor takes a bounded data-only
snapshot and re-reads/rechecks the full binding after criteria loading.

Already accepted answers may be graded after exam expiry. This processor does
not reuse learner submission-open/deadline checks to discard valid historical
acceptances. Neither it nor the comparator awards manual reasoning points.

The private criteria port must return the exact verified prepared oracle for that
binding. It cannot infer missing expected output from a student answer or use
fixture values as defaults. The artifact's expected output/checkpoint prose stays
outside learner/domain bundles; returned events contain only matched evidence and
binding/provenance hashes.

The publication outbox port must provide protected, bounded, immutable and durable
store/readback with exact operation-byte idempotency. Readback must match before
any native scoring write. This is a publication envelope, distinct from the SQL
structured-answer intake outbox. No file/storage adapter is implicitly created.

Preparation has one original budget across reads, criteria and retention. Native
publication is bounded separately. Its pending latch is installed before ports
run; retained reads cannot reenter a second writer. Late retention cannot start a
new SQL write after the budget. A timeout cannot prove cancellation or rollback:
it returns uncertain, suppresses duplicate pending calls and retains the original
operation/revision/payload. An explicit owned-envelope retry never re-reads and
rebinds to a newer submission/revision. Once uncertainty exists, a later denial
does not erase it; only an exact validated recorded acknowledgement resolves it.
There is no automatic retry.

## Required native and deployment work

No existing SQL supplies a restricted q6/q7 evaluator reader. Learner and mentor
readers are web-scoped; the functional native context covers coding q1-q5.
Implement/review a narrow evaluator-only read boundary; do not reuse web/mentor
credentials or grant direct table access as a workaround.

DRAFT0024's source-binding validator still accepts only historical `exact_utf8`.
Its native allowlist must be separately reviewed/versioned for the new policy.
All SQL remains unchanged in this source milestone; no migration/grant is applied.

Native reader/criteria/file/outbox adapters, work discovery/claim/lease handling,
restart recovery and actual delivery are absent. This explicit-receipt source
composition is not a running structured-outbox consumer. Original source
acceptance/rubric/artifact publication and complete private manual-criteria
bindings remain required. A trace-only checklist cannot substitute for the whole
manual document. q8 automatic repair projection remains unimplemented.

Fake tests cover normalized matches/mismatches, whole-answer identity, stable
rechecks, provenance and malformed inputs, unavailable/revoked ports, retention
before write, forgery/tamper, callback reentrancy, intrinsic byte bounds, deadlines,
lost acknowledgements and explicit exact retries. They do not prove real SQL
syntax/ownership/ACLs, storage durability, native cancellation, queues, browser
registration or any complete learner journey. No real grading is enabled.
