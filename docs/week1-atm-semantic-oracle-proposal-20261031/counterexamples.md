# Historical baseline counterexamples — reporting addendum now explicit

These are synthetic witnesses for the original 29 October baseline, not executions or grades. The 31 October owner-approved Report addendum now closes the framing gap in the actual learner handoff; the invisible-source-state limit remains. Scenario: correct login, deposit `25` from `100`, ask to show the balance.

## A lossy numeric comparison accepts a wrong balance

Valid clear prose:

```text
Previous balance 100. Deposit 25 accepted. Current balance 125.
```

Invalid clear prose for that same scenario:

```text
Current balance 100. Deposit 25 accepted. Previous balance 125.
```

Both have the number sequence `[100, 25, 125]`; both have the same case-folded bag of words. The second says the current balance is `100` and is wrong. Matching digits, sorting words, normalizing whitespace or accepting a substring `125` cannot distinguish the required current state. Menu tokens, the PIN, examples and input echoes create further unrelated numbers. A parser of arbitrary prose would have to understand the relationship expressed by the wording; the source supplies no formal language or phrase grammar for that relation. This is a contract insufficiency, not a claim that all natural-language interpretation is mathematically impossible.

Different valid prose also need not share an English keyword. The brief's only requirement is that the outcome be clear. Requiring `Balance:`, `Invalid amount`, a particular language/number format or a new marker in hidden tests would narrow that promise. A finite list of natural-language aliases cannot prove that all permitted clear expressions are recognized. Unknown wording therefore cannot soundly become an automatic failure or PASS under the unchanged contract.

## A fully identical transcript can hide an internal exit reset

Consider two implementations that behave identically for every input and produce identical output until they return. The second adds `balance = 100` immediately after its last output and before each authenticated return. Neither prints a final balance; the brief does not require one. For input `0427`, deposit `25`, then exit, both can print exactly:

```text
Menu: 1 balance; 2 deposit; 3 withdraw; 4 exit.
Deposit accepted.
Menu: 1 balance; 2 deposit; 3 withdraw; 4 exit.
Goodbye.
```

The first retains `125` until return; the second violates the source's instruction not to reset the current balance on exit. No subsequent menu input can observe memory after the program has exited, and no black-box output-only comparator can distinguish these implementations. The same witness applies to EOF during a pending amount. This is genuine observational indistinguishability, not just a weak regular expression.

Adding a required terminal balance observation can test that externally visible terminal value, but an implementation could still change a private variable after emitting it. Therefore the prototype never treats an output report as proof of internal source invariants. Exact-attempt source review remains needed for that source-level requirement. A future automatic contract must state that it tests observable behavior rather than claim to establish invisible assignments.

## Why the candidate does not trust a student assertion

`["accepted", 125]` is not trusted because it says “accepted”. The reference model derives whether this input should be accepted and what every subsequent current/terminal balance should be. It rejects a claimed acceptance for an invalid amount, a rejected withdrawal that changes state, the wrong number, missing/duplicate/reordered facts, stale balances and false terminal balances. The future capture's process termination must come from the Runner transport, not from learner stdout. These are still observable tests; no finite output test set proves all internal implementations or replaces a required mentor decision.
