# Checkpoint editor UI integration — source verification

This slice implements the approved Checkpoint-only internal editor presentation. It does not enable autosave or visible-example execution. Home B, full-heart Journey, Challenge and Raid external-editor upload flows remain unchanged.

## Implemented

- Actual controlled plain-text code editor; no new dependency, AI completion, anti-paste rule or proctoring claim.
- Question count, titles, statements, filenames, submission counts, eligibility, results and destinations come from the existing Checkpoint read. Any question can be selected without passing another.
- Independent in-memory draft per question, scoped to the current attempt. Navigation preserves drafts. Access removal unmounts the protected editor; an attempt change creates a fresh session.
- Official Submit uses the existing authenticated raw-source endpoint. A fixed source string, filename, question, attempt and idempotency identity are captured before sending. UTF-8 bytes, BOM and line endings are preserved. Later edits do not alter that submission.
- An unconfirmed receipt retains the exact original snapshot for an explicit retry. Retry does not send later edits. Only a valid accepted receipt is shown as accepted; queued work is never presented as a pass.
- Existing server polling, visible-page refresh, start/retake/replacement controls, trusted-time countdown, history and authoritative result links are retained. Failed reads pause actions; access denial hides protected content.
- Finish review lists current server task states and warns about unsent drafts or uncertain submissions. No automatic submission at expiry.
- Responsive CSS uses the approved black/white/emerald tokens and existing Hairline Create icons. Mobile question identity remains visible; Statement, Editor and History can be selected independently.

## Explicit unavailable capabilities

Production draft and Run backends remain null. The UI says “Not saved to server” and “Run unavailable”; it never simulates successful saving or execution. Run is disabled with an explanatory output panel. Official submissions remain real endpoint calls and require the existing local environment and authorized account.

Drafts are page memory only. There is no localStorage/sessionStorage source retention, reload recovery, offline resynchronization, conflict resolution or claimed autosave in this slice. A before-unload warning supplements explicit loss messaging; it does not guarantee recovery or block every client-side navigation. Existing retry-intent browser storage contains an ID and digest-based identity only, never raw source. Approved durable autosave/offline behavior is still an integration gate, not a completed feature.

The Checkpoint presentation currently lacks a server-attested editor definition identity and enabled capability description. This slice does not manufacture a definition digest or weaken the existing submission route to bridge that gap. Live persistence needs a separately approved adapter/migration readiness step; Run needs verified public examples, configured separate resource policy, durable storage and isolated executor readiness. Exact Run numerical limits, local retention and cross-device conflict settings remain pending.

## Policy and verification boundaries

The obsolete fixed sample counts, repeated duration and fixed pass-threshold hero have been removed from this UI. Existing server rules were not changed; per-exam configurable thresholds remain a separate publication gate. No new quota or pass rule was introduced.

Source regression tests cover immutable source bytes, uncertain acknowledgements, idempotency continuity, access denial, edits during evaluation, distinct question buffers, dynamic question counts, lifecycle presentation and truthful unavailable states. Static rendered HTML checks are not interactive browser testing or pixel-fidelity verification.

No preview/service was started, no database connected, no migration executed, no credentials created and no live authenticated Checkpoint test was run. Browser interaction, layout overflow, keyboard focus, dialog behavior and visual comparison remain unrun pending a bounded fixture-preview approval. The previously completed Home/Journey preview remains closed.

## Next smallest approvals

1. Execute the prepared SQL0012 suite only in the disposable private-socket cluster described in VISIBLE_RUN_SQL_REHEARSAL_PLAN_001.md; old SQL0011 permission does not cover it.
2. Separately, if desired, start a localhost-only in-memory fixture preview for Checkpoint desktop/mobile, keyboard and dialog QA. No Auth, DB or Runner is needed for that UI review. No listener is started by this report.

Neither approval enables retained database migrations, persistent access, real credentials, hidden-test execution, deployment or publication.

## Completed source checks

All 615 tests in 44 files passed. Typecheck, lint, formatting and production build passed. The full suite initially caught a quota-full task label regression; the implementation was corrected while keeping the existing regression test unchanged. SQL0012 execution, interactive browser QA and authenticated editor integration remain not run.
