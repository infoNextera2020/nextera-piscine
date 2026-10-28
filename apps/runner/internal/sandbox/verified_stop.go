package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"sort"
)

const VisibleRunPurpose = "nextera-visible-run-v1"

func (e *Engine) purpose() (string, bool) {
	if e.Purpose == "" || e.Purpose == "foundation004-judge" {
		return "foundation004-judge", true
	}
	if e.Purpose == VisibleRunPurpose {
		return VisibleRunPurpose, true
	}
	return "", false
}

var containerID = regexp.MustCompile(`^[0-9a-f]{64}$`)
var identityID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// CloseVerified never treats a lost DELETE response as proof. An independent
// inspection must observe 404 before the caller can release execution capacity.
func (c *Container) CloseVerified(ctx context.Context) error {
	if c == nil || c.E == nil || c.E.HTTP == nil || !containerID.MatchString(c.ID) {
		return ErrInfrastructure
	}
	_ = c.E.API(ctx, "DELETE", "/containers/"+c.ID+"?force=true&v=true", nil, nil)
	req, err := http.NewRequestWithContext(ctx, "GET", "http://docker/containers/"+c.ID+"/json", nil)
	if err != nil {
		return ErrInfrastructure
	}
	resp, err := c.E.HTTP.Do(req)
	if err != nil {
		return ErrInfrastructure
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		return ErrInfrastructure
	}
	return nil
}

// CloseJobVerified is restricted to the visible-run namespace and exact owned
// run/execution labels. It includes containers whose IDs were lost on creation.
// Callers must still withhold proof after an ambiguous in-flight Create request.
func (e *Engine) CloseJobVerified(ctx context.Context) ([]string, error) {
	if e == nil || e.HTTP == nil || e.Purpose != VisibleRunPurpose || !identityID.MatchString(e.Job) || !identityID.MatchString(e.Attempt) {
		return nil, ErrInfrastructure
	}
	filters, _ := json.Marshal(map[string][]string{"label": {"nextera.purpose=" + VisibleRunPurpose, "nextera.job=" + e.Job, "nextera.attempt=" + e.Attempt}})
	query := "/containers/json?all=true&filters=" + url.QueryEscape(string(filters))
	type row struct {
		ID     string `json:"Id"`
		Labels map[string]string
	}
	read := func() ([]row, error) {
		var raw json.RawMessage
		var rows []row
		if e.API(ctx, "GET", query, nil, &raw) != nil || len(bytes.TrimSpace(raw)) < 2 || bytes.TrimSpace(raw)[0] != '[' || json.Unmarshal(raw, &rows) != nil {
			return nil, ErrInfrastructure
		}
		for _, c := range rows {
			if !containerID.MatchString(c.ID) || c.Labels["nextera.purpose"] != VisibleRunPurpose || c.Labels["nextera.job"] != e.Job || c.Labels["nextera.attempt"] != e.Attempt {
				return nil, ErrInfrastructure
			}
		}
		return rows, nil
	}
	rows, err := read()
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, c := range rows {
		if (&Container{E: e, ID: c.ID}).CloseVerified(ctx) != nil {
			return nil, ErrInfrastructure
		}
		ids = append(ids, c.ID)
	}
	remaining, err := read()
	if err != nil || len(remaining) != 0 {
		return nil, ErrInfrastructure
	}
	sort.Strings(ids)
	return ids, nil
}
