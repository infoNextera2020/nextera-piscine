/*
README - required submission information
Local run command: go run main.go
Team of three: TODO - list your actual assigned team members.
Checks actually performed: TODO - record inputs and observations honestly.
Unresolved issues: TODO - state any remaining issue.
Use invented account data only. Never include real financial information.

STARTER ONLY: the supplied helpers are complete; the ATM logic is your task.
This empty main is not a working ATM or an automatic grading result.
*/

package main

import (
	"bufio"
	"encoding/json"
	"os"
)

// Provided input adapter. Keep one scanner for the whole program.
var inputScanner = bufio.NewScanner(os.Stdin)

// ReadLine returns one line without its line ending.
// ok is false when input ends or cannot be read: stop, do not retry forever.
// A blank line is "", true; spaces in a line are preserved.
func ReadLine() (line string, ok bool) {
	if !inputScanner.Scan() {
		return "", false
	}
	return inputScanner.Text(), true
}

// Report writes one structured observation. Human messages belong on os.Stderr.
// Use nil only before login, for a rejected PIN or the end of an unauthenticated session.
// This helper serializes observations; the independent model checks their correctness.
func Report(event string, balance *int) {
	switch event {
	case "menu", "amount", "balance", "accepted", "rejected", "end":
	default:
		panic("Report: unknown event")
	}
	if balance == nil {
		if event != "rejected" && event != "end" {
			panic("Report: this event requires the current balance")
		}
	} else if *balance < 0 || *balance > 10000 {
		panic("Report: balance outside the task range")
	}
	if err := json.NewEncoder(os.Stdout).Encode([2]any{event, balance}); err != nil {
		panic("Report: stdout unavailable")
	}
}

func main() {
	// TODO: implement the brief's login, menu, validation and balance changes.
	// TODO: use the exact supplied ReadLine helper at every prompt.
	// TODO: print human prompts/explanations to os.Stderr; use Report for stdout.
	// TODO: Report("end", nil) before ending without login, or
	//       Report("end", &balance) before ending after login, including EOF at an amount.
}
