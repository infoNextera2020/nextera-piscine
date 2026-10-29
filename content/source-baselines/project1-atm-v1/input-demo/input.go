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
