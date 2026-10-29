> CLOSED / HISTORICAL: attempt 002 staged with an incorrect regenerated approval timestamp and was stopped. Do not use either existing target, approval receipt or old launch instructions. See `docs/CHECKPOINT_AUTH_APPROVAL_CORRECTION_001.md`; no restart or attempt 003 is authorized.

# Authenticated Checkpoint rehearsal: fresh attempt proposal 002

Status: proposed only. No resources, keys, accounts or database have been created for this target. The closed source profile and fake tests are complete. A new exact action-time approval is required before execution. This does not renew the previous lease.

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

The closed source profile is now selected explicitly with `python3 scripts/checkpoint-auth-live-adapter.py --plan --profile attempt002`. Planning prints only public scope; it does not inspect a runtime lease, run Docker, create credentials or provision. The future execute, watch and cleanup paths all carry this exact profile; neither accepts an arbitrary replacement directory. The copied independent guard includes the same profile registry. Attempt 001 retains its original digest and can never satisfy attempt 002 approval. Obtain fresh action-time approval bound to the exact digest below and browser origin before using `--execute`; never reuse an old receipt or extend its deadline.

Attempt 002 scope SHA256: `a267f057515c96963d1c44ae2125f68b41521c822ec62fc7be48c36507724b72`. Source/SQL/image locks are recorded in `verification/checkpoint-auth-attempt002/source-lock.json`. A new source change must be reviewed and rechecked before runtime; these hashes are evidence, not authorization.

## Separate approved content decisions

Week 1 contains Q1–Q3, then the first exam and first project; Q4 begins week 2. The first project opens at its scheduled time after the exam, independently of exam submission or pass. Actual calendar timestamps remain undecided. These decisions do not modify the rehearsal fixture. The new first exam has eight approved question types (five coding, two trace with explanation, one debug fix); duration, weights, pass score and retry policy remain pending, and mixed-answer UI needs review before implementation.

Quest 3 learning content is approved, but its Library materialization is blocked: the supported transfer helper on Windows downloaded into its temporary staging path then failed because Python has no `os.setxattr`. No final identity-preserving file was installed. The one bounded retry is exhausted; no helper patch, raw transfer or content reconstruction was used. Approved source is `libfile_3998f89dcf1c8191bc8017067403c73b`, version 0. Incorporation remains pending a supported consumer-local transfer.

## Instance secrets and least privilege

The approved future stage would create fresh POSTGRES_PASSWORD, JWT_SECRET, PG_META_CRYPTO_KEY, DASHBOARD_PASSWORD, S3_PROTOCOL_ACCESS_KEY_SECRET, SECRET_KEY_BASE, REALTIME_DB_ENC_KEY, VAULT_ENC_KEY and S3_PROTOCOL_ACCESS_KEY_ID, plus deadline-bound ANON_KEY and SERVICE_ROLE_KEY. It would also generate the restricted web-role password and two learner passwords only for this new stack. The instance admin key remains in the protected operator broker; the web application receives only its restricted database connection and public anonymous key. No external AI, telemetry or SMTP credentials are used and no email is sent. No new secret has been generated during this preparation.

## Q3 supported transfer recovery proposal, not executed

The first Windows transfer reported `library file transfer failed: download failed` and installed no file. The one bounded retry downloaded bytes to the helper's temporary staging path, then failed in metadata application with `AttributeError: module 'os' has no attribute 'setxattr'`. The final ZIP is absent and the destination directory is empty. Temporary bytes were not adopted, extracted or imported; the helper and its identity requirements were not patched.

The documented resolved-reference route supports the unchanged Python materialization helper on a POSIX consumer. Proposed recovery: obtain a fresh transfer through `prepare_materialize`, then invoke the current unmodified helper and companion under WSL Python, with a new private native-ext4 destination inside the existing repository's ignored `.tools` area. Pass the full structured transfer object; require successful `user.library-file-id` and version xattr verification before opening the ZIP. This changes the consumer to one that supports required metadata, without touching denied database data or using a raw URL transfer. Because the earlier bounded retry is exhausted, this proposal is reported for approval before any further transfer. It has not been executed.

## Preparation verification

27 Python injected tests and 18 Node injected tests pass. They cover both closed profiles, unchanged attempt 001 digest, old-approval rejection before adapter calls, unchanged numeric policies, explicit guard profile propagation, new-only Compose configuration and rejection of retained mounts. Targeted ESLint, Prettier and diff checks pass. The tests do not start Docker, sockets, Auth, SQL or an executor. Full application build and browser integration were not rerun for this source-only harness change. The four original unrelated dirty files remain unchanged.
