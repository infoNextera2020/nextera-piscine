# Quest 2 First programs and gentle loops in standard Go

Draft v3 — the five approved loop tasks are retained. The two newly authored foundation tasks and the detailed contracts are proposals for review before import. This active module uses Go and its standard library only. It is not a deployed grading pack.

## Your goal

Run a small program, distinguish printing from returning a value, test a condition, and reason through progressively larger loops. Start with a single loop, add selection and accumulation, then move to rows/columns and ordered pairs. No recursion, character-code arithmetic, integer-formatting implementation or third-party dependency is required.

## Setup and safe practice

Work in a new folder you own, separate from personal files. Your facilitator confirms Go and a text editor are available and supplies a working module scaffold. No administrator commands, credentials, remote publishing, downloaded libraries or deletion are needed. Check your folder before editing. Submit only the enabled task's requested source file through upload; a Git commit is not a submission.

Go source files end in `.go`. A complete program uses `package main` and an entry function `main`. An `import` makes another package available; `fmt` is part of the standard library supplied with Go. Add an import when you use that package: an unused import causes a compile error.

In the provided program folder, `go run .` compiles and runs the main package. `go build` creates an executable instead; your facilitator shows how to launch it on your operating system. A folder containing only a library package cannot be run as a main program.

Use this empty program shape, then add your own work. It contains no exercise solution:

```go
package main

func main() {
    // Your work goes here.
}
```

Your facilitator demonstrates one unrelated use of fmt before the first task. Compare printing with and without a newline. Temporarily misspell a name, read the error and restore it; do not change system settings to fix a spelling mistake. Share the exact error and relevant line when asking for help.

## Proposed task and submission contract

These filenames, signatures, bounds and output choices are detailed proposals. The facilitator must confirm them and the engineer must validate the wrapper before assessment. The standard library is available; no arbitrary package allowlist is imposed. Where a task asks you to practise iteration, a ready-made repeated string, hardcoded output or closed-form formula does not demonstrate that learning goal. How that goal is evaluated remains a review decision, not an implemented restriction scanner.

| Activity | Type | Proposed file |
|---|---|---|
| F1 Greeting card | Complete program, package main | main.go |
| F2 Sign label | Function, package piscine | signlabel.go |
| L1 Count up and down | Two variations in one function task | counting.go |
| L2 Even range | Function | printevens.go |
| L3 Sum to N | Function returning a value | sumto.go |
| L4 Star rectangle | Function | printrectangle.go |
| L5 Ordered pairs | Function | printorderedpairs.go |

Keep each task in its own prepared folder. Do not mix main and piscine packages in one folder. For a function task the proposed layout is:

```text
function-task/
  go.mod                  provided module setup
  piscine/signlabel.go    your function; filename changes by task
  cmd/check/main.go       provided caller, not your submission
```

For example, a module named `example/q2-practice` lets the caller import `example/q2-practice/piscine`. From the root, `go run ./cmd/check` runs the caller. It invokes your function with the displayed cases; for a returning function it uses fmt to display the returned value. It does not implement the function for you. The engineer must verify this scaffold before distribution. There is no external module to fetch and no third-party dependency setup.

Function file shape:

```go
package piscine

// Add the task's function declaration and your implementation here.
```

No terminal-input parsing is required: the provided caller supplies arguments. Do not upload the caller, module configuration or a whole project unless the actual enabled task explicitly requests them. This text is not evidence that the current upload runner supports both program and function submissions.

## F1 Greeting card

**Newly authored foundation task. One focus:** a complete program and exact text output.

Create a program that prints these two lines, with a newline after each and no blank line:

```text
Hello, Go learner!
I can run a program.
```

**Input:** none. **Proposed upload:** main.go. Use standard-library formatting; no loop is required yet. This task is not about printing an alphabet, digit range or character codes.

**Checks:** save and run from the correct folder. Temporarily change the second message, observe it, then restore the required text. Distinguish a file you edited from an executable built earlier. Compare spaces, punctuation and line breaks.

**Hint:** find the difference between fmt.Print and fmt.Println. Add the fmt import only when you call it.

**Review question:** “What starts your program, and why might changing a source file not change an executable you built earlier?”

## F2 Sign label

**Newly authored foundation task. One focus:** a three-way condition returning a value, not printing it.

Proposed function in signlabel.go, package piscine:

