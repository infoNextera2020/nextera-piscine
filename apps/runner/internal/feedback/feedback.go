// Package feedback is the entire product-safe result boundary for this milestone.
package feedback

type Safe struct {
	Verdict string `json:"verdict"`
	Message string `json:"message"`
}

// Project intentionally accepts no diagnostics, case names, output, or paths.
func Project(verdict string) Safe {
	messages := map[string]string{
		"passed":        "All required checks passed.",
		"failed":        "Required checks did not pass.",
		"compile_error": "The solution could not be compiled within the required profile.",
		"runtime_error": "The solution could not complete within the required profile.",
		"timeout":       "The solution exceeded the execution time limit.",
		"system_error":  "Evaluation infrastructure could not verify or complete this attempt.",
	}
	m, ok := messages[verdict]
	if !ok {
		verdict = "system_error"
		m = messages[verdict]
	}
	return Safe{verdict, m}
}
