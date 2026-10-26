# Visible-example Run contract - source slice 001

Status: prepared manifest/policy validation, immutable work/outcome contracts, a backend factory over injected authority/reservation ports, and request-ID reconciliation. **No real reservation store, executor, public example catalog or production wiring was enabled.** `checkpointRunBackend` and `checkpointDraftBackend` remain null. No services, database operations, accounts, roles, tokens or credentials were created in this slice.

## Implemented source

- `apps/web/lib/checkpoints/visible-run-spec.ts`: strict data-only public manifest and explicit policy parsers; domain-separated manifest/policy/intent SHA-256 digests; exact UTF-8 source bounds; frozen public-only executor work; bounded allowlisted outcomes. Extra operational diagnostics are never returned for `system_error`.
- `visible-run-backend.ts`: prepared `CheckpointRunBackend` factory. It resolves server-owned context again on each read/intake, validates the source/filename/scope/definition/public-manifest/limits, then calls only the dedicated reservation port. It does not invoke an executor or graded submission/Judge path. Missing or incoherent capabilities fail closed.
- `editor-http.ts`: optional `readByRequest` backend capability and authenticated GET `/api/checkpoints/runs?attempt=...&task=...&request=<original UUID>`. Supply exactly one of `run` or `request`. This can reconcile an uncertain acknowledgement after intake closes if current access/read policy still allows it, without reserving a new run. An older adapter without request lookup returns 503. Existing run-ID lookup remains compatible.
- `visible-run.test.ts`: injected/fake-only tests. A TypeScript executor interface and fake implementation are not actual sandbox or compiler verification.

## Public manifest format and authority

Version 1 deliberately supports a small Go function ABI: one named function, a string or exact decimal int64 argument, and a string return. The manifest declares the authored task, exact exam definition digest, single Go filename, package/function names and keyed visible input/expected-return examples. No executable harness code, shell commands, URLs, environment, mounts, image tags, private-pack references or hidden-case metadata are accepted. Unsupported signatures are unavailable, not silently adapted or inferred from private grading packs. A future fixed trusted driver must safely encode the data; no driver is implemented here.

Manifest identity includes exact visible strings, ordering and harness metadata. The server authority must resolve an immutable approved public artifact bound to this frozen exam definition and validate its expected digest. Computing a digest from arbitrary data is not publication approval. Nothing in this commit authors examples, rewrites curriculum, adds a definition field, imports a catalog or assumes that current private grading packs contain publishable examples. A future authoritative publication/binding design is still required; avoid any circular digest dependency when adding references to frozen definitions.

Manifest/parser and source/output transport ceilings are 262144 bytes, matching the existing source ceiling; they are not chosen production allowances. Total serialized public-manifest data and cumulative examples are bounded. Malformed UTF-8/lone surrogates, duplicate keys, unsupported properties, ambiguous/overflowing int64 values and path/identifier injection are rejected. BOM, CRLF, Unicode and NUL source bytes are preserved.

## Explicit Run policy and immutable intent

A usable server policy must positively declare enabled, visible examples only, ungraded and no consumption of graded attempts. Every source/output/time/memory/rate-window/concurrency allowance and maximum example count must be explicit; there are no fallback numbers. A pinned runtime image digest and no-network/no-host-access/disposable-filesystem/unprivileged-process/external-resource-enforcement requirements are mandatory. Those declarations express the adapter contract, not proof that a real sandbox enforces it.

An immutable intent binds learner/cohort/attempt/question/definition, request ID, exact filename/source/hash/length, public manifest digest, policy digest and trusted deadline. Work preparation verifies all bindings again and strips extra storage metadata. Public result projection contains only the existing Run ID/request/source hash/state/bounded output; no grade, mastery, hidden results or private infrastructure diagnostics. `completed` means visible execution completed, not exam success. Output remains plain text data, never executable HTML; the future UI must render it as text.