```go
func SignLabel(n int) string {
    // Add your implementation; this comment is not a complete returning body.
}
```

Return `negative` when n is below zero, `zero` when n equals zero, and `positive` when n is above zero. Do not print inside the function. The provided caller displays the returned value.

**Proposed bounds:** -100 ≤ n ≤ 100. Inputs outside this domain are excluded from this beginner contract; no validation message is requested.

**Examples:** SignLabel(-4) returns `negative`; SignLabel(0) returns `zero`; SignLabel(7) returns `positive`.

**Checks:** predict all three cases before running. Add a second negative and positive example. Explain which code chooses the label and which code displays it.

**Hint:** identify the mutually exclusive possibilities before writing the branches. A return value is not automatically terminal output.

**Review question:** “Why does your function have a separate zero case, and what would a caller receive if you only printed a word instead of returning it?”

## Five approved gentle-loop tasks

Before L1, try a tiny unscored loop experiment: predict its starting value, condition and update, then change one boundary. Learn how to interrupt an accidentally non-terminating run. Before L2 the facilitator introduces integer remainder. These short introductions do not replace the five tasks.

The progression below is approved. Its exact signatures, bounds, filenames and formatting remain proposed contracts. Use the function/caller arrangement above and separate folders. fmt.Print, fmt.Println and fmt.Printf are permitted wherever output is required; SumTo returns and its caller prints. Integer formatting is not a hidden prerequisite.

Each printed line ends with one newline, with no extra blank line. No output means zero characters, not an empty line or error text. Out-of-domain inputs are excluded rather than assigned invented error behavior. No automatic tests, scores or time limits are implemented by this document.

### L1 Count up then count down

**One concept:** loop start, stopping condition and direction. Countdown is a deliberate variation of the same task, not unrelated busywork.

**Proposed submission:** `counting.go`, package piscine, implementing both signatures:

```go
func CountUp(n int) {}
func CountDown(n int) {}
```

For CountUp, print each integer from 1 through n on its own line. For CountDown, print n down through 1 on separate lines. The runner calls them separately; neither function adds a heading or separator.

**Bounds:** -20 ≤ n ≤ 20. When n ≤ 0, print nothing in either variant.

**Examples:** CountUp(3) produces the three lines `1`, `2`, `3`. CountDown(3) produces `3`, `2`, `1`. Each variant with n=1 prints just `1`; n=0 and n=-2 produce no output.

**Checks:** test 1, 3, 0 and a negative value. Predict the first and last printed values before running. Do not hardcode the example output.

**Hint:** trace the loop's condition before its first iteration as well as after its final iteration. Only change the necessary parts when moving from count up to count down.

**Review question:** “Why does your loop run zero times for n=0, and what must change to reverse its direction?”

### L2 Print even values in a range

**One new concept:** select some loop values with a condition.

**Proposed submission:** `printevens.go`, package piscine:

```go
func PrintEvens(low, high int) {}
```

Print every even integer from low through high, inclusive, in ascending order, one per line. A value is even when its remainder on division by 2 is zero. The facilitator introduces the remainder operator before this task; it is not an unexplained prerequisite.

**Bounds:** both inputs are between -20 and 20. If low > high, print nothing; do not silently swap them. Zero is even. Negative even values are included.

**Examples:** PrintEvens(-3, 3) produces lines `-2`, `0`, `2`. PrintEvens(2, 2) prints `2`. PrintEvens(3, 3) and PrintEvens(4, 1) produce no output.

**Checks:** cover a range crossing zero, an equal-bound even case, an equal-bound odd case and reversed bounds.

**Hint:** separate “which values do I visit?” from “which visited values do I print?” Start with a small range and mark your selected values on paper.

**Review question:** “What changes when your range contains zero or a negative number, and why should reversed bounds not print anything?”

### L3 Add the numbers from 1 to N

**One new concept:** an accumulator whose value survives from one iteration to the next.

**Proposed submission:** `sumto.go`, package piscine:

```go
func SumTo(n int) int {
    // Write your implementation; this comment alone is not a complete body.
}
```

Return the sum of integers 1 through n using iteration. Do not print inside this function. The provided runner displays the result. A direct arithmetic formula is outside this proposed learning task; we are practising accumulation, not testing whether you know a shortcut.

**Bounds:** -100 ≤ n ≤ 100. For n ≤ 0, return 0. These bounds keep the exercise away from integer overflow.

