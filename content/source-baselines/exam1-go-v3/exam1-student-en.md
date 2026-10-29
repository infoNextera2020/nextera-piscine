# Exam 1 Go foundations and problem solving

Student review draft v3 — 29 October 2026

This paper contains exactly eight questions: five coding tasks, two output-tracing questions and one debugging task. It uses the standard-Go skills practised in Quests 2 and 3. The eight-question content has been approved.

Approved duration: **180 minutes (3 hours)**. The exam is marked out of **100**: Questions 1–5 (coding) carry **75 marks total**, Questions 6–7 (trace) **10 marks total**, and Question 8 (debugging) **15 marks**. Passing requires **both at least 60/100 overall AND at least 45/75 on Questions 1–5**. Reaching only one threshold is not a pass. These are approved assessment requirements, not a claim that platform settings or grading are enabled. Detailed per-question allocations and partial-credit rules, retries, permitted references and supervision remain pending.

## Instructions

Use Go and its standard library only. No external packages, recursion, sorting, stdin parsing or command-line argument handling are required. Coding functions belong to the local package `piscine`; a provided caller supplies the inputs. Do not write a main function or print inside a submitted function. Return a value or change the target exactly as requested.

Work in the internal exam editor. The proposed file names below identify the function source for each coding task; the facilitator must validate the package wrapper and provided caller before the exam opens. A Git commit is not an exam submission.

The agreed exam flow allows free navigation between questions. Saving a draft preserves work but is not an official submission: use the explicit official submission action when ready. Run is for trying the public examples and does not award a grade or count as submission. These are the required delivery semantics, not a claim that the editor, saving, Run or submission flow has already been implemented or verified.

For Questions 6 and 7, provide the exact output and a brief reason, not a rewritten program. For Question 8, provide the corrected function, an explanation and the requested counterexample. The response interface for trace/debug answers is still to be designed; no particular controls or layout are specified here.

Only the declared input domains will be assessed. There are no hidden nil-pointer, zero-divisor, aliasing, malformed-UTF-8 or integer-overflow requirements. Empty slices may be nil where stated. Exact output formatting applies to tracing questions; coding functions do not print. The examples illustrate behavior, not implementation solutions.

## Question 1 A small order total

**Type:** coding. **Proposed file:** `ordertotal.go`.

Implement:

```go
func OrderTotal(quantity, unitPrice int) int
```

A small shop uses these rules, in this order:
- If quantity is zero, return zero. There is no handling fee for an empty order.
- Otherwise, subtotal is quantity multiplied by unitPrice.
- When subtotal is less than 30, add a handling fee of 5.
- When subtotal is 30 or more, add no handling fee.

Return the resulting total. All values are plain whole-number units; no money-formatting or real-world pricing knowledge is needed.

**Input domain:** quantity is 0–10; unitPrice is 1–30. All inputs meet these bounds.

**Examples:**

| quantity | unitPrice | returned total |
|---:|---:|---:|
| 0 | 4 | 0 |
| 2 | 10 | 25 |
| 3 | 10 | 30 |
| 1 | 20 | 25 |

Do not print, add tax or invent other rules.

## Question 2 Update a shared counter

**Type:** coding. **Proposed file:** `shiftcounter.go`.

Implement:

```go
func ShiftCounter(counter *int, delta int)
```

Add delta to the integer that counter points to. The caller must observe the updated value in its original variable. Do not return a value or print.

**Input domain:** counter is a non-nil pointer to one writable integer. Its initial value is between -50 and 50; delta is between -10 and 10. No other pointers or aliases are involved.

**Examples:**

| initial target | delta | target after the call |
|---:|---:|---:|
| 7 | 3 | 10 |
| 4 | -6 | -2 |
| -2 | 0 | -2 |

## Question 3 Count values outside a safe range

**Type:** coding. **Proposed file:** `countoutside.go`.

Implement:

```go
func CountOutside(values []int, low, high int) int
```

Return how many elements are strictly below low or strictly above high. Values equal to either boundary are inside the range. Count repeated elements separately. Do not modify values or print.

