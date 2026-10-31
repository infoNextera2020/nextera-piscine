// Package artifact owns the bounded public execution ABI, never product policy.
package artifact

import "regexp"

type ExecutionContract struct {
	Version  int    `json:"version"`
	Item     string `json:"item_key"`
	File     string `json:"learner_file"`
	Function string `json:"function"`
	Input    string `json:"input_type"`
	Output   string `json:"output_type"`
}

var itemPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var filePattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*[.]go$`)
var functionPattern = regexp.MustCompile(`^[A-Z][A-Za-z0-9_]{0,63}$`)

// Legacy contracts preserve the exact two accepted v1 pack bytes. New packs must
// declare a contract verified against their digest-addressed private metadata.
func ContractFor(id string, declared *ExecutionContract) (ExecutionContract, error) {
	if declared == nil {
		switch id {
		case "hello-go-v1":
			return ExecutionContract{1, "hello-go", "hello.go", "Hello", "string", "string"}, nil
		case "even-or-odd-v1":
			return ExecutionContract{1, "even-or-odd", "even_or_odd.go", "EvenOrOdd", "int64", "string"}, nil
		default:
			return ExecutionContract{}, ErrInvalid
		}
	}
	c := *declared
	if len(c.Item) > 100 || !itemPattern.MatchString(c.Item) || len(c.File) > 100 || !filePattern.MatchString(c.File) {
		return ExecutionContract{}, ErrInvalid
	}
	switch c.Version {
	case 1:
		if c.File == "main.go" || !functionPattern.MatchString(c.Function) || (c.Input != "string" && c.Input != "int64") || c.Output != "string" {
			return ExecutionContract{}, ErrInvalid
		}
	case 2:
		if id == "hello-go-v1" || id == "even-or-odd-v1" {
			return ExecutionContract{}, ErrInvalid
		}
		// Single complete Go program. No generated function adapter, wildcard
		// source collection, extra file or implicit stdin/stdout conversion.
		if c.File != "main.go" || c.Function != "" || c.Input != "stdin_utf8" || c.Output != "stdout_utf8_exact" {
			return ExecutionContract{}, ErrInvalid
		}
	case 4:
		if id == "hello-go-v1" || id == "even-or-odd-v1" || c.File != "main.go" || c.Function != "" || c.Input != "stdin_utf8" || c.Output != "atm_report_events_v1" {
			return ExecutionContract{}, ErrInvalid
		}
	case 3:
		if id == "hello-go-v1" || id == "even-or-odd-v1" || c.File == "main.go" || !functionPattern.MatchString(c.Function) {
			return ExecutionContract{}, ErrInvalid
		}
		valid := (c.Input == "int_int" && c.Output == "int") ||
			(c.Input == "pointer_int_int" && c.Output == "pointer_int") ||
			(c.Input == "int_slice_int_int" && c.Output == "int_slice_preserved") ||
			(c.Input == "string" && c.Output == "int") ||
			(c.Input == "int_slice" && c.Output == "int_slice_preserved")
		if !valid {
			return ExecutionContract{}, ErrInvalid
		}
	default:
		return ExecutionContract{}, ErrInvalid
	}
	return c, nil
}
