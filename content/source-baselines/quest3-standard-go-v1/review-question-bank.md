# Q3 draft review questions

Active standard-Go content only. Five templates are provided, plus activity-specific examples. This is not a deployed random bank or a complete set of variants. Before five-question sampling is enabled, author and review multiple suitable variants per activity. Do not ask a learner about an unintroduced later task.

1. **Explain the contract:** identify inputs and whether the function returns or mutates. Who prints the result? Name one declared precondition.
2. **Predict a boundary:** predict an empty-string/slice result, zero case or valid small pointer case, whichever is in this task's domain. Do not invent out-of-domain hidden tests.
3. **Trace a small case:** follow rune counting, a target change, decimal accumulation or slice traversal using the learner's own implementation.
4. **Make a controlled variation:** change one permitted caller input, predict, run and compare. Restore the task setup afterward. Do not ask for a large rewrite or unrelated advanced topic.
5. **Debug with evidence:** show expected/actual results, identify the smallest useful inspection and describe the correction. Distinguish setup/type errors from algorithm errors.

## Specific question examples

- StrLen: Why do byte length and rune count differ for the supplied Arabic example?
- PointOne: Why can a caller see a change when there is no returned value?
- Swap: Which original value could disappear if one target is overwritten too soon?
- DivMod: Which arguments are plain values and which are output targets?
- BasicAtoi: Why do leading zeros not change the result, but digit order does?
- BasicAtoi2: Why is a valid-looking prefix insufficient when a later character is invalid?
- Atoi: Why is one leading sign followed by digits valid while a sign alone is not?
- SumSlice: How does your implementation avoid reading an absent first element on empty input?
- StrRev: Why is byte reversal different from reversing the rune sequence, and why is reversing twice not a sufficient test on its own?

Review evidence is a reasoned explanation and a small observation, not a memorized answer. No answer implementations, scoring threshold, XP amount, fixed review time or retry limit is specified. The five templates do not prove automatic sampling, peer assignment or mentor review works in the platform.