**Input domain:** values contains 0–20 integers, each between -50 and 50. Both low and high are between -50 and 50, and low ≤ high. An empty or nil slice returns zero; reversed bounds are excluded.

**Examples:**

| values | low | high | result |
|---|---:|---:|---:|
| [-3, 0, 5, 8] | 0 | 5 | 2 |
| [2, 2, 3] | 2 | 2 | 1 |
| [] | -2 | 2 | 0 |

## Question 4 Count text except ordinary spaces

**Type:** coding. **Proposed file:** `counttext.go`.

Implement:

```go
func CountText(s string) int
```

Return the number of runes in s other than the ordinary ASCII space character U+0020 (`' '`). Count runes, not UTF-8 bytes. Do not change the text or print. Build the count by visiting the text rather than calling a complete ready-made counting operation.

**Input domain:** valid UTF-8 strings of 0–30 runes containing ordinary Latin/Arabic letters without combining marks, decimal digit characters and ordinary spaces. Tabs, newlines, malformed bytes and joined emoji sequences are excluded. This task does not claim to count all user-perceived characters in arbitrary Unicode text.

**Examples:**

| input string | result |
|---|---:|
| `""` | 0 |
| `"   "` | 0 |
| `"Aب"` | 2 |
| `" Go ب "` | 3 |
| `"ب ا"` | 2 |

## Question 5 Read a numbered label

**Type:** coding. **Proposed file:** `readlabel.go`.

Implement:

```go
func ReadLabel(s string) int
```

A valid label consists of one leading `#` followed by one, two or three ASCII digits `0`–`9`, and nothing else. Return the number represented by those digits. Leading zeros are allowed. Return -1 for every invalid label.

There are no spaces, signs or extra prefixes in a valid label. Do not accept a valid-looking prefix of an otherwise invalid string. Build the conversion using the character/accumulation ideas you learned; do not delegate the numeric conversion to strconv.Atoi, strconv.ParseInt, scanning helpers or another complete parser. This requirement is part of the learning task, not a claim that an automated restriction scanner exists.

**Input domain:** valid UTF-8 strings of 0–5 runes. Some are invalid labels on purpose. Valid results are 0–999, so overflow handling is not required.

**Examples:**

| label | result |
|---|---:|
| `"#7"` | 7 |
| `"#042"` | 42 |
| `"#000"` | 0 |
| `"#"` | -1 |
| `"#1234"` | -1 |
| `"7"` | -1 |
| `"#١"` | -1 |
| `" #1"` | -1 |

## Question 6 Trace the running total

**Type:** trace/output with a brief reason. Do not alter the code.

Write exactly what this complete program prints, line by line, and briefly explain why each line appears.

```go
package main

import "fmt"

func main() {
    values := []int{2, -1, 3}
    total := 0
    for _, value := range values {
        if value > 0 {
            total += value
        }
        fmt.Println(total)
    }
}
```

## Question 7 Trace a returned value

**Type:** trace/output with a brief reason. Do not alter the code.

Write the exact output and explain the difference between the two calls to change.

```go
package main

import "fmt"

func change(value int) int {
    value = value + 3
    return value
}

func main() {
    n := 2
    change(n)
    fmt.Println(n)
    n = change(n)
    fmt.Println(n)
}
```

## Question 8 Repair a list total

**Type:** debugging. **Proposed file:** `sumall.go` plus a short explanation in the enabled response field.

The intended function returns the sum of every element without changing the slice or printing. Empty and nil slices must return zero. Inputs contain 0–10 integers, each in [-20,20].

The implementation below does not satisfy that contract. Fix it, explain the defect briefly, and give one small input that exposes the original bug with its expected result. Keep the same function name and signature.

```go
package piscine

func SumAll(values []int) int {
    total := 0
    for i := 1; i < len(values); i++ {
        total += values[i]
    }
    return total
}
```

## Scope reminder

This paper does not directly assess Q1's shell navigation, pipes, permissions or local Git operations. Their practical assessment needs a separate decision and suitable environment; solving Go tasks does not prove those operational skills.

The first project opens at its scheduled time after the exam, independent of submitting or passing this exam. The approved duration and section weights/pass rule are stated above; retry rules remain pending.
