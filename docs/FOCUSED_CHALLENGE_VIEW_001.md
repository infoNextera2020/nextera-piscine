# Focused challenge — integrated opt-in view

The approved source is Library `libfile_230b871b297881919db979b5339cad88`, version 1 editable ZIP, SHA256 `9463e3e7803653f59ad3af195ab348e4f157997846ea08cebbb0767125b234a9`. Desktop `libfile_fd68f8f716e88191bd247092904e16c2` and mobile `libfile_dfc0e6d2b4d481918f47097a86b15a1c` pixels were inspected locally and compared with the implemented view. The mockup's Shell exercise is illustrative, unpublished content. The actual view retains the published subject; it does not pretend the Go runner grades Shell.

## Integration

`/app/cohorts/[cohortId]/challenges/[nodeKey]?view=focused` selects this presentation only for ordinary challenges. The existing route still authorizes the cohort, reads the accessible published subject, obtains learner history and verifies `submissionContext` before rendering. A query parameter cannot grant intake or subject access. Project routes retain RaidPanel; checkpoints retain their editor route. All default views remain unchanged.

The existing `Challenge` controller owns both presentations. The focused branch passes its actual Subject, SubmissionForm, history, refresh control, access errors and history ref into `focused-challenge.tsx`. Upload rules, exact source bytes, request identity, polling cancellation and server-owned verdicts remain shared. The route supplies the existing server sign-out action; no account behavior is replaced with a fixture action in production.

Native disclosures contain checking guidance, exact rules, resources and sibling context. Authored hints/review content render only when supplied; no resource list, hint, review policy, XP or schedule is invented. `tab=resources` opens its disclosure. `tab=submissions` focuses/reveals history, including browser back/forward. A controlled-details toggle guard prevents feedback URLs being rewritten when React closes resources. Upload 401/403 immediately hides intake and history; a successful authorized history refresh is needed to restore intake.

## Visual boundary

The frame uses the supplied X01 SVG unchanged and has no visible wordmark in the header. Accessible branding remains “01 coding Piscine home”. Its true-black palette is scoped to this view. Desktop has lightweight top navigation and a quiet support column; mobile wraps the navigation and stacks task, submission, history and support. Home retains its sidebar; the heart's geometry and node positions are unchanged.

The screenshot reference has a short illustrative statement and a stylized chooser. Actual subject length and the existing accessible filename/upload/status controls are preserved, so this is not a pixel-identical copy of the mockup. No embedded editor is introduced for challenges or Raids.

## Verification

Twelve focused SSR/source tests cover actual subject/rules passthrough, history/error slots, role links, unavailable intake, authored-only disclosures, deep-link configuration and the unchanged default controller. The complete source suite passed 906 tests, typecheck, lint, formatting and production build before the final two CSS-only corrections; final validation is recorded in the companion UI report.

Chrome fixture checks at 1440/768/390/320 passed 25 assertions: real-controller layout, one main landmark/no sidebar or IDE, black background, loaded official mark, no horizontal page overflow, keyboard resources, resource/feedback URL and back behavior, exact upload bytes and idempotency on uncertain retries, repeated-click exclusion, pending receipt/history, revised-source identity, immediate access removal, explicit recheck, read-only intake and unchanged default challenge. Mocked transport was used only for these assertions. The fixture server otherwise rejects writes and uses no Auth, database or Runner. These are not authenticated route or actual evaluation tests.

Evidence lives in the selected executor's `verification/focused-challenge-v1/browser/` and `verification/ui-integration-20261028/`. The sample-only review URL is `http://127.0.0.1:3118/app/cohorts/ui-verification-cohort/challenges/hello-go?view=focused`. Real authenticated verification remains pending a separately approved environment; no credentials, database policy or curriculum publication changed in this slice.
