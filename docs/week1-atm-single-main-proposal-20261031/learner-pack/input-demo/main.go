package main

import "fmt"

// Input-only demonstration: no login, amount parser or account operations.
func main() {
	fmt.Println("Type any practice word, then press Enter:")
	line, ok := ReadLine()
	if !ok {
		fmt.Println("Input unavailable; demonstration ended.")
		return
	}
	fmt.Printf("Received: %q\n", line)
}
