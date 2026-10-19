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
	if c.Version != 1 || len(c.Item) > 100 || !itemPattern.MatchString(c.Item) || len(c.File) > 100 || !filePattern.MatchString(c.File) || c.File == "main.go" || !functionPattern.MatchString(c.Function) || (c.Input != "string" && c.Input != "int64") || c.Output != "string" {
		return ExecutionContract{}, ErrInvalid
	}
	return c, nil
}
