# Owner-approved supplied Report source contract v1

Owner decision: `Sentinel_1cbce2e598b88191964a8d4af844e811`, 31 October 2026. This source handoff is approved; live immutable assessment publication is still inactive.

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

## Independent capture boundary

The machine identifier is `atm-observable-report-v1`. Its exact source profile and helper pins are in [reporting-contract.json](../week1-atm-single-main-proposal-20261031/learner-pack/reporting-contract.json). Host code must bind the published version/digest independently of learner payloads. The prototype requires explicit contract selection and contains no active feature flag or grade writer.

Before comparison, a real host capture must bind the exact executed source bytes/digest and immutable attempt/capture identity, exact delivered stdin/test definition, complete raw stdout and stderr, the reporting-contract digest, an explicitly configured resource-policy digest, observed termination and exit code. These are capture authority requirements, not fields a learner can assert. The pure seam has no producer and stays unavailable by default. A malformed/missing capture, source/input drift, policy drift, interrupted I/O or nonzero helper/process exit never becomes a positive match.

After proven capture, derive every expected event and integer balance from exact input and compare the full ordered arrays. Ignore only output CRLF/LF choice, blank lines and JSON-edge whitespace. Do not strip controls, scrape digits, match English phrases, accept extra records, normalize input, infer a pass from stderr, or trust a README/test-success claim.

`observations_match` is limited to this finite scenario's observable trace under the source contract; it is not an academic PASS, final outcome or progression award. Actual capture authentication, immutable pack registration, broader test coverage and result application remain unimplemented here. Invisible assignments after the last output, prose clarity and teamwork still require exact-attempt source/mentor review. These limits never waive required automated or mentor gates.
