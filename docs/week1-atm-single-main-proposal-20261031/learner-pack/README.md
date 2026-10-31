# Beginner ATM learner pack — reporting handoff v1

Read [the complete assignment](learner-en.md), then implement your team's ATM in [main.go](main.go). The file already includes the exact provided `ReadLine` helper and supplied `Report(event string, balance *int)` helper. Its `main` is intentionally TODO-only. It is not a complete ATM solution.

Submit one `main.go`. Keep the top `README` comment and fill it with the actual three teammates, `go run main.go`, checks you actually performed and any unresolved issue. Do not submit a demo or claim unrun checks.

After compiler verification, run your ATM from this directory with `go run main.go`. Keep stdout for `Report` JSON records. For human messages, add `fmt` to the existing import list and use `fmt.Fprintln(os.Stderr, "Choose an option:")`. Human wording is flexible; machine event kinds/order/balances are explicit in the assignment. Every clean exit must emit `end` with nil before login or the committed balance after login, including EOF during an amount request.

The two demos are independent programs:

- From `input-demo/`, run `go run main.go input.go` to try the original input-only example. Its two original files are unchanged. It does not implement an ATM and is not the submission.
- From `report-demo/`, run `go run main.go` to see fixed reporting examples. Stdout contains only JSON observations; readable example messages go to stderr. This example reads no input and has no login, parser, menu loop or transaction implementation.

Both demos use invented sample data. Keep their main functions out of your ATM. The assignment's original business behavior and optional [Scanner.Scan](https://pkg.go.dev/bufio#Scanner.Scan)/[ScanLines](https://pkg.go.dev/bufio#ScanLines) resources remain intact.

This is an owner-approved source handoff, not a published live ATM grading pack. The current manifest contains only Hello Go/Even or Odd; no ATM grade, pass threshold, runtime or automatic PASS is created here.

The original input-only demo retains its original readable stdout output. The ATM Report stdout contract applies to your submitted ATM and the report demo, not to that separate unchanged input teaching example. Never submit either demo as the ATM.