`VisibleRunReservations` specifies the still-unimplemented durable atomic boundary: recheck current access, definition, manifest/policy and trusted time at commit; bind idempotency to the whole intent; enforce independent learner rate and learner/attempt concurrency; persist immutable source and a dedicated dispatch/outbox together. Identical replay must not charge twice; mismatched reuse must conflict. Do not use app submissions, Judge jobs, graded quota or draft receipts as the Run ledger. A source-level preflight is insufficient for concurrency, access-removal or deadline races.

The worker must reauthorize a claimed dispatch and prove the selected image/isolation/resource controls before executing. It must prevent duplicate dispatch, bound combined output and compile/runtime diagnostics as they are produced, and reclaim capacity only once execution is proven stopped. An AbortSignal interface is provided; no cancellation implementation, deadline-stop behavior or lease reaper is claimed. Accepted records can be queried after intake closes only while current access/read policy allows; result retention and shutdown semantics need a reviewed implementation.

## Remaining backend integration requirements

1. Approve/author the public examples and fixed Go driver support needed by each real task. Bind manifest identities to the frozen exam through a reviewed authoritative source; never derive public cases from hidden tests.
2. Review the separate policy values and pinned runtime identity. Implement a durable reservation/outbox/lease store with atomic idempotency, rate and concurrency tests. A future migration would remain draft until a specific target/application approval.
3. Implement and independently verify an actual isolated executor, bounded output, cancellation/cleanup and crash recovery. This needs a specifically approved environment action; this source task grants none.
4. Decide Run result/source retention and deadline behavior for already-accepted work, then wire the backend only when all capabilities are positively configured. Add authenticated editor/browser integration tests. No production enablement flag or memory-store fallback exists here.

## Minimal policy recommendation for owner review - not configured

A conservative rehearsal starting point is **one concurrent Run per learner/attempt**, **five new Runs per minute per learner**, **two seconds**, **128 MiB memory**, and **16 KiB combined output** per Run. Keep source no larger than the task's existing accepted source limit, and use only that task's explicitly visible cases. Validate these proposals against the actual public driver/examples before approving them. They are documentation proposals only; code, database and production configuration seed none of them. Numeric test fixtures are synthetic and do not approve policy.

Recommend not starting queued work once the exam deadline/access closes, and stopping active work at the earlier of its own resource limit or the trusted exam deadline. This is a proposed conservative worker behavior, not a new grading or deadline rule and not implemented here. It must not auto-submit, affect grades, consume graded attempts or extend the exam. Run result/source retention remains undecided; do not silently borrow draft retention.

## Manual Home/Journey review and environment checkpoint

The user explicitly confirmed the Home/Journey manual review finished and approved those screens. This is product acceptance, separate from the prior 78 automated fixture-browser checks. The known preview was then verified by full command, UID and listener, stopped only as PID 527, and checked absent with port 3118 closed. Cleanup evidence: `verification/home-b-journey-browser/preview-cleanup.json` under the Windows task directory. No other service was stopped. The earlier disposable PostgreSQL test remains completed and removed; it was not rerun in this slice.

## Verification limits

Source tests exercise manifest/policy rejection, stable digests, exact source identity, immutable public payloads, output privacy/bounds, server-authority mismatch, injected commit-time errors, and request reconciliation after intake closes. They do not prove real rate limiting, exactly-once dispatch, database atomicity, sandbox isolation, actual Go execution, cancellation, live authentication or editor UI behavior. No new browser QA is claimed for these nonvisual source changes.

Evidence directory: `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\checkpoint-visible-run`. Final source counts/checks are recorded after verification. All four original dirty files must remain byte-identical and unstaged. No push or deployment.

Final source verification: **85 new cases; 518/518 tests across 40 files passed**. Full typecheck, lint, formatting and production build passed. No executor, database, Auth or browser integration test was run in this source-only slice. The original four dirty files are preserved; the user-approved preview cleanup is separately verified.
