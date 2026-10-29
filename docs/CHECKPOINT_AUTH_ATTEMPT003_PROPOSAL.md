# Authenticated Checkpoint attempt003: source proposal only

Status: prepared source, not authorized or executed. This document prepares the separately reviewed unused-name profile requested after the closed attempts. It creates no runtime target, database, service, key, credential, learner, role, approval receipt or browser assertion. Neither old attempt's protected root/data was inspected or changed. Attempt003 target availability has not been probed; later runtime preflight must reject any occupied target.

Read [the approved source-window change](CHECKPOINT_AUTH_APPROVAL_WINDOW_002.md), [the timestamp correction](CHECKPOINT_AUTH_APPROVAL_CORRECTION_001.md) and [preflight review](CHECKPOINT_AUTH_PREFLIGHT_REVIEW_002.md) first. The actual closed approval was message `Sentinel_7b5ec1bcc1cc819187d19f16ccc96f4a` at **2026-10-29 09:17:11 UTC**. Its original binding remains permanently rejected for reuse. Source preparation does not renew it or authorize another run.

## Approved source policy: version 2

The owner approved changing the attempt003 approval-to-launch window from 60 to 600 seconds in message `Sentinel_6c15d89054c08191b4923a8313c5552b` at `2026-10-29T13:51:58Z`. This is source-policy approval only; that message cannot authorize a runtime launch. Version 2 includes the 600-second limit in the scope digest. A separately requested fresh runtime approval must bind this exact new digest and the reviewed commit. All resource, privilege, one-hour runtime and cleanup limits below remain unchanged.

Historical attempt001/002 proposals and their 60-second policies/digests remain unchanged, preserving their original copied cleanup sources. No legacy digest is accepted by the version 2 attempt003 launch path.

## Exact proposed scope

Only these five identities differ from attempt002:

| Identity                                  | Attempt003 value                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Private runtime root                      | `/home/anas/.local/share/nextera-judge/checkpoint-browser-20261029-attempt003/run-001`                 |
| Compose project                           | `01coding-checkpoint-browser-20261029-attempt003`                                                      |
| Co-resident product/Auth/Storage database | `foundation_test_checkpoint_browser_20261029_attempt003`                                               |
| Restricted web LOGIN role                 | `checkpoint_browser_web_20261029_attempt003`, inheriting only `nextera_web`                            |
| Two synthetic ordinary learners           | `checkpoint-a-20261029-attempt003@example.invalid`, `checkpoint-b-20261029-attempt003@example.invalid` |

The unchanged intended test scope is:

- Eight installed digest-pinned services: `db`, `auth`, `rest`, `storage`, `imgproxy`, `meta`, `studio`, `api-gw`. Gateway `127.0.0.1:56531`, database `127.0.0.1:56532`, application `127.0.0.1:3151`. Fresh project-owned mounts, volumes and network only; no service pulls, installations, public bindings or settings changes.
- Only registered SQL **0000-0010**, then draft SQL **0011** and **0014**, with all 13 exact source hashes verified. One synthetic cohort and the existing four-question 90-minute legacy fixture. No additional migration, curriculum publication or grading.
- Test-only limits: **1024 source bytes**, **64 save receipts per task**, **65536 stored source bytes per task**, **600 seconds after deadline** retention. Offline recovery remains disabled.
- At most **3600 seconds** from issuance; cleanup begins **180 seconds early**. The independent deadline/parent-loss guard must acknowledge before staging credentials/services. Both original wall and monotonic deadlines bind cleanup. No renewal; retain protected data, volumes and evidence on all outcomes.
- Fresh instance-local secrets and deadline-bound instance keys only after a separate exact runtime approval. Auth JWT lifetime remains **300 seconds**. The web app receives only its restricted connection and anonymous key; privileged credentials stay in the protected operator broker. Runtime root 0700, secret files 0600, only hash-verified public templates receive container-readable modes.
- Cleanup may authenticate/refresh only the same two existing synthetic test accounts inside the original window solely for global session revocation, then ban them, remove domain access, revoke web login and stop the identity-verified owned application/project. Report any unverified shutdown as failure; never delete protected evidence.
- No `publicRun`, official submission, Run worker, invitations/email, real-user access, broader role membership, mentor award, Raid action, production/default change, deployment or push. Both old attempts remain closed, stopped and untouched.

The purpose remains genuine ordinary-learner authenticated Checkpoint verification: browser save status, question switching, refresh recovery, explicit conflict handling preserving losing source; separate HTTP unauthenticated/cross-learner denial, exact source bytes, idempotency, concurrent CAS, stale-definition/size rejection, access revocation with valid session, durable revisions and zero official submissions/jobs/outcomes. Browser and HTTP evidence are separate. A 90-minute fixture cannot naturally expire within the one-hour stack; natural expiry is not claimed.

Current version 2 source plan SHA256: **`2ea73394604160d80746e9c50d499b25c361ec6c430195899dfb5e18b263dfd6`**.

The previous version 1 digest `fa9c9ff5dd44fd4627b8da3d06e76d548dc7748b94fc05c824602f74712342ad` is historical and invalid for a new launch. Its expired owner message remains permanently closed.

