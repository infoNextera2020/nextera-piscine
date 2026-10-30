package executor

import (
	"errors"
	"io"
	"net/http"
	"nextera.local/runner/internal/sandbox"
	"strings"
	"testing"
	"time"
)

type gradingStopTransport func(*http.Request) (*http.Response, error)

func (f gradingStopTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGradingRuntimeRequiresIndependentAbsentProof(t *testing.T) {
	for _, test := range []struct {
		name                           string
		deleteStatus, inspectStatus    int
		deleteErr, inspectErr, allowed bool
	}{
		{"verified-delete", 200, 404, false, false, true},
		{"already-absent", 404, 404, false, false, true},
		{"lost-delete-ack-but-absent", 0, 404, true, false, true},
		{"delete-accepted-but-present", 200, 200, false, false, false},
		{"inspection-ambiguous", 200, 0, false, true, false},
		{"both-ambiguous", 0, 0, true, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			id := strings.Repeat("a", 64)
			methods := []string{}
			transport := gradingStopTransport(func(r *http.Request) (*http.Response, error) {
				methods = append(methods, r.Method)
				deadline, bounded := r.Context().Deadline()
				if !bounded || !deadline.After(time.Now()) || deadline.After(time.Now().Add(15*time.Second)) || r.Context().Err() != nil {
					t.Fatal("cleanup request is not independently bounded")
				}
				status, fail := test.deleteStatus, test.deleteErr
				if r.Method == http.MethodDelete {
					if r.URL.Path != "/containers/"+id || r.URL.Query().Get("force") != "true" {
						t.Fatal("wrong owned deletion target")
					}
				} else if r.Method == http.MethodGet {
					if r.URL.Path != "/containers/"+id+"/json" {
						t.Fatal("wrong stop inspection target")
					}
					status, fail = test.inspectStatus, test.inspectErr
				} else {
					t.Fatal("unexpected runtime operation", r.Method)
				}
				if fail {
					return nil, errors.New("unit-only ambiguous API outcome")
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
			})
			container := &sandbox.Container{E: &sandbox.Engine{HTTP: &http.Client{Transport: transport}}, ID: id}
			err := stopGradingPhase(container)
			if (err == nil) != test.allowed || strings.Join(methods, ",") != "DELETE,GET" {
				t.Fatal("absence proof not required", err, methods)
			}
		})
	}
	if stopGradingPhase(nil) == nil {
		t.Fatal("missing phase treated as verified")
	}
}
