/*
README - required submission information
Local run command: go run main.go
Team of three: TODO - record the actual assigned team members.
Checks actually performed: TODO - list inputs, observed balances and exit behavior.
Unresolved issues: TODO - state any remaining issue honestly; do not claim unrun checks.
Use only invented account data. Never put real financial information in this file.

SOURCE PROPOSAL SCAFFOLD ONLY: the ATM behavior below is not implemented.
This file is not a working ATM solution, submitted attempt or grading result.
*/

package main

import (
	"bufio"
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

// Add the team's ATM functions here. If needed, extend the import list above.
// Keep the supplied inputScanner declaration and ReadLine helper unchanged.
func main() {
	// TODO: implement the approved brief's login, menu, validation and state changes.
	// TODO: use ReadLine at every prompt; false ends without a pending transaction.
}
