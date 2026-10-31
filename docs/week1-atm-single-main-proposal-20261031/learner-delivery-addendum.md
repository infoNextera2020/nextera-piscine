# Proposed learner delivery addendum

Source proposal only, to accompany the unchanged approved ATM brief if released. All task behavior, values, limits, stages and examples retain the original brief's status. No grading or publication is enabled here.

Submit one standalone Go file named `main.go` for the team's ATM program. Use `package main`. Include the supplied shared scanner declaration and the exact `ReadLine() (string, bool)` helper in this same file. Keep one scanner for the whole session. Merge necessary standard-library imports into one import list. Keep one ATM `main` function. Implement the ATM yourself; the supplied helper is input infrastructure.

Run the ATM locally with `go run main.go` once the facilitator has verified the target Go/compiler procedure. This command is the single-file packaging equivalent of the original proposed ATM command, not evidence that your ATM works or that the platform has a published CLI grader.

At the top of `main.go`, include a block comment headed `README`. State the local run command, the actual three assigned team members, the checks you actually performed, their observed results and any unresolved issue. This comment carries the short README requested by the brief inside the one uploaded artifact. Do not claim checks that you did not run, include real financial data, or place additional fake teammate identities in it. The README information is retained with the exact submitted source revision; it does not replace mentor verification.

Try the existing input-only demo separately, from its own `input-demo/` directory, using its existing `go run main.go input.go` command after compiler verification. The demo's `main` is not part of your ATM submission. Do not combine the two programs or upload the demo instead of your ATM.

All other requirements remain those in the learner brief. In particular: preserve input exactly until validating it; do not trim spaces, treat a blank line as EOF, or lose the PIN's leading zero. A false `ReadLine` result ends the session without applying a pending operation. Output wording remains flexible when the required outcome is clear. No fixed error phrases, output markers, hidden function signatures, grade, pass threshold, deadline or retry rule is introduced by this packaging addendum.
