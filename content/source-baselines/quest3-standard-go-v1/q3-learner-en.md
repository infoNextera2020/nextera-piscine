# Quest 3 Working with values text and slices

Beginner review draft v1 — 29 October 2026

The learning direction is approved. The exact function contracts, input limits, file names and checks below are proposed for review before assessment. They are not deployed graders, a pass policy or a timetable.

## What you will learn

Tell the difference between returning a value, printing it and changing a value the caller can see. Count text as runes, use a simple pointer, turn short number text into integers, visit a slice and reverse rune order. You already used returns, conditions and loops in Q2; this module connects those ideas to different data.

Use Go and its standard library only. No external packages, credentials, account setup or downloads are required for these activities. Work in a separate practice folder you own; no administrator commands or destructive operations are needed.

## Function tasks and the caller

All nine main activities are functions in the local package `piscine`; this is a package name, not an external library. A provided caller in `package main` supplies the inputs and uses standard-library fmt to show a returned value or the variables after a call. Your submitted function does not print debug output. Keep your experiments in the caller and remove any debugging output from the submission.

Proposed structure, prepared and tested by the facilitator/engineer:

```text
task-work/
  go.mod                  local module setup
  piscine/strlen.go       your function file; changes by task
  cmd/check/main.go       provided caller, not the solution
```

A module named `example/q3-practice` allows the caller to import `example/q3-practice/piscine`. From the root, `go run ./cmd/check` runs the caller; the library directory itself is not a runnable main program. Each activity gets a separate prepared folder. There is no external dependency and no need to fetch modules.

Upload only the task's requested function file through the enabled upload flow, not a whole repository or the caller. The engineer must verify this program/function wrapper against the actual submission runner before release. If actual upload instructions differ, ask rather than silently changing the package name. A Git commit is not an upload.

## How to use the small bridges

Each bridge is a short practice experiment, not another scored task. Predict a result, make one change, observe it and explain it to a peer. Write the command, expected result, actual result and what you changed when asking for help. A peer can ask a question or give one hint, not write the implementation.

The proposed learning constraints below are explicit. Counting/parsing/reversing activities ask you to build the operation rather than call a ready-made operation that does the whole task. Ordinary language constructs and standard-library tools are available; there is no arbitrary package whitelist. A declared learning goal is not evidence that an automatic restriction checker exists.

## 1 Count the runes in text

**Bridge:** return to Q2's distinction between a returned value and what the caller prints. Now inspect a short string. A Go string holds bytes; a rune represents a Unicode code point. One rune is not always one byte.

For these exact examples, `Go` has 2 bytes and 2 runes; `باب` has 6 UTF-8 bytes and 3 runes; `Aب` has 3 bytes and 2 runes. The letters in the Arabic example contain no added vowel marks. Read these examples as concrete strings, not a rule that every Arabic symbol always has a fixed visual size. A rune is not a complete user-perceived-character model: combining marks and joined emoji sequences are outside this beginner discussion.

**Task:** implement `func StrLen(s string) int` in `strlen.go`. Return the rune count, without printing. Build the count through iteration rather than calling a ready-made rune-counting function.

**Proposed input domain:** valid UTF-8 strings of 0–32 runes. Invalid UTF-8 is excluded; there is no hidden malformed-byte requirement.

**Examples:** empty string → 0; `Go` → 2; `باب` → 3; `Aب` → 2.

**Checks:** include empty, ASCII and non-ASCII inputs. Explain why simply asking for the byte length does not meet this contract. Compare the value returned by your function with the output your caller displays.

**Hint:** investigate what string iteration gives you. Ask about the difference between its index and its rune value before assuming both count the same thing.

**Review question:** “Why can two strings with the same rune count have different byte lengths?”

## 2 Change one caller value

**Pointer bridge:** draw a box and a reference to it:

```text
caller variable n: [ 7 ]
pointer p:        -----> that same box
```

The box is a value; the arrow is a way to reach it. The drawing is not an actual address or memory-layout diagram. Your facilitator introduces address-of (`&`) and dereference (`*`) using an unrelated observation example. Predict which value the caller will see after a function changes the target. Go passes a copy of the pointer value, but that copy can still refer to the same target; there is no need to invent “pass by reference” rules.

**Task:** implement `func PointOne(n *int)` in `pointone.go`. Set the target integer to 1. Do not return a value or print.

**Proposed preconditions:** n is a non-nil pointer to a writable integer owned by the caller, initially between -100 and 100. Nil is explicitly excluded; no special nil behavior is requested.

**Examples:** a target initially 7 becomes 1; a target initially -3 becomes 1; a target already 1 stays 1. The caller inspects its original variable after the call.

**Check:** explain whether you changed the pointer variable or the value it reaches. Draw the before/after boxes without replacing the caller's variable with an unrelated one.

**Hint:** distinguish the arrow from the box's contents. You only need one level of indirection.

