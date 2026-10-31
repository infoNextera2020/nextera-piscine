# Week 1 ATM single-file source proposal

31 October 2026. Inactive engineering proposal; no curriculum publication, test pack, grader, score, PASS, upload, team mutation or runtime execution is performed here.

The already approved educational scope is retained: three learners, one invented account, mock PIN, integer balance, deposit, withdrawal and exit. The original baseline and its historical proposed-value/status labels stay byte-for-byte intact. This proposal resolves only source packaging and describes a comparison policy; it does not register its numbers or examples as platform policy.

## Delivery decision already resolved technically

The project submission is one standalone `main.go`. Put the supplied scanner declaration and `ReadLine` helper in the same file as the team's program, with one `package main`, one merged import list and one ATM `main` function. No new product layout, archive upload, companion-file intake or learner-visible grader interface is needed for this representation.

[The proposal scaffold](scaffold/main.go) contains the entire original 474-byte `scaffold/input.go` unchanged as a contiguous byte sequence, followed by a TODO-only ATM `main`. The scanner/helper region itself remains exact if a learner later adds an import such as `fmt`. This is a starter, not an ATM implementation. The combined file compiles with the installed Go 1.26.2 Windows toolchain, and the original helper test plus its five subtests pass against it with downloads disabled. The ATM main remains TODO-only and was never executed; no ATM business behavior is verified.

The local ATM command becomes `go run main.go`. Existing compiler/launch and published test-pack readiness still need their normal engineering verification before release. This proposal adds no CPU, memory, output, timeout, retry or storage default and changes no existing resources.

## What “README” means here

The exact learner submission wording is:

> Prepare the source file or files for the project platform's upload path and a short README explaining the proposed local run command, the team members and the checks you performed. Do not include real personal or financial data. Keep the input demonstration separate from the ATM submission.

The brief also says:

> Your README describes what you actually checked, including any unresolved issue.

There are two different roles. The package's own `README.md` and `scaffold/README.md` are instructional material. The team's short README is an explicitly requested deliverable containing the command, actual team members, actual checks and unresolved issues. The brief defines neither README points nor an automatic README pass gate.

The current project screen accepts one shared source file. It does not transport an extra README attachment. Preserve all requested team-README information inside a top-of-`main.go` block comment headed `README`, as shown in the scaffold. The brief does not mandate a separate `README.md` filename, so this representation does not waive the deliverable or require a new attachment feature. The comment is part of the exact uploaded source revision and source digest. It is not independently verified evidence that the declared checks occurred; mentor review still checks the same submitted attempt. Do not invent team identities, check results or a README score.

## Preserved supporting material

- [Approved learner brief](../../content/source-baselines/project1-atm-v1/learner-en.md): stages, roles, input rules, examples and business behavior remain unchanged.
- [Original input helper](../../content/source-baselines/project1-atm-v1/scaffold/input.go): exact source retained in the proposal scaffold.
- [Input-only demo](../../content/source-baselines/project1-atm-v1/input-demo/main.go) and [its helper](../../content/source-baselines/project1-atm-v1/input-demo/input.go): untouched separate local program. Its existing local command, from `input-demo/`, stays `go run main.go input.go`. Do not copy the demo's `main` into the ATM submission or upload the demo in place of the ATM.
- [Scaffold explanation](../../content/source-baselines/project1-atm-v1/scaffold/README.md) and [source map](../../content/source-baselines/project1-atm-v1/source-map.md): existing educational explanations and references retained. The ATM-specific old two-file command is superseded only by the [delivery addendum](learner-delivery-addendum.md); the demo command is not.
- Existing optional references remain [Scanner.Scan](https://pkg.go.dev/bufio#Scanner.Scan) and [ScanLines](https://pkg.go.dev/bufio#ScanLines). These are the existing baseline links, not newly assigned reading or a claim of a new web verification.
- The [pinned historical project](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/01-atm-banking-system.md) remains provenance, not a replacement for the approved beginner adaptation. No mentor-only archive or owner-review prose is copied into learner delivery.

## Observable behavior and remaining judgments

[The comparison proposal](comparison-policy.md) distinguishes fixed business/input facts from flexible prose. It preserves the brief's “Exact message wording is flexible, but the outcome must be clear.” It does not add magic output markers, required function names, a golden transcript or an implemented automatic grader.

No new owner decision is needed to package the same program and README information in one file. A separate README filename would require an explicit delivery amendment only if the owner later requests that additional constraint. Likewise, changing any business value, arbitrary-prose flexibility, required features, scores, deadlines or retry policy would be a substantive policy decision; none is changed or requested here. Existing publication/configuration decisions recorded in the baseline remain outstanding on their own track. Technical inability to infer arbitrary prose is an implementation gap, not a reason to silently restrict the task.

## Evidence

`verification.json` pins all eight retained baseline files, all four previously materialized Library source artifacts, archive-entry equality and this proposal's files. Verification consists of local byte/hash/ZIP/source checks, compilation of this exact combined starter and the original helper-only test with its five subtests. External downloads were disabled. No ATM program, business-behavior grader, SQL, Auth or service was executed. These checks establish source packaging and the input helper only; they do not establish a completed ATM solution or platform grading readiness. Prior baseline verification remains historical and unchanged.
