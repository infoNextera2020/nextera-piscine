// Reporting-only example: fixed sample values, no ATM input or business implementation.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

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
	fmt.Fprintln(os.Stderr, "Reporting example only; this is not an ATM solution.")
	fmt.Fprintln(os.Stderr, "Example: a rejected mock PIN before login.")
	Report("rejected", nil)
	balance := 100
	fmt.Fprintln(os.Stderr, "Example menu: balance, deposit, withdraw, exit.")
	Report("menu", &balance)
	fmt.Fprintln(os.Stderr, "Example: request an amount.")
	Report("amount", &balance)
	// Fixed illustrative value; no parsing, transaction logic or input is implemented.
	balance = 125
	fmt.Fprintln(os.Stderr, "Example: the sample transaction is complete.")
	Report("accepted", &balance)
	Report("menu", &balance)
	fmt.Fprintln(os.Stderr, "Example current balance:", balance)
	Report("balance", &balance)
	Report("menu", &balance)
	fmt.Fprintln(os.Stderr, "Example finished.")
	Report("end", &balance)
}