**Examples:** SumTo(4) returns 10; SumTo(1) returns 1; SumTo(0) and SumTo(-3) return 0.

**Checks:** show the accumulator after each iteration for n=4. Explain what gets initialized once and what changes repeatedly. Check a second positive input instead of memorizing 10.

**Hint:** draw a two-column trace: current number, running total. A variable repeatedly reset inside the loop cannot remember the previous total.

**Review question:** “Where is your total initialized, and what would happen if you moved that initialization inside the loop?”

### L4 Draw a star rectangle

**One new concept:** nested loops with independent row and column counts.

**Proposed submission:** `printrectangle.go`, package piscine:

```go
func PrintRectangle(rows, columns int) {}
```

Print rows lines, each containing exactly columns asterisks. Use nested iteration, no spaces, and one newline after each completed row. Do not use a repeat helper or a prewritten rectangle string for this learning task.

**Bounds:** -5 ≤ rows, columns ≤ 5. If either dimension is zero or negative, print nothing.

**Example:** PrintRectangle(2, 3) prints:

```text
***
***
```

PrintRectangle(1, 1) prints one star followed by a newline. PrintRectangle(0, 3), PrintRectangle(2, 0) and PrintRectangle(-1, 2) produce no output.

**Checks:** use a non-square rectangle so swapped dimensions are visible. Test one row, one column and a non-positive dimension. Count stars per line and line count independently.

**Hint:** decide which loop represents a row and which represents a position within that row. Then decide when a row has actually finished.

**Review question:** “Why does the newline belong at a different point from printing a star?”

### L5 Print ordered pairs

**One new concept:** a relationship between two positions in nested iteration.

**Proposed submission:** `printorderedpairs.go`, package piscine:

```go
func PrintOrderedPairs(n int) {}
```

Print all integer pairs (a, b) satisfying 0 ≤ a < b ≤ n, ordered by ascending a and then ascending b. Print each pair as `a b` on its own line: exactly one space between the numbers, no padding or commas. Use fmt for integer formatting; you are practising pair generation, not number-to-text algorithms.

**Bounds:** -9 ≤ n ≤ 9. For n ≤ 0, there are no valid pairs, so print nothing.

**Example:** PrintOrderedPairs(2) prints:

```text
0 1
0 2
1 2
```

PrintOrderedPairs(1) prints `0 1` and a newline. PrintOrderedPairs(0) and PrintOrderedPairs(-1) produce no output.

**Checks:** explain why equal pairs and reverse-order pairs are excluded. Test n=1, 2 and 3. Check the set of pairs separately from their output ordering. Do not add a third loop yet.

**Hint:** distinguish the allowed range of each value from the relationship between them. Either filtering candidates or avoiding invalid candidates can demonstrate the intended reasoning; explain your choice.

**Review question:** “How does your code guarantee a < b and avoid printing the same pair twice?”

## Review and evidence

For each enabled task, upload its requested source file, not a screenshot. If actual upload instructions and this proposed wrapper disagree, ask before changing packages. Keep a short note of a failed attempt, expected output, actual output and correction.

Explain your own code, trace a small input and make one controlled variation. A peer asks a question or gives a small hint rather than supplying the implementation. Five activity-appropriate questions are intended to be sampled under the agreed product design. The companion bank contains draft examples, not an operational sampling service or pass threshold.

Content availability follows its schedule, independent of previous approval. Peer assignment is intended to be automatic and nonreciprocal, mentor assignment automatic, and mastery/XP subject to mentor approval. This content document does not verify those mechanisms or invent points, retry counts or review times.

There is no additional triple-combination, recursion or integer-boundary task in this active module. End with explaining how L5 relates to the nested loops in L4. A future challenge should be proposed separately when it serves a clear learning goal.

## Short optional resources

- [Go first-program tutorial](https://go.dev/doc/tutorial/getting-started): only the first-program section, with facilitator help. Use the supplied folder; skip its external-package section. The tutorial assumes some programming experience, so it is a reference alongside this gentler bridge.
- [fmt Println](https://pkg.go.dev/fmt#Println): compare Print and Println for newline behavior.
- [Go for statement reference](https://go.dev/ref/spec#For_statements): facilitator reference for a specific question, not a required full-spec reading assignment.

Official pages inspected on 28 October 2026. No external package or account is required. No exercise solutions are included.