**Review question:** “Why can the caller observe the change even though your function has no return value?”

## 3 Swap two caller values

**Task:** implement `func Swap(a *int, b *int)` in `swap.go`. Exchange the target values. No output and no return value.

**Proposed preconditions:** both pointers are non-nil, point to two different writable integers and each initial value is in [-100,100]. Same-address aliasing is excluded for this beginner contract. Equal values in two different variables are allowed.

**Examples:** targets 3 and 8 become 8 and 3; -2 and 0 become 0 and -2; two distinct targets both holding 4 remain 4 and 4.

**Bridge/check:** draw two boxes and label their starting values. Follow the sequence of reads and writes. Explain how you avoid losing a value before it is used. Do not judge success by printing only one target.

**Hint:** saving information and overwriting information are different steps. Trace your actual approach rather than copying a remembered formula.

**Review question:** “Which original value would be lost if you overwrote a target too early?”

## 4 Store a quotient and remainder

**Arithmetic bridge:** with a small example, describe how many equal groups fit and what remains. The facilitator introduces integer `/` and `%` before this task. This activity starts with nonnegative dividends and positive divisors; signed-division rules are not an unstated extra test.

**Task:** implement `func DivMod(a int, b int, div *int, mod *int)` in `divmod.go`. Store the integer quotient in div's target and the remainder in mod's target. Do not print or return.

**Proposed preconditions:** 0 ≤ a ≤ 100; 1 ≤ b ≤ 10. Both result pointers are non-nil and point to distinct writable integers. Their initial contents do not matter. Division by zero, negative operands, overflow and overlapping result targets are explicitly outside this introductory contract.

**Examples:** 13 and 2 → quotient 6, remainder 1; 12 and 3 → 4 and 0; 0 and 5 → 0 and 0; 3 and 5 → 0 and 3.

**Checks:** inspect both targets after the call. Distinguish plain input values a/b from output pointers div/mod. As a reasoning check, see whether the original dividend can be described using divisor, quotient and remainder.

**Hint:** do the arithmetic on paper before introducing pointers; then separate computing a result from placing it in the caller's target.

**Review question:** “Which arguments are values and which are addresses, and why is the distinction useful here?”

## 5 Turn valid digit text into a number

**Text-to-number bridge:** `"42"` is text, not the integer 42. Discuss place value using a two-digit example: what does the first position contribute and what does the second contribute? Distinguish a digit character from its numeric value. The facilitator introduces that conversion concept without handing over the full accumulation loop.

**Task:** implement `func BasicAtoi(s string) int` in `basicatoi.go`. Convert valid unsigned ASCII decimal text to its integer value. Build the conversion yourself rather than calling strconv.Atoi, strconv.ParseInt or another complete numeric parser. This is an explicit learning requirement, not an implemented scanner.

**Proposed input domain:** 1–8 ASCII digits `0`–`9`, no signs, spaces or other characters. All inputs are valid at this stage. Empty strings and malformed input are excluded here. The largest possible value is 99,999,999, so no int-overflow challenge is hidden in this task.

**Examples:** `42` → 42; `0042` → 42; `000` → 0.

**Checks:** explain leading zeros. Try more than one length, and trace the state after each digit on paper. Returning the number is different from displaying it in the caller.

**Hint:** connect place value to the running total you practised in Q2, but do not assume summing digits equals reading a decimal number.

**Review question:** “Why do `42` and `0042` produce the same value, but `24` does not?”

## 6 Reject invalid unsigned text

**Task:** implement `func BasicAtoi2(s string) int` in `basicatoi2.go`. Accept a nonempty sequence of ASCII digits as before. Return 0 for an empty string or any other input. Invalid input invalidates the entire string; do not return a valid-looking prefix.

**Proposed domain:** valid UTF-8 strings of 0–8 runes. Only ASCII `0`–`9` count as digits for this parser. This includes non-ASCII inputs for rejection, not for Unicode numeric conversion. The short length keeps every valid number inside the same safe bound as the previous task.

**Examples:** `0042` → 42; `12 3` → 0; `hello` → 0; `+3` → 0; `٣` → 0; empty → 0. Here `٣` is a non-ASCII digit and intentionally outside the accepted alphabet.

**Checks:** test invalid characters at the beginning, middle and end, not just an entirely alphabetic string. Explain why both valid text `0` and invalid text can return 0 under this exercise's contract.

**Hint:** first separate input validity from building the value. Do not silently trim spaces or skip a character.

**Review question:** “Why would returning 12 for `12x` violate this function's contract?”

## 7 Add one optional sign

**Task:** implement `func Atoi(s string) int` in `atoi.go`. Accept an optional single leading `+` or `-`, followed by at least one ASCII digit. Unsigned digit strings remain valid. Return 0 for every invalid string. Build the parser rather than calling a complete numeric-conversion helper.

