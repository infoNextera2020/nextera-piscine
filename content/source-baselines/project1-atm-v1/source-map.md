# Beginner ATM source and adaptation map

Draft v1 — 29 October 2026

This document records the historical basis and the new beginner adaptation. It does not modify the source repository or imply that all proposed details have been approved.

## Historical baseline

Repository: `Anasmoner2022/piscine-go`.

Pinned revision: `4e25fdc4354592a898b55444b39bbdd8aeaebf82`.

Source: [ATM banking system project at the pinned revision](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/01-atm-banking-system.md).

The source was reviewed for the curriculum adaptation on 29 October 2026. This package is new local development material, not a patch, publication or import of the original.

## Adaptation decisions

| Historical element | Treatment in this package | Status |
| --- | --- | --- |
| ATM terminal project | Retain the educational terminal simulation | Approved direction |
| Team of four | Reduce to three learners with rotating roles and shared integration | Approved change |
| PIN login | Retain a single mock PIN, with no real account information | Approved direction |
| Historical example PIN `1234` | Propose exact string `0427` to make the leading-zero distinction visible | Proposed value |
| Three login attempts | Retain three as a proposal and make malformed-line counting and EOF behavior explicit | Detailed contract proposed |
| Balance display | Retain without changing state | Approved scope |
| Deposit | Retain with explicit integer bounds and an all-or-nothing balance-cap check | Feature approved; bounds and contract proposed |
| Withdrawal | Retain with explicit amount bounds and insufficient-funds rejection | Feature approved; bounds and contract proposed |
| Transfer | Defer rather than simplify into the beginner core | Approved exclusion |
| PIN change | Defer | Approved exclusion |
| Exit and continuing interaction | Retain a repeated menu with an explicit exit | Approved scope; menu tokens proposed |
| Persistence language | Interpret as continuing the menu loop, not files or a database | Historical clarification |
| Larger project expectations | Reframe as gradual beginner integration after Q1 through Q3 and Exam 1 | Approved direction |

The scope reduction is grounded in the owner's approved beginner direction. Exact values and implementation-facing contracts are new proposals, not requirements copied from the source.

## New material introduced for review

- Starting balance `100`, cap `10000` and transaction range `1..1000`, all in invented integer units.
- Exact menu tokens and a separate exact PIN string contract.
- Whole-line amount validation for one to five ASCII digits; leading zeros allowed; whitespace, signs, decimal points and non-ASCII digits rejected.
- A proposed assessment boundary of 20 characters per input line; arbitrary-length input recovery is out of scope.
- Explicit non-mutating rejection, cap rejection rather than clamping, and clean termination at any prompt when the input helper returns false.
- A supplied line-reading helper and a separate input demonstration so scanner mechanics do not become the learning barrier.
- Six gentle development stages, three rotating roles and shared responsibility for explaining the integrated program.
- Learner-visible examples and a private mentor checklist with five question templates, without complete solution code or scores.
- Delivery caveats separating source-file upload, a possible local demonstration and the intended attempt-specific mentor approval flow from actual platform availability.

## Curriculum alignment

Q1 supplies shell and Git foundations. Q2 supplies standard Go control flow and functions. Q3 supplies introductory runes, simple pointers, bounded conversion and slices. The project does not require every prior topic to appear in the solution and adds no maps, structs or concurrency requirement.

Exam 1 appears before the project in the timetable, but neither its submission nor its pass status gates scheduled project opening. The source package defines no new schedule or assessment thresholds.

## Technical reading

The supplied helper follows the documented behavior of [bufio Scanner Scan](https://pkg.go.dev/bufio#Scanner.Scan) and [bufio ScanLines](https://pkg.go.dev/bufio#ScanLines). These official references were checked on 29 October 2026. The helper's teaching contract combines EOF and read failure into a false boolean; detailed read-error recovery is deliberately not a learner requirement.

This is an input-scaffold reference, not a recommendation to add scanner internals to the ATM assessment. The source project remains the historical basis for the exercise; the Go documentation supports the separately supplied helper's behavior.

## Status boundaries

Local content development does not prove a working platform runner, upload convention, automatic review service or mentor approval implementation. No repository source was changed. No production content, grades, attempts, deadlines or platform settings were edited by creating these Markdown files.

No Go compiler run was completed for the supporting files in the authoring environment. See `private/verification.md` for engineering checks still required; documented expected outcomes are not runtime test results.

