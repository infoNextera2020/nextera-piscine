# Approved ATM delivery and reporting addendum

Owner-approved source handoff, 31 October 2026; immutable live publication remains inactive. The complete learner assignment is [learner-pack/learner-en.md](learner-pack/learner-en.md).

## Supplied reporting helper: required output contract

This reporting contract and single-file packaging were approved for this learner handoff on 31 October 2026. They add a visible observation format; they do not change the original business values or enable a platform grader.

The starter includes `Report(event string, balance *int)`. Keep it and the supplied `ReadLine` helper unchanged. You implement the ATM behavior, then report the observation that actually occurred. `&balance` passes the address of your current integer balance to the supplied helper; the helper reads it without changing it. `nil` means there is no authenticated balance to report. Do not use `nil` for a logged-in zero balance: pass `&balance` when it is `0`.

Use **stdout only for `Report` records**. The helper writes one JSON array per line, for example `["balance",100]`. Write human prompts, the readable menu, short rejection explanations and goodbye messages to **stderr**, for example `fmt.Fprintln(os.Stderr, "Choose an option:")`. Exact human wording remains flexible. Do not print menus, input echoes, labels or extra JSON directly to stdout. The supplied helper handles serialization; you are not asked to build a JSON framework.

| Call/event | Required point                                                                                | Balance argument                                        |
| ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `menu`     | Correct PIN opens the menu; again after showing a balance or finishing/rejecting an operation | `&balance`                                              |
| `amount`   | Choice `2` or `3` begins an amount request                                                    | `&balance`, unchanged                                   |
| `balance`  | Choice `1` shows the current balance, then report `menu`                                      | `&balance`, unchanged                                   |
| `accepted` | A valid deposit/withdrawal succeeds, then report `menu`                                       | `&balance` after the change                             |
| `rejected` | Wrong/malformed PIN, invalid menu/amount, insufficient funds or cap rejection                 | `nil` for a failed PIN; otherwise `&balance`, unchanged |
| `end`      | Exit, third failed PIN, or `ReadLine` returns false at any prompt                             | `nil` before login; otherwise the current `&balance`    |

A third failed PIN produces `rejected` with `nil`, then `end` with `nil`; the menu must not open. An invalid menu/amount or disallowed transaction produces `rejected`, then `menu`. Choosing a deposit/withdrawal first produces `amount`; after the amount, produce `accepted` or `rejected`, then `menu`.

**Terminal balance is required.** After login, report `end` with the current committed balance before every clean return, including EOF while waiting for an amount. Do not apply a pending operation, reset to `100`, omit the end record or invent a successful transaction. Before login, EOF produces only `end` with `nil`; it is not another failed PIN. On choice `4`, report `end` with the current balance and stop. Emit exactly the required ordered records; do not fabricate observations or a “pass” record.

For correct PIN, deposit `25`, show balance, then exit, stdout is:

```jsonl
["menu",100]
["amount",100]
["accepted",125]
["menu",125]
["balance",125]
["menu",125]
["end",125]
```

Your stderr can use any clear wording for the corresponding prompts and explanations. `Report` checks record shape and stops if reporting output is unavailable; it does not decide whether your transaction or reported balance is correct. A separate independent model must check those facts against exact input captured for the same uploaded attempt. A helper call, README claim or local demo is not an automatic PASS. The reporting-only example is separate from both the input demo and your ATM submission.

## One source artifact

Submit the single [main.go starter](learner-pack/main.go) after implementing the ATM. Both supplied helpers stay in that file. Preserve the top README comment and fill in the actual three teammates, `go run main.go`, observed checks and unresolved issues. The original brief asks for README information, not a mandatory second filename; that information remains in the exact source revision.

Human messages go to stderr, structured observations through Report to stdout. The original input-only demo remains separate and unchanged; the reporting-only demo also stays separate. Neither is a working ATM submission. No score, deadline, retry rule, automatic PASS, current testpack or native runtime is created by this handoff.
