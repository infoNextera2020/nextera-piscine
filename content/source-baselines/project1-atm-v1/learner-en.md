# Beginner ATM team project

Draft v1 — 29 October 2026

Build a small terminal program that simulates one account using invented data. Work in a team of three. Your program lets a person log in with a mock PIN, view a balance, deposit whole units, withdraw whole units and exit.

This is a learning exercise, not banking software. Never enter a real PIN, account number, card number or other financial information.

**Review status:** The reduced feature scope and team size are approved. The exact values, input rules, examples and suggested commands below are proposals for owner and engineering review before learner release. They are not a published assessment policy.

The supporting Go files have not yet been compiled in this authoring environment. Engineering must verify them before learner release.

## Where this project fits

This project comes after Q1, Q2 and Q3, with Exam 1 before the project on the timetable. The project opens at its scheduled time whether or not you have submitted or passed Exam 1.

You will reuse shell and Git basics from Q1; ordinary Go variables, conditions, loops and functions from Q2; and the small text parsing, rune, pointer and slice activities from Q3. You do not have to use every topic. Maps, structs and concurrency are not required.

By the end, you should be able to separate reading input from changing state, check a whole input line before using it, connect small functions into a running program and explain another teammate's changes.

## What to build

Use standard Go in a standalone program with `package main`. Keep one balance in memory for the current run. Begin with the proposed starting balance each time the program starts.

Required features are:

- A login prompt for the mock PIN.
- A menu that remains available after a completed operation.
- Showing the current balance without changing it.
- Depositing a valid amount when the resulting balance is within the limit.
- Withdrawing a valid amount when enough units are available.
- Exiting when requested or when input ends.

Do not add transfers, PIN changes, multiple accounts, files, a database or network services. There is no saving between runs. The repeated menu is a loop, not disk persistence.

## Proposed values and input contract

Use invented whole units, not a real currency. Use integers, not floating point values.

| Item | Proposed rule |
| --- | --- |
| Mock PIN | The exact four-character string `0427` |
| Starting balance | `100` units |
| Balance range | `0` through `10000`, inclusive |
| Deposit or withdrawal amount | `1` through `1000`, inclusive |
| Failed login limit | End the program after three wrong PIN attempts |
| Menu | `1` show balance, `2` deposit, `3` withdraw, `4` exit |

These concrete values are review proposals, not approved platform settings.

### Reading one line

You will receive a small input helper with this interface:

```go
ReadLine() (string, bool)
```

The first result is one line of text. The second result says whether a line was read. The helper removes the line ending, including a CRLF line ending, but preserves other whitespace. It can return a final line even if that line has no trailing newline.

- When the second result is `true`, validate the returned text.
- When it is `false`, end the program cleanly. It means input ended or the helper could not continue reading. Do not retry forever.
- A blank line is input: it returns an empty string with `true`. It is malformed input, not end of input.

At any prompt, a `false` result ends the program without applying a pending operation. Earlier successful operations remain part of the current run; do not reset the balance on exit. Do not implement a general input error framework for this project.

For this proposed assessment, input lines are at most 20 characters long. Amount lines of six through 20 characters are still invalid. Handling arbitrarily long lines is outside the learner task; input beyond the helper's scanner capacity can stop reading instead of reaching your validator.

### Logging in

Treat the PIN as text so its leading zero is not lost. Only `0427` succeeds. A wrong value or malformed line counts as one failed attempt, including a blank line, a line with spaces, a short line or a non-digit line. After the third failure, exit without opening the menu. If input ends, exit immediately instead of counting another failure or asking again.

### Choosing a menu option

For this proposed version, accept only the exact menu strings `1`, `2`, `3` and `4`. A blank line, `01`, a space-padded choice or any other text is invalid. Explain that the choice is invalid, leave the balance unchanged and show the menu again.

### Reading an amount

Write a small bounded parser for the amount line. Validate the entire line before accepting it:

1. It must contain between one and five characters.
2. Every character must be an ASCII digit from `0` to `9`.
3. Convert the accepted digits to an integer.
4. Check the transaction range and the chosen operation's balance rule before changing the balance.

Leading zeros are allowed within the five-character limit. For example, `00025` means `25`. Reject spaces, signs, decimal points, letters and non-ASCII digits. Do not trim input, accept a numeric prefix or convert a malformed line into zero.

Passing the text parser does not mean the transaction is allowed. `0` and `10000` are digit-only inputs, but neither is an allowed transaction amount. Likewise, a permitted amount may still fail because funds are insufficient or the deposit would exceed the balance limit.

If an amount is invalid or the transaction is not allowed, give a short explanation and return to the menu. Leave the balance exactly as it was before that operation. Reject an over-limit deposit; do not reduce it to the available space. Never allow a withdrawal to produce a negative balance.

## Build in small stages

These stages are a working path, not separate scored submissions.

### Stage 1 Try the supplied input demonstration

Run the small input demonstration separately from the ATM. Try an ordinary line, a blank line and the end of input. Notice the difference between empty text and no line.

