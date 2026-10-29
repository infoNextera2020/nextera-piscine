# Q3 source map and contract review

Draft v1 — 29 October2026. Source baseline main@4e25fdc4354592a898b55444b39bbdd8aeaebf82. All12 Q3 files reviewed in prior read-only inspection. No new source commit claimed or repository edits made. Links below are pinned. Historical/deferred rows are not an active learner reading list.

| Original source | Status | Draft change or boundary |
|---|---|---|
| [strlen.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/strlen.md) | Active task1 | Rune count retained; bounded valid UTF-8 domain and iteration goal proposed. |
| [pointone.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/pointone.md) | Active task2 | Set target to1 retained; non-nil pointer and bounded initial value explicitly proposed. |
| [swap.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/swap.md) | Active task3 | Swap retained; distinct non-nil targets, bounded values; aliasing excluded by proposal. |
| [divmod.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/divmod.md) | Active task4 | Quotient/remainder outputs retained; nonnegative a/positive b, distinct targets explicitly narrow the beginner contract. |
| [basicatoi.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/basicatoi.md) | Active task5 | Valid unsigned digits retained; ASCII1–8 digits and no parser-helper goal explicit. |
| [basicatoi2.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/basicatoi2.md) | Active task6 | Invalid whole string returns0 retained; empty/whitespace/non-ASCII cases and short domain clarified. |
| [atoi.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/atoi.md) | Active task7 | Optional single sign retained; sign-only/double signs/whitespace rejection explicit; short length removes overflow surprises. |
| [strrev.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/strrev.md) | Active task9 | Rune-order reversal is a proposed clarification; source only says reversed. Valid UTF-8 and bounded scope explicit. |
| [printstr.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/printstr.md) | EXCLUDED — historical only | Source links z01. Not part of active learner content, not rewritten by changing imports; original file untouched. |
| [ultimatepointone.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/ultimatepointone.md) | Deferred, not active | Three pointer levels omitted from beginner core; no completion claim. |
| [ultimatedivmod.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/ultimatedivmod.md) | Deferred extension | Input overwrite ordering later; no completion claim. |
| [sortintegertable.md](https://github.com/Anasmoner2022/piscine-go/blob/4e25fdc4354592a898b55444b39bbdd8aeaebf82/Quest3/sortintegertable.md) | Deferred, not active | Sorting follows slice fluency later; SumSlice is a new bridge, not an equivalent completed sorting exercise. |

## New material and count

- 9 active activities:8 source-derived functions and1 new SumSlice.
- Non-scored bridges: return versus display; bytes versus runes; value box and pointer arrow; two-target trace; division/remainder; decimal place value; slice positions versus contents; mutable sequence versus immutable string.
- SumSlice is newly authored: sum0–20 integer elements each in[-100,100], return0 for nil/empty, do not modify the slice. It transfers Q2 accumulation to a new input shape rather than adding a duplicate drill.
- No one-for-one replacement for the excluded output task. No triple pointers, sorting or input-overwrite division is claimed as completed.

## Contract choices pending approval before grading

All tasks use a local package piscine and a provided main caller; fmt may display results in the caller, but submitted functions neither print nor require external packages. Proposed filenames are strlen.go, pointone.go, swap.go, divmod.go, basicatoi.go, basicatoi2.go, atoi.go, sumslice.go and strrev.go. Engineer must validate this file-upload wrapper; no runtime execution was performed for this draft.

Pointer tasks explicitly exclude nil. Swap and DivMod output targets are distinct; same-address aliasing is excluded. DivMod narrows input to a in[0,100], b in[1,10]; no zero divisor, negative arithmetic or overflow. These are deliberate beginner-domain proposals, not assertions that the original source supplied these guarantees.

Text tasks use valid UTF-8. StrLen counts runes, not bytes or grapheme clusters. StrRev reverses logical rune order, not an arbitrary script's visual reading order. Both bound length to32 runes. Initial reversal fixtures use ordinary Latin/Arabic letters without combining marks or joined emoji.

BasicAtoi accepts only valid nonempty ASCII-digit strings of length1–8. BasicAtoi2 accepts valid UTF-8 strings of length0–8 runes and returns0 unless every rune is an ASCII digit and input nonempty. Atoi keeps that short domain and permits one optional leading sign followed by at least one digit. Empty input, spaces, signs alone/repeated/non-leading, and non-ASCII digits are invalid. Valid values fit32-bit int. No hidden overflow cases.

Iteration/manual conversion/reversal are explicit learning constraints; no complete parser or reversal helper substitutes for the activity. A restriction scanner or exact allowlist has not been implemented. The standard library itself is not banned.

## Review and workload boundaries

Five template categories and9 activity-specific prompt examples are supplied, not a production-sized variant bank. Preserve the agreed release/mastery separation and automatic assignment design without claiming features tested. At60 learners/3 mentors, one round is60 reviews or20 each on average if evenly split; actual turnaround depends on measured review time and resubmissions. Do not turn every non-scored bridge into an extra review gate by default.

## Verified short references

Opened on29 October2026:
- https://go.dev/blog/strings — short sections on strings/runes/range; not a full mandatory article.
- https://go.dev/ref/spec#Pointer_types — mentor reference; beginner explanation remains a diagram.
- https://go.dev/blog/slices-intro — introductory declarations/indexing only; internals deferred.
- https://pkg.go.dev/strconv#Atoi — inspected as an instructor reference: standard function returns(int,error), unlike these educational int-only functions. It is not assigned as a solution to copy and is not in the learner reading list.

No video, unsafe setup commands or dependency-specific resources added. No repository import, push, schedule change, test implementation, grade/XP/retry rule or publication. Original repository had no LICENSE file in the audited tree; publication/provenance review remains separate.

