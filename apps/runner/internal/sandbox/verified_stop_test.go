package sandbox

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeTransport func(*http.Request) (*http.Response, error)

func (f fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func scopedEngine(transport fakeTransport) *Engine {
	return &Engine{Purpose: VisibleRunPurpose, Job: "00000000-0000-4000-8000-000000000001", Attempt: "00000000-0000-8000-8000-000000000002", HTTP: &http.Client{Transport: transport}}
}
func TestCloseVerifiedRequiresIndependentAbsentInspection(t *testing.T) {
	for _, status := range []int{404, 200, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			e := scopedEngine(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method == "DELETE" {
					return nil, errors.New("ambiguous delete acknowledgement")
				}
				return response(status, `{}`), nil
			})
			err := (&Container{E: e, ID: strings.Repeat("a", 64)}).CloseVerified(context.Background())
			if (err == nil) != (status == 404) || calls != 2 {
				t.Fatal("deletion acknowledgement mistaken for stop proof")
			}
		})
	}
}
func TestCloseJobVerifiedUsesOnlyExactPublicExecutionLabels(t *testing.T) {
	lists, deletes := 0, 0
	e := scopedEngine(nil)
	e.HTTP.Transport = fakeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/containers/json" {
			lists++
			var filters map[string][]string
			if json.Unmarshal([]byte(r.URL.Query().Get("filters")), &filters) != nil || len(filters) != 1 || len(filters["label"]) != 3 {
				t.Fatal("cleanup filters broadened")
			}
			all := strings.Join(filters["label"], "|")
			for _, v := range []string{"nextera.purpose=" + VisibleRunPurpose, "nextera.job=" + e.Job, "nextera.attempt=" + e.Attempt} {
				if !strings.Contains(all, v) {
					t.Fatal("cleanup lost identity fence")
				}
			}
			if lists > 1 {
				return response(200, `[]`), nil
			}
			raw, _ := json.Marshal([]map[string]any{{"Id": strings.Repeat("a", 64), "Labels": map[string]string{"nextera.purpose": VisibleRunPurpose, "nextera.job": e.Job, "nextera.attempt": e.Attempt}}})
			return response(200, string(raw)), nil
		}
		if r.Method == "DELETE" {
			deletes++
			return response(204, ``), nil
		}
		return response(404, `{}`), nil
	})
	ids, err := e.CloseJobVerified(context.Background())
	if err != nil || len(ids) != 1 || deletes != 1 || lists != 2 {
		t.Fatal("exact-scope delete/relist not proven")
	}
}
func TestCleanupRejectsWrongScopeMalformedListAndSurvivors(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `[{"Id":"bad","Labels":{}}]`, `[{"Id":"` + strings.Repeat("a", 64) + `","Labels":{"nextera.purpose":"foundation004-judge"}}]`} {
		e := scopedEngine(func(r *http.Request) (*http.Response, error) {
			if r.Method != "GET" {
				t.Fatal("unverified container deleted")
			}
			return response(200, body), nil
		})
		if _, err := e.CloseJobVerified(context.Background()); err == nil {
			t.Fatal("malformed or foreign cleanup list accepted")
		}
	}
	e := scopedEngine(func(*http.Request) (*http.Response, error) {
		t.Fatal("wrong namespace reached transport")
		return nil, nil
	})
	e.Purpose = "foundation004-judge"
	if _, err := e.CloseJobVerified(context.Background()); err == nil {
		t.Fatal("graded namespace accepted")
	}
	e = scopedEngine(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/containers/json" {
			raw, _ := json.Marshal([]map[string]any{{"Id": strings.Repeat("a", 64), "Labels": map[string]string{"nextera.purpose": VisibleRunPurpose, "nextera.job": "00000000-0000-4000-8000-000000000001", "nextera.attempt": "00000000-0000-8000-8000-000000000002"}}})
			return response(200, string(raw)), nil
		}
		if r.Method == "DELETE" {
			return response(204, ``), nil
		}
		return response(404, `{}`), nil
	})
	if _, err := e.CloseJobVerified(context.Background()); err == nil {
		t.Fatal("surviving owned container produced proof")
	}
}
func TestPurposeDefaultRemainsOfficialAndUnknownIsRejected(t *testing.T) {
	for _, value := range []string{"", "foundation004-judge", VisibleRunPurpose, "arbitrary"} {
		e := &Engine{Purpose: value}
		purpose, ok := e.purpose()
		if value == "arbitrary" {
			if ok {
				t.Fatal("arbitrary namespace accepted")
			}
		} else if !ok || purpose == "" || (value == "" && purpose != "foundation004-judge") {
			t.Fatal("official default changed")
		}
	}
}

func TestPublicScopeCannotUseBroadJudgeCleanup(t *testing.T) {
	e := scopedEngine(func(*http.Request) (*http.Response, error) {
		t.Fatal("public scope reached broad cleanup transport")
		return nil, nil
	})
	if e.Cleanup(context.Background()) == nil {
		t.Fatal("public broad cleanup accepted")
	}
}
