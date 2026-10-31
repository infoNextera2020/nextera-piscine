// Package atm implements the approved host-only finite observation model.
// It never runs, rewrites or trusts learner code, and does not award mastery.
package atm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"unicode/utf8"
)

const SemanticProfileDigest = "f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007"
const ModelID = "atm-independent-model-v1"

var ErrInput = errors.New("ATM_CASE_OUTSIDE_APPROVED_INPUT")
var ErrProjection = errors.New("ATM_PROJECTION_MISMATCH")

type Event struct {
	Kind    string
	Balance *int
}

func OutputBytes(events []Event) int {
	n := 0
	for _, event := range events {
		record, _ := json.Marshal([2]any{event.Kind, event.Balance})
		n += len(record) + 1
	}
	return n
}

// Expected validates even unused trailing input before deriving the trace.
// maximumOutputBytes is the existing aggregate output budget, not a new limit.
func Expected(stdin []byte, maximumOutputBytes int) ([]Event, error) {
	return ExpectedContext(context.Background(), stdin, maximumOutputBytes)
}
func eachLine(stdin []byte, visit func([]byte) error) error {
	for start := 0; start < len(stdin); {
		end := bytes.IndexByte(stdin[start:], '\n')
		next := len(stdin)
		if end < 0 {
			end = len(stdin)
		} else {
			end += start
			next = end + 1
		}
		line := stdin[start:end]
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		if err := visit(line); err != nil {
			return err
		}
		start = next
	}
	return nil
}
func ExpectedContext(ctx context.Context, stdin []byte, maximumOutputBytes int) ([]Event, error) {
	if !utf8.Valid(stdin) || maximumOutputBytes <= 0 {
		return nil, ErrInput
	}
	if err := eachLine(stdin, func(line []byte) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if utf8.RuneCount(line) > 20 {
			return ErrInput
		}
		return nil
	}); err != nil {
		return nil, err
	}
	var events []Event
	outputBytes := 0
	balance, failures, phase := 100, 0, "pin"
	authenticated := false
	appendEvent := func(kind string, withBalance bool) error {
		var value *int
		if withBalance {
			n := balance
			value = &n
		}
		encoded, _ := json.Marshal([2]any{kind, value})
		outputBytes += len(encoded) + 1
		if outputBytes > maximumOutputBytes {
			return ErrInput
		}
		events = append(events, Event{kind, value})
		return nil
	}
	processErr := eachLine(stdin, func(line []byte) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if phase == "end" {
			return nil
		}
		if phase == "pin" {
			if bytes.Equal(line, []byte("0427")) {
				authenticated, phase = true, "menu"
				if appendEvent("menu", true) != nil {
					return ErrInput
				}
			} else {
				failures++
				if appendEvent("rejected", false) != nil {
					return ErrInput
				}
				if failures == 3 {
					phase = "end"
					if appendEvent("end", false) != nil {
						return ErrInput
					}
				}
			}
			return nil
		}
		if phase == "menu" {
			switch string(line) {
			case "4":
				phase = "end"
				if appendEvent("end", true) != nil {
					return ErrInput
				}
			case "1":
				if appendEvent("balance", true) != nil {
					return ErrInput
				}
				if appendEvent("menu", true) != nil {
					return ErrInput
				}
			case "2":
				phase = "deposit"
				if appendEvent("amount", true) != nil {
					return ErrInput
				}
			case "3":
				phase = "withdraw"
				if appendEvent("amount", true) != nil {
					return ErrInput
				}
			default:
				if appendEvent("rejected", true) != nil {
					return ErrInput
				}
				if appendEvent("menu", true) != nil {
					return ErrInput
				}
			}
			return nil
		}
		amount, valid := 0, len(line) >= 1 && len(line) <= 5
		for _, c := range line {
			if c < '0' || c > '9' {
				valid = false
				break
			}
			amount = amount*10 + int(c-'0')
		}
		allowed := valid && amount >= 1 && amount <= 1000
		if allowed && phase == "deposit" {
			allowed = balance+amount <= 10000
		}
		if allowed && phase == "withdraw" {
			allowed = amount <= balance
		}
		if allowed {
			if phase == "deposit" {
				balance += amount
			} else {
				balance -= amount
			}
			if appendEvent("accepted", true) != nil {
				return ErrInput
			}
		} else if appendEvent("rejected", true) != nil {
			return ErrInput
		}
		phase = "menu"
		if appendEvent("menu", true) != nil {
			return ErrInput
		}
		return nil
	})
	if processErr != nil {
		return nil, processErr
	}
	if phase != "end" {
		if appendEvent("end", authenticated) != nil {
			return nil, ErrInput
		}
	}
	return events, nil
}

func Parse(stdout []byte) ([]Event, error) {
	if !utf8.Valid(stdout) {
		return nil, ErrProjection
	}
	var events []Event
	for _, raw := range bytes.Split(stdout, []byte{'\n'}) {
		line := bytes.Trim(raw, " \t\r")
		if len(line) == 0 {
			continue
		}
		var pair []json.RawMessage
		if json.Unmarshal(line, &pair) != nil || len(pair) != 2 {
			return nil, ErrProjection
		}
		var kind string
		if json.Unmarshal(pair[0], &kind) != nil {
			return nil, ErrProjection
		}
		switch kind {
		case "menu", "amount", "balance", "accepted", "rejected", "end":
		default:
			return nil, ErrProjection
		}
		value := bytes.TrimSpace(pair[1])
		var balance *int
		if !bytes.Equal(value, []byte("null")) {
			// JSON integers only: bools, decimal/exponent forms and strings fail.
			n, err := strconv.ParseInt(string(value), 10, 32)
			if err != nil || n < 0 || n > 10000 {
				return nil, ErrProjection
			}
			v := int(n)
			balance = &v
		} else if kind != "rejected" && kind != "end" {
			return nil, ErrProjection
		}
		events = append(events, Event{kind, balance})
	}
	return events, nil
}

func Match(stdin, stdout []byte, maximumEvents int) (bool, error) {
	return MatchContext(context.Background(), stdin, stdout, maximumEvents)
}
func MatchContext(ctx context.Context, stdin, stdout []byte, maximumOutputBytes int) (bool, error) {
	expected, err := ExpectedContext(ctx, stdin, maximumOutputBytes)
	if err != nil {
		return false, err
	}
	actual, err := Parse(stdout)
	if err != nil {
		return false, err
	}
	if len(expected) != len(actual) {
		return false, nil
	}
	for i, want := range expected {
		got := actual[i]
		if got.Kind != want.Kind || (got.Balance == nil) != (want.Balance == nil) {
			return false, nil
		}
		if got.Balance != nil && *got.Balance != *want.Balance {
			return false, nil
		}
	}
	return true, nil
}
