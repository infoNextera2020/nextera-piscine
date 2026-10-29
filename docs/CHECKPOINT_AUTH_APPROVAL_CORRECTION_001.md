# Checkpoint approval incident and source correction

## Actual incident

The owner's actual attempt 002 approval was message `Sentinel_7b5ec1bcc1cc819187d19f16ccc96f4a` at **2026-10-29 09:17:11 UTC**. The existing guard permits an approval age from zero through 60 seconds. The later launch helper incorrectly used its local receipt-creation time as approval time, then regenerated that time after a freshness rejection. That was not a fresh owner approval. The source guard was not widened, but its input was wrong; this distinction does not excuse the launch.

The lease armed at 09:26:21 UTC with a 10:26:21 UTC hard deadline. Only staging completed. Container startup failed before application migrations or learner creation. Immediate scoped cleanup was requested after the parent clarified the timestamp requirement. That separate cleanup invocation encountered a WSL transport error; the controller's own failure cleanup completed at 09:27:32 UTC. Independent read-only checks at 09:35:08 UTC confirmed all eight containers inactive, ports 56531/56532/3151 closed and the guard exited. Protected data and original/regenerated receipts remain retained. Neither old attempt was restarted, renewed, renamed, deleted or permission-modified during corrective work.

The original discrepancy receipt and stopped-state evidence are retained under `verification/checkpoint-auth-approval-correction-20261029/`. Old launch helpers are incident evidence, not approved future instructions. No new approval is requested or used by this correction.

## Corrected approval boundary

`OwnerApproval` is a frozen, explicit input containing the exact trusted message ID, UTC approval timestamp and approved scope digest. There is no current-time default. A message ID cannot be rebound to another time or scope within the process. The actual closed incident message/time/scope is pinned in source and is rejected for reuse even if a new receipt is produced.

The receipt has a separate `receipt_created_at_epoch` audit field. It must match the independently supplied immutable owner evidence and its binding digest. The legacy `utc_epoch` format is rejected. Receipt creation never supplies or renews approval time. The CLI requires `--owner-message-id`, `--owner-approved-at` and `--owner-scope-sha256`; it cannot infer them from the receipt or current clock.

The zero-to-60-second owner freshness guard is unchanged. It is checked both before read-only preflight and immediately before any reservation, so a slow preflight cannot consume the approval window unnoticed. Missing, expired, future, closed, reassigned or wrong-scope evidence fails before resources are reserved. Runtime outcome/control evidence also records the real owner time and separate receipt time. Cleanup never depends on fresh approval, so an expired grant cannot prevent revocation/stopping.

This local CLI checks consistency and freshness; it cannot authenticate ChatGPT conversation history by itself. The operator must copy the exact ID/time/scope from trusted parent-provided user evidence, never from the machine's current time. The frozen input and closed-message binding are not a substitute for that provenance.

## Workflow before any future approval

1. Review this correction first. Both existing runtime targets are closed/occupied. Do not create attempt 003 or ask for/use another runtime grant under this task.
2. If a future target is separately reviewed, perform all permitted read-only source/image/configuration/port/browser checks first, without reserving it, issuing keys or writing a supposed owner approval.
3. Only after preparation is ready should the parent request a genuinely new exact owner approval. Preserve that message's real UTC timestamp and ID unchanged and dispatch promptly within the actual 60 seconds.
4. Build a matching audit receipt with a separate creation timestamp, then pass the exact trusted owner tuple separately to the CLI. The source repeats preflight and rechecks freshness before reservation. If the time window has elapsed, stop and report; do not refresh fields, weaken the guard or infer renewal.
5. Any permitted later execution still needs a fresh unused target, exact reviewed source/scope, browser access, independent guard and verified cleanup. None is authorized or performed here.

## Independent startup defect

Filtered stopped-container diagnostics locate a syntax error at `/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql`, line 4, near the public token `:`. The DB container had POSTGRES_DB and JWT_EXP environment names but lacked JWT_SECRET. Consequently the public parameterized init script could not substitute that variable. No log values or database-data contents were disclosed/read.

The source now explicitly supplies the three expected DB bootstrap variables with instance-local Compose placeholders, including JWT_SECRET. A pure regression test covers the wiring. Existing containers/configuration/data are untouched. This source repair has not been validated by another startup or SQL execution; no live success is claimed.

## Verification

34 Python injected tests and 19 Node injected tests pass, with targeted ESLint, formatting and diff checks. Regression cases cover immutable evidence, timestamp/scope reassignment, legacy receipts, regenerated receipts after expiry, exact 60-second boundaries, slow preflight and missing CLI owner inputs. No real provisioning is performed by these tests. Full application build and authenticated HTTP/browser checks were not rerun for this source-only change.