**Proposed domain:** valid UTF-8 strings of 0–8 runes, including any sign. Valid unsigned numbers have at most eight digits; signed ones at most seven. The values fit in int on supported 32-bit and 64-bit Go targets. Do not add overflow behavior beyond this bounded task.

**Examples:** `+42` → 42; `-42` → -42; `-0` → 0; `0042` → 42; `++2`, `--2`, `+-2`, `2-`, `+`, `-`, empty, ` 2` and `2 ` → 0.

**Checks:** compare no sign, one sign, repeated signs and sign without digits. Do not accept spaces or non-ASCII digits. The task returns only an int, unlike the standard library's Atoi, which also returns an error; do not import its API contract by accident.

**Hint:** a sign's location and the existence of digits after it are separate questions. Keep them separate when explaining your approach.

**Review question:** “What makes a single leading sign valid but a sign by itself invalid?”

## 8 Add the values in a slice

**Newly authored bridge task:** SumSlice. It connects the accumulator you know to a list of inputs instead of a numeric range.

**Slice bridge:** draw three positions labelled 0, 1 and 2 with values 4, -1 and 2. The index names a position; the value is the content at that position. Inspect a short slice in the provided caller, then an empty slice. Ask what valid indices exist before accessing one. You do not need to implement allocation internals or pointer arithmetic.

**Task:** implement `func SumSlice(values []int) int` in `sumslice.go`. Return the sum of the elements using iteration. Do not print and do not change the input elements.

**Proposed domain:** slices of 0–20 integers, each in [-100,100]. Both a nil slice and an allocated empty slice are permitted and return 0. Total magnitude stays at most 2000.

**Examples:** [4,-1,2] → 5; [7] → 7; [0,0] → 0; empty or nil → 0.

**Checks:** inspect the input before and after to confirm it is unchanged. Include an empty list and a negative value. Do not use a first element as an assumed starting value when the list may have none.

**Hint:** separate the number of positions from their contents. Reuse the accumulation idea, not the assumption that inputs are exactly 1 through N.

**Review question:** “How can an empty slice be handled without trying to read index 0?”

## 9 Reverse rune order

**Bridge:** a string cannot be edited by assigning directly to one of its indexed bytes. A separate result or a slice of runes lets you work with an ordered sequence. Explore those representations with one tiny example before building the full function. Converting a string to a rune slice is allowed; calling a helper that performs the whole reversal is outside this proposed learning task.

**Task:** implement `func StrRev(s string) string` in `strrev.go`. Return a new string containing the input runes in reverse order, without printing. This rune-order definition is an explicit clarification of the source's general “reversed” wording.

**Proposed domain:** valid UTF-8 strings of 0–32 runes. Initial examples use ordinary Latin/Arabic letters, digits, spaces and punctuation, with no combining marks or joined emoji sequences. This exercise does not claim to reverse user-perceived characters or preserve natural reading order in every script.

**Examples:** empty → empty; `A` → `A`; `Go!` → `!oG`; `ab` → `ba`. For the Arabic input `بت`, the rune sequence [ب, ت] becomes [ت, ب]. Inspect logical rune order with your facilitator rather than judging it solely by right-to-left screen layout.

**Checks:** test empty, one rune, two runes, an odd length, an even length and a non-ASCII example. Confirm the caller's original string is unchanged. Reversing twice is a useful additional check, but not sufficient by itself: returning the input unchanged would also pass that check.

**Hint:** locate the first and final rune positions before deciding how to build the result. A final byte position is not necessarily a final rune position.

**Review question:** “What can break if you reverse the UTF-8 bytes instead of the rune sequence?”

## Review and next steps

For every task explain its input, whether it returns/mutates, and one declared boundary case. Use the companion question templates as review examples, not memorized answers. Five activity-appropriate questions are intended under the agreed review design; a production bank needs multiple validated variants.

Peer assignment is intended to be automatic and nonreciprocal, with automatic mentor assignment. Content availability follows its schedule rather than waiting for the previous approval; mastery and XP follow mentor approval. This document neither implements nor verifies these mechanisms, and sets no scores, retries, XP quantities or fixed review durations.

Multiple pointer layers, overwriting division inputs and sorting are not active tasks here. They can be discussed as later extensions when they support the next learning goal. Completing this module does not mean completing those extensions.

## Small official references

- [Strings, bytes, runes and characters](https://go.dev/blog/strings): read the short sections on strings/runes and range with your facilitator, not the whole article as a prerequisite.
- [Go pointer types](https://go.dev/ref/spec#Pointer_types): a mentor reference for the meaning of a pointer; the box-and-arrow bridge is the beginner explanation.
- [Go slices introduction](https://go.dev/blog/slices-intro): stop after the basic declaration/indexing examples initially; capacity, growth and internals are later material.

Official pages inspected on 29 October 2026. These references supplement the tasks; they are not exercise solutions or instructions to execute every example.
