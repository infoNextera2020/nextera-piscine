# Provided input bridge — draft v1

This small adapter is supplied infrastructure, not an ATM solution. It uses only Go's standard library. Learners need to understand its contract; implementing scanners, streams or an error framework is not this project's learning goal.

`ReadLine()` returns two values: the text and a boolean `ok` (true/false). With `line, ok := ReadLine()`, think “what was read?” and “is there a line to process?”. A boolean can be checked in an `if` just like a comparison. The demo shows the whole call-and-stop pattern, not banking logic.

- `"", true` is a blank line. The ATM should validate it as an input, not treat it as EOF.
- `"", false` means no further usable input: end the session, without changing the balance or consuming a PIN attempt. Do not loop asking again.
- End-of-input and a reading error both end this teaching session. Diagnosing separate error kinds is deferred. No claim that every false is EOF.
- Line endings LF/CRLF are removed, but leading/trailing spaces are not trimmed. A final line without a newline is still returned once.
- One scanner is shared for the session: do not construct a new scanner at every prompt.
- The standard scanner has a bounded token size. Excessively long lines can stop input instead of producing an ordinary invalid-amount response. Proposed assessed lines have at most 20 characters; oversized-stream resilience is not a learner requirement.

## Try the separate input-only demo

With a validated Go compiler, from `input-demo/` run `go run main.go input.go`. Type `hello`, then try a blank line and ` hello `. Predict what appears between quotes. The `%q` display is only a demo aid to reveal spaces; learners are not asked to implement it. EOF before a line should show the ending message once. Terminal EOF keys depend on the operating system; the facilitator can supply an empty input stream rather than require new shell-redirection skills.

For the ATM, copy only `scaffold/input.go` into the project folder beside your own `main.go`; do not copy the demo's main function. Both use `package main`, unlike the earlier function-only exercises. A proposed multi-file run is `go run main.go input.go` (include any additional source files explicitly). The facilitator must confirm the compiler and launch procedure first. This pack has not been compiled in its authoring environment.

Before building banking behavior, explain: why is a blank line different from no line? What should happen if input ends while an amount is requested?

Optional official reference, verified 29 October 2026: read only [Scanner.Scan](https://pkg.go.dev/bufio#Scanner.Scan) and [ScanLines](https://pkg.go.dev/bufio#ScanLines). The first describes when reading stops; the second explains line-ending removal. The full package documentation is not assigned reading.
