# Candidate observable projection v1 — not active assessment policy

Identifier: `atm-observable-projection-candidate-v1`. This candidate must be published as a learner-visible output addendum before any automatic enforcement. The current brief alone does not require these records. No current learner is failed for lacking them.

## Channels and framing

Keep stdin exactly as in the retained brief and use the exact supplied `ReadLine` helper. No input trimming, numeric-prefix parsing or PIN/menu normalization is added.

Use stdout only for one UTF-8 JSON array per line: `[event, balance]`. `event` is one of the six values below; `balance` is an integer in the source's balance range, or JSON null before authentication. CRLF/LF endings, horizontal whitespace around the JSON record and blank lines are presentation differences. No arbitrary text, ANSI cursor controls, echoed input, extra fields, floating-point values, booleans or nonfinite values appear in this machine channel. Strict whole-record parsing replaces magic word/number searches.

Prompts, the menu and short explanations go to stderr and keep the brief's flexible human wording. Their clarity is a qualitative exact-attempt review criterion; this prototype does not falsely certify it. No exact English error, goodbye or balance label is required. A supplied serialization bridge could hide JSON mechanics in a future learner release; adding such infrastructure would preserve the existing helper and is not implemented or published here.

| Event      | When emitted                                                                                                     | Balance field                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `menu`     | Correct PIN opens the menu; menu is available again after showing a balance or completing/rejecting an operation | Current balance                                          |
| `amount`   | Exact menu choice `2` or `3` begins an amount request                                                            | Unchanged current balance                                |
| `balance`  | Exact menu choice `1` explicitly requests a balance observation                                                  | Current balance; no state change                         |
| `accepted` | A whole deposit or withdrawal succeeds                                                                           | Balance after that transaction                           |
| `rejected` | Wrong/malformed PIN, invalid menu choice, invalid amount, insufficient funds or deposit cap rejection            | Null for failed PIN; otherwise unchanged current balance |
| `end`      | Exit choice, third failed PIN or unavailable input at any prompt ends the program                                | Current balance if authenticated; otherwise null         |

The kind distinguishes observable outcomes; it is not a trusted success declaration. The independent model derives the expected event and balance from exact input. There is no self-reported PASS, source hash, team claim, check summary or current-state assertion used as authority. Record order is exact. After third PIN failure or exit, remaining input does not create more records. A third rejected PIN is followed by `end`. EOF after choosing an amount emits `end` with the previously committed balance and no accepted/rejected pending transaction. A completed transaction emits `accepted` or `rejected`, then `menu`; an invalid menu choice emits `rejected`, then `menu`; showing balance emits `balance`, then `menu`.

Example machine projection for login, deposit `25`, show balance, exit:

```jsonl
["menu",100]
["amount",100]
["accepted",125]
["menu",125]
["balance",125]
["menu",125]
["end",125]
```

Human prompts/explanations can be phrased freely on stderr. The machine records are an explicit format boundary. They preserve business rules but add observable reports, including the terminal balance the current brief does not require. They must never be smuggled into a hidden pack as if already required.

## Independent reference and result meaning

The pure model reads the exact stdin bytes; it does not inspect, modify or instrument the submitted Go source or require learner-defined function names. Its values are copied from the retained source and are not registered settings: PIN `0427`, initial `100`, balance `0..10000`, amounts `1..1000`, three failed PIN lines, menu `1..4`, one-to-five ASCII-digit amounts with leading zeros allowed and no whitespace trimming.

Assessed input lines retain the source boundary of at most 20 characters. The prototype reports longer lines or unspecified invalid UTF-8 as outside its assessed-input contract rather than inventing a failure requirement. It handles LF/CRLF, blank lines and a final unterminated line under the supplied helper's contract. It adds no production timeout, output, CPU, memory, retry or storage quota.

`observations_match` means this captured finite trace matches this candidate's model. `projection_mismatch` means an event/value/framing differs under the explicitly selected candidate. `incomplete_observation` means actual termination has not been independently captured. `outside_assessed_input` identifies inputs outside the selected source boundary. `unresolved_contract` is returned unless the candidate contract is explicitly selected. None is a platform grade or academic PASS. Actual exact-stdin delivery/capture/termination, immutable attempt binding, resource policy and broader test-pack coverage remain separate engineering work; no Runner or production feature switch is wired here.

The output restriction closes deterministic comparison of the declared observable business facts. It cannot prove invisible state, arbitrary-prose meaning, all executions or honest team participation. Keeping those limits explicit preserves the existing source/assigned-mentor review requirement and never waives the platform's automated-result gate.

Any future harness input-delivery/read-infrastructure failure must be recorded as incomplete or infrastructure-unknown, not a learner business failure. The pure prototype receives synthetic exact stdin and a synthetic termination observation in its tests; it does not implement that trusted capture boundary. Resource and process-exit policy are not inferred from learner stdout or invented here.
