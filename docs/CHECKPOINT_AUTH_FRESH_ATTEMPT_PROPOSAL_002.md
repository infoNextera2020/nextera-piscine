# Authenticated Checkpoint rehearsal: fresh attempt proposal 002

Status: proposed only. No resources, keys, accounts or database have been created for this target. A new exact action-time approval and a tested source profile are required before execution. This does not renew the previous lease.

## Closed attempt and retained evidence

The original attempt started on 29 October 2026 at 07:51:05 UTC, with a hard deadline of 08:51:05 UTC. Database initialization failed because copied public initialization templates were unreadable inside the container. Source repair `af834a34d43c458b979bc575f8f331fc41ca7184` gives verified public templates readable modes while preserving private secrets and database-data permissions.

Recovery stopped before restart: the OS denied renaming the protected failed database directory to its history destination. The rename did not execute. No retry, privileged workaround, protected-content read, data permission/ownership change or deletion followed. The old run stays untouched at `/home/anas/.local/share/nextera-judge/checkpoint-browser-20261028/run-001`; all eight containers are stopped and ports 56531, 56532 and 3151 are closed. No application migration, learner account or restricted web role was created. No authenticated HTTP or browser assertion ran. The sanitized stopped-state receipt is `verification/checkpoint-auth-live-20261029/closed-attempt.json`.

## Exact new scope to approve

- A distinct fresh private root `/home/anas/.local/share/nextera-judge/checkpoint-browser-20261029-attempt002/run-001`, Compose project `01coding-checkpoint-browser-20261029-attempt002` and database `foundation_test_checkpoint_browser_20261029_attempt002`. Fresh mounts, volumes and network only. Existing names fail closed. The failed run, containers, keys and data are retained; no read, move, adoption, deletion or permission change is needed there.
- The eight already installed pinned services: db, auth, rest, storage, imgproxy, meta, studio and api-gw. Gateway `127.0.0.1:56531`, database `127.0.0.1:56532`, application `127.0.0.1:3151`; verify the ports are free first. Existing sample preview on port 3118 is preserved. No installs, pulls, settings changes, public binding or other service.
- Fresh protected instance credentials, one web LOGIN role `checkpoint_browser_web_20261029_attempt002` inheriting only `nextera_web`, and exactly two synthetic ordinary learners `checkpoint-a-20261029-attempt002@example.invalid` and `checkpoint-b-20261029-attempt002@example.invalid`. No real people, invitation emails, broad grants or reused credentials. Secrets stay local, run root mode 0700 and secret files mode 0600.
- Apply only registered SQL 0000–0010, then draft SQL 0011 and 0014, verified by source hashes, to this new co-resident Auth/Storage/product database. One synthetic cohort and the existing four-question, 90-minute legacy test exam. No approved learner curriculum publication, grading, Run worker, Raid, review/XP award or later migration.
- Explicit test-only draft limits remain 1024 source bytes, 64 save receipts per task, 65536 stored source bytes per task and 600 seconds post-deadline retention. Offline local recovery is disabled. These are rehearsal limits, not approved production defaults.
- Maximum one hour from issuance with cleanup beginning three minutes early. No renewal. Independent deadline and parent-loss guard must acknowledge before keys or services. Instance keys expire at the original new deadline; Auth JWTs last five minutes. Cleanup may authenticate or refresh only these two existing synthetic accounts within that same window solely to globally revoke their sessions, then ban them, remove domain access and revoke the restricted web login.
- On success, failure, parent loss or expiry: stop only this new owned application and project, verify no scoped session or listener remains, and retain all new protected data, volumes and evidence without permanent deletion. Failure to verify cleanup is reported as failure.

## Assertions and prerequisites

First verify a permitted supported browser context and fresh source/image/configuration preflight. No retry of a denied route, security-setting change or alternative route around a restriction is included. Browser transport availability is still a prerequisite, not a pass.

With genuine ordinary learner authentication: save status, question switching without source loss, refresh recovery and explicit conflict handling preserving the losing source. Separately verify HTTP unauthenticated/cross-learner denial, exact source-byte round trips, idempotency, concurrent compare-and-swap, stale definition, size rejection, access removal with a valid session, durable revisions and zero official submissions/jobs/outcomes. Record browser and HTTP evidence separately. A 90-minute exam cannot naturally expire inside a one-hour environment; natural deadline crossing is excluded, with existing SQL/injected expiry checks cited separately.

Before execution, implement and fake-test a closed source profile for these exact new names and fresh mounts, verify its scope digest, permissions and cleanup receipts, and obtain fresh action-time approval bound to that digest and browser origin. The current CLI is deliberately pinned to attempt 001 and must not be pointed at a replacement directory or bypassed. Do not reuse an old approval receipt or extend its deadline.

## Separate approved content decisions

Week 1 contains Q1–Q3, then the first exam and first project; Q4 begins week 2. The first project opens at its scheduled time after the exam, independently of exam submission or pass. Actual calendar timestamps remain undecided. These decisions do not modify the rehearsal fixture. The new first exam has eight approved question types (five coding, two trace with explanation, one debug fix); duration, weights, pass score and retry policy remain pending, and mixed-answer UI needs review before implementation.

Quest 3 learning content is approved, but its Library materialization is blocked: the supported transfer helper on Windows downloaded into its temporary staging path then failed because Python has no `os.setxattr`. No final identity-preserving file was installed. The one bounded retry is exhausted; no helper patch, raw transfer or content reconstruction was used. Approved source is `libfile_3998f89dcf1c8191bc8017067403c73b`, version 0. Incorporation remains pending a supported consumer-local transfer.