The demonstration and the ATM are separate programs. Do not place both of their `main` functions in the same program. The supplied helper belongs beside the program that uses it; your mentor or engineer will confirm the final folder layout and run command.

### Stage 2 Model a balance with small functions

Choose a clear way to represent the single balance as an integer. On paper, describe what each operation receives, what it checks and what it can change. Keep parsing and transaction rules understandable as separate steps.

Try a few direct examples before adding terminal input. You may use ordinary arguments and return values or a simple pointer where it helps you explain the state change. A pointer is not required merely because Q3 introduced one.

### Stage 3 Complete one operation

Connect reading an amount, checking its text, checking its range and changing the balance for one operation. Check both a success and a rejection. Then add the other operation. Do not change the balance before all checks have succeeded.

### Stage 4 Add the menu loop

Connect the four menu options. Return to the menu after showing the balance and after either a successful or rejected transaction. Check that an invalid choice does not change state or end the program unexpectedly.

### Stage 5 Add login

Place the PIN prompt before the menu. Check the successful path, three failures and input ending at the prompt. Keep PIN checking separate from amount conversion.

### Stage 6 Integrate and demonstrate

Combine the team's work into one runnable ATM program. Repeat the checks below against the combined version, not just each person's individual function. Each teammate should be able to trace a full journey from input to validation to the resulting state.

## Work as one team of three

Rotate these roles during the stages:

- **Driver:** makes the current small change and describes it to the others.
- **Reviewer:** checks the conditions, names and state changes and asks questions.
- **Tester and navigator:** tries examples, records results and keeps the next integration step clear.

All three share integration and Git responsibility. Do not permanently assign login to one person, transactions to another and testing to the third. Review changes together and make small, understandable commits. Everyone must be ready to explain any program flow, including a part they did not originally type.

## Examples to check

These are proposed acceptance examples, not an exhaustive hidden test suite. Each row starts from its stated balance; login has already succeeded unless the row says otherwise. Exact message wording is flexible, but the outcome must be clear.

| Starting point | Input or action | Expected result |
| --- | --- | --- |
| Login | `0427` | The menu opens |
| Login | Wrong line, blank line, wrong line | Three failed attempts; program ends without the menu |
| Login | `427` or ` 0427` | Failed attempt; neither is the exact mock PIN |
| Balance `100` | Choose `1` | Show `100`; balance remains `100` |
| Balance `100` | Deposit `25` | Balance becomes `125` |
| Balance `100` | Deposit `00025` | Balance becomes `125` |
| Balance `100` | Withdraw `100` | Balance becomes `0` |
| Balance `100` | Withdraw `101` | Reject; balance remains `100` |
| Balance `9500` | Deposit `500` | Balance becomes `10000` |
| Balance `9500` | Deposit `501` | Reject the whole deposit; balance remains `9500` |
| Balance `100` | Deposit `0` or `1001` | Reject; balance remains `100` |
| Balance `100` | Amount `-1`, `+1`, `1.5`, ` 25`, `25 `, `25x`, blank or `٢٥` | Reject; balance remains `100` |
| Balance `100` | Amount `000001` | Reject six characters even though the value would be small |
| Balance `100` | Menu choice `01` or `9` | Explain invalid choice; return to menu unchanged |
| Balance `100` | Choose deposit, then input ends | Exit; no deposit occurs and balance stays `100` |
| Any current balance | Choose `4` or input ends at the menu | Exit without changing the current balance |

To check the near-limit cases through the interface, build the needed balance with several permitted deposits. You can also test operation functions directly if your team can explain the setup.

One short journey to try is: correct PIN, show `100`, deposit `25`, withdraw `40`, show `85`, exit. Also try a rejected transaction between successful ones to confirm that the rejection does not erase earlier work.

## What to hand in

Prepare the source file or files for the project platform's upload path and a short README explaining the proposed local run command, the team members and the checks you performed. Do not include real personal or financial data. Keep the input demonstration separate from the ATM submission.

The exact upload packaging and runner integration still need engineering confirmation. This brief does not claim that the platform has a working interactive CLI runner. If a runner is unavailable, demonstrate the uploaded version locally to the mentor. The reviewed version must be identifiable as the same attempt that was submitted; do not replace it with an untracked local variant during the review.

There are no scores, deadlines, pass thresholds or retry rules defined by this draft. The intended review is a mentor checking the exact submitted attempt and asking questions about its behavior. The mentor approval flow is product intent, not a claim that the platform already implements it.

## Before asking for review

- The ATM is a standalone program and runs separately from the input demonstration.
- Only the mock PIN opens the menu, and the failure limit behaves as proposed.
- Successful operations produce the expected balance.
- Invalid input, insufficient funds and an over-limit deposit leave the balance unchanged.
- Input ending at every prompt exits without a pending transaction or an infinite retry loop.
- All three teammates can explain parsing, a rejected transaction and the menu's exit path.
- Your README describes what you actually checked, including any unresolved issue.

