# Thursday 29 October 2026 — bounded demo readiness

Scope: a manager demo, not production release approval. Source inspection and
component integration review performed 25 October 2026. No catalog, content,
credentials, schema, Judge or progression policy changed in this review.

## Working and demonstrated

- Functional Home is committed in `60677fc`: authorized next work, latest safe
  feedback/history, actual quest location and optional actual milestone; original
  Hairline drawings and accepted heart Journey/Challenge remain in use.
- The reviewed component flow is Home → heart Journey → Quest → Challenge → raw
  file intake → queued history. The review preview is explicitly a fixture:
  `http://localhost:3118/app?state=failed`. It is not an authenticated application
  or evidence of fresh Judge execution.
- A concrete feedback deep-link defect was reproduced: history received focus
  but remained below the mobile viewport. The fix reveals the existing history
  section immediately, retaining focus and clearing the sticky header, without
  changing upload/result/access semantics. Desktop, tablet and mobile browser
  regressions cover the destination.
- A separate **real isolated two-challenge** test passed on 25 October: actual
  sign-in, wrong raw file, real Runner failure, correct raw file, durable pass,
  trusted result application and persisted Hello Go mastery/Even or Odd unlock.
  Evidence: task `verification/live-slice/REAL_VERTICAL_SLICE_RESULT.md`;
  associated test-selector commit `3d6fc29`. This predates the new Home and is not
  an authenticated test of the current Home.
- That test was cleaned up: its identity, memberships and worker were disabled,
  four roles lost LOGIN, the one-hour token expired, and its app was stopped.
  Those credentials are not a reusable manager demo.

## What the actual catalog says

| Source                                                           | Verified fact                                                                                                                          | Consequence                                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `content/piscine-v1/manifest.yaml`                               | Development version `0.1.0`; one Foundations quest; Hello Go and Even or Odd; one `requires_pass` edge                                 | These are the committed source exercises, not a complete twelve-quest Piscine                                                       |
| `infra/runner/catalog/candidate.json`                            | `CANDIDATE`; six evaluation entries; all six `test_pack_artifact` values null; explicit publication blocker                            | Not an approved deployable evaluation catalog                                                                                       |
| `scripts/curriculum/tests/candidate.test.ts`                     | The candidate wrapper and unresolved artifact references are rejected                                                                  | Do not remove guards or manufacture registry URLs to obtain a demo                                                                  |
| `/home/anas/.local/share/nextera-judge/foundation006/artifacts/` | Six retained protected directories exist: two practice packs and four checkpoint task packs; existing `.tools/runner006` binary exists | Local test execution capability is distinct from production publication. Directory presence is not a fresh integrity/execution test |
| Approved heart-map reference / task visual fixtures              | Twelve quests, four checkpoints, three projects are illustrative design/source order                                                   | Do not present the visual fixture as published learner curriculum                                                                   |

No Quest 11 or Quest 12 definition was found in the current tracked content or
product documents. The earlier visual proposal marks their content pending
revision; neither a picture nor this review authors or approves their exercises.
The remaining full curriculum, including these two quests, needs authored briefs,
submission requirements, reviewed ordering/prerequisites and runnable evaluations
before it can become authoritative. It is not required to invent those records
for the already proven two-challenge isolated demo.

## Smallest decisions before Thursday's live rehearsal

1. **Choose the demonstrated content.** The smallest supported real path is the
   existing isolated Hello Go → Even or Odd slice. A full twelve-quest visual tour
   can be separately labeled as design/fixture review. A real complete twelve-quest
   demo needs content work beyond the current committed manifest.
2. **Choose a bounded authenticated demo access lifetime.** Fresh approval is
   needed for a new isolated test identity/roles and short-lived worker/source
   access, with an explicit expiry and disablement plan. Do not silently reactivate
   the cleaned test setup or reuse expired credentials. No production publication
   approval is needed merely to repeat the existing isolated test-only path.

After those choices, the supported rehearsal is ordinary existing local service
startup, approved isolated fixture setup, the real wrong → correct upload path,
Runner execution and **trusted** result application, then reload to verify durable
history/mastery/unlock in the current Home/Journey/Quest/Challenge. Keep the browser
and worker credentials separate; a learner cannot apply their own results. Run the
whole demonstration on the exact revision, preserve evidence, then disable test
access as agreed. Do not seed success or claim queued fixture receipts are passes.

## Current service boundary and existing endpoints

In this review, the fixture preview returned HTTP 200. The existing local Auth
health endpoint `http://127.0.0.1:54321/auth/v1/health` was unreachable. The WSL
listener inspection did not show the prior app port 3104 or isolated PostgreSQL
port 55439. No backend services were started and no signing values were read.
Check/start the already installed local services through the documented path before
another real test; do not infer their current health from the earlier successful run.

Existing application endpoints:

- `POST /api/submissions`: authorized raw artifact intake.
- `GET /api/submissions/history`: current authorized safe history.
- `POST /api/internal/results` and `POST /api/internal/results/reconcile`:
  trusted product application/reconciliation, separate from the learner and Runner.
- `POST /api/checkpoints` and `POST /api/checkpoints/submissions`: existing
  checkpoint lifecycle/task intake. Their existence is not proof that the full
  checkpoint/Raid demo has been rehearsed.
- `GET /api/health`: liveness; not a substitute for Auth/DB/Runner readiness.

Relevant runbooks: `docs/LOCAL_DEMO.md`, `infra/runner/README.md`,
`scripts/local-judge-fixture.ts`, `scripts/local-judge.ts`, and
`scripts/result-reconciliation.ts`. The persistent sample portal documented in
`LOCAL_DEMO.md` deliberately has no configured live evaluation pack and can leave
new uploads queued; it must not be sold as the real vertical-slice demonstration.

## Separate later release gates

Private registry references and retention/access controls, explicit catalog review,
full authored curriculum, production Auth/DB/Storage/roles, supervised maintenance
and reconciliation, deployment isolation, backups/rollback and exact-release full
verification remain release work. The historical RC001 report also records full
database/sandbox reliability failures; today's frontend checks do not resolve or
supersede them. See `docs/RELEASE_CANDIDATE_001_REPORT.md` as historical evidence,
not a current run. These gates are separate from approving a small local manager
demo and were not executed or changed here.
