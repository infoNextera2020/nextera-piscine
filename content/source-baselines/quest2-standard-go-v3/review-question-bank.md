# Q2 standard Go draft review bank v3

Active content only. Five category templates below are examples, not a production-sized randomized bank. Create multiple activity-appropriate variants before deploying five-question sampling. No scores, pass thresholds or automated grading are implemented.

1. **Explain structure.** For Greeting card show where execution starts; for a function task identify its input/output and how the provided caller invokes it. Explain printing versus returning where relevant.
2. **Predict a boundary.** Predict the first/last output, a zero input, a reversed range or non-positive dimension as appropriate. State the reason before running.
3. **Trace one small case.** Follow actual values through one branch or a short loop. Show the accumulator or nested-loop positions when applicable.
4. **Make one controlled change.** Change a caller input or practice bound, predict the effect, test, then restore the required contract. Do not rewrite the whole solution.
5. **Debug with evidence.** Describe expected versus actual output, identify the smallest useful check, and distinguish setup/compile errors from logic or formatting errors.

## Specific prompts for the seven active activities

- F1 Greeting card: What starts execution, and why might editing source not change a previously built executable?
- F2 Sign label: Why is zero separate, and what does the caller receive if the function prints instead of returning?
- L1 Counting: Why are there zero iterations for n=0, and what changes for countdown?
- L2 Evens: Explain zero and negative even values, then predict reversed bounds.
- L3 Sum: Where is the total initialized, and what happens if initialization moves inside the loop?
- L4 Rectangle: When is a newline written, and why not after every star?
- L5 Ordered pairs: How do you guarantee a<b and avoid duplicate pairs?

Do not draw questions about later activities for a learner reviewing an earlier one. Use a learner's own code and a small variation, not memorized answers. fmt is available; integer formatting and character-code tricks are not assessment goals. Activity-specific details remain proposed contracts. Automatic assignment/sampling is intended product behavior, not functionality verified by this document.