The source-only plan command reads the public registry without probing a runtime path:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/checkpoint-auth-live-adapter.py --plan --profile attempt003
```

The Python and Node parsers still require the exact registry key set and exact identity rows. Unknown profiles and arbitrary replacement targets fail closed. The CLI carries the explicit profile through execute/watch/cleanup; the independent copied guard retains that profile. Attempt001/002 scope digests remain unchanged. Snapshot-local source/SQL reads, mandatory adjacent source lock, public-template copy modes and runtime policy are unchanged.

## Preparation evidence

At **2026-10-29 11:48:22.692 UTC**, the public placeholder check passed using the original reviewed public templates at `/mnt/c/Users/lap/Documents/Codex/2026-10-24/task/verification/sunday-isolated-runtime-20261028/upstream`. Its only new fixture is repository-local `.tools/source-public-preflight-attempt003-20261029`, outside every runtime root. It rendered Compose with fixed fake placeholders and inspected installed DB image metadata; it did not start a service or execute SQL.

Receipt: `.tools/source-public-preflight-attempt003-20261029/receipt.json`. It verifies 25 public templates, eight exact image pins, all 13 SQL hashes, required DB init environment (`JWT_EXP`, `JWT_SECRET`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_USER`) and inherited user `supabase_admin`. Private fake-config files are 0600. It explicitly records no database-data directory, generated keys, approval or service creation/start.

Public source-lock SHA256 remains `6237cfe25a96a0be7cbd52308bdc2c0567a6687d18ec83b0e074bbf85dba12df`; upstream public template commit remains `bc27d2661edd09a5d0b8d76ce33da6d4071a756e`.

Historical version 1 verification: **64 Python injected tests and 28 Node injected tests**. New checks cover distinct attempt003 identities with all other policy fields unchanged; exact old digests; immutable owner binding; unchanged 60-second expiry; exact registry/target rejection; source-only CLI with no target-existence probe, adapter or owner creation; explicit copied-guard profile; and rejection of both closed profiles' mount strings using synthetic objects. These are fake tests, not operational evidence. No new full app build or authenticated integration is claimed.

## Ready workflow before any future approval request

The parent must finish independent source review, appropriate source checks, and the final reviewed source commit **before** asking for approval. Runtime source drift is deliberately rejected. Record that actual reviewed HEAD, the exact scope digest above and the unchanged source lock; preparation HEAD was `20b9c700654bc72fa1021da559a1e27e933cb7fc`. A new source change requires review/checks again.

Before an approval request, finish all permitted public source/image/configuration checks, current port/unused-project checks and supported-browser-context preparation. The parent owns browser access and must establish permitted transport/context without retrying a denied route or changing settings. The public check here proves configuration only; it does not prove the new origin will be reachable, target names available, DB startup repaired, authentication or saving. Do not ask until those independent preparation gates and the dispatch command are ready.

Prepare a single immediate local dispatch with every path/profile/flag already reviewed and only the **required trusted owner tuple** left to fill. Do not create an owner tuple or approval receipt during this preparation. When a genuinely new owner message arrives, preserve its exact message ID, actual UTC timestamp and approved scope SHA256 as immutable separate `OwnerApproval` input. Use `approval_receipt(owner, plan, receipt_created_at_epoch)` only for its matching private 0600 audit receipt. Receipt creation time may use the local clock for audit; it must never supply or replace owner approval time.

Dispatch promptly in the same prepared operation using `--execute --profile attempt003`, the matching `--approval-file`, fresh permitted `--browser-context`, reviewed `--template`, and all three mandatory `--owner-message-id`, `--owner-approved-at`, `--owner-scope-sha256` arguments. Do not improvise builds, review, template discovery or browser setup inside the approval window. Builds/staging occur only after the controller has validly reserved the fresh target under its original lease.

The version 2 attempt003 controller uses the **zero-through-600-second actual owner-age guard** before preflight and again immediately before reservation. Read-only preflight repeats current source/target/image/port/browser checks. A slow preflight, dispatch delay, expired/future evidence or wrong scope stops before reservation; the fake slow-preflight regression covers this boundary. This preparation does not guarantee future dispatch latency. If the actual window is missed, stop and report; do not regenerate an owner timestamp, reuse closed evidence, alter the reviewed guard or infer renewal. Cleanup remains available without fresh approval.

No new runtime grant is requested by this document. Remaining operational gates are final parent review/commit, current read-only availability/browser preparation, and a separately requested genuinely fresh exact owner approval. No attempt003 runtime directory/resources/keys may be created until then.

## Version 2 verification and remaining preflight

The current source change passed 73 Python injected tests and 28 Node injected tests. It covers admission after the old 60-second boundary, the exact 600-second boundary and one microsecond late, a future timestamp, regenerated expired receipts, old-scope rejection even at age zero, a slow preflight crossing 600 seconds, unchanged runtime duration, and rejection of both the closed attempt003 grant and the source-policy-only approval. These checks use fake adapters; they do not prove startup, authentication or browser saving.

No new runtime target, key, credential, owner receipt, lease or service was created by this change. The earlier public-template/source check and availability observation are historical, not current operational readiness. Before requesting fresh launch approval, recheck current source hygiene, images, ports, unused project/target and safely verified browser context using the permitted read-only preflight. Then dispatch with the authentic new owner tuple; repeat the age check after preflight. No deadline, runtime or privilege renewal is implied.
