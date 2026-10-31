package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func localPublisherConfiguration(t *testing.T) string {
	t.Helper()
	directory := filepath.Join(t.TempDir(), "receipts")
	if os.Mkdir(directory, 0700) != nil {
		t.Fatal("fixture")
	}
	config := map[string]any{"version": 1, "routes": []any{map[string]any{"evaluatorDigest": strings.Repeat("1", 64), "databaseEnvironment": "NEXTERA_EXAM_FUNCTIONAL_UNIT_DSN"}},
		"receiptDirectory": directory, "maxObjects": 3, "maxBytes": 262144, "maxEnvelopeBytes": 65536, "publicationTimeoutMs": 1000}
	raw, _ := json.Marshal(config)
	path := filepath.Join(t.TempDir(), "config.json")
	if os.WriteFile(path, raw, 0600) != nil {
		t.Fatal("fixture")
	}
	return path
}
func TestLocalCLIGatesQueueBeforePublisherConfigurationOrSQL(t *testing.T) {
	for _, local := range []bool{false, true} {
		calls := 0
		queue, publisher, err := localConnections(local, "never-read-config", func(name string) string {
			calls++
			if name == "JUDGE_DATABASE_URL" {
				return "postgres://queue:synthetic@remote.example:5432/production"
			}
			t.Fatal("publisher/credential loaded before queue gate")
			return ""
		})
		if err == nil || queue != nil || publisher != nil || (!local && calls != 0) || (local && calls != 1) {
			t.Fatal("CLI target gate order changed")
		}
	}
}
func TestWorkAndReplayShareAllRouteSameLocalTargetValidation(t *testing.T) {
	path := localPublisherConfiguration(t)
	queueURL := "postgres://queue:synthetic-queue@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	good := "postgres://restricted_evaluator:synthetic-evaluator@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	for _, route := range []string{
		"postgres://restricted_evaluator:synthetic@remote.example:5432/foundation_test_unit?sslmode=disable",
		"postgres://restricted_evaluator:synthetic@127.0.0.1:6432/foundation_test_unit?sslmode=disable",
		"postgres://restricted_evaluator:synthetic@127.0.0.1:5432/foundation_test_other?sslmode=disable",
		"postgres://restricted_evaluator:synthetic@localhost:5432/foundation_test_unit?sslmode=disable",
		good + "&host=remote.example", good + "&port=6432", good + "&dbname=production", good + "&service=forbidden",
		"host=127.0.0.1 port=5432 dbname=foundation_test_unit user=evaluator",
		"postgres://restricted_evaluator:synthetic@127.0.0.1/foundation_test_unit?sslmode=disable",
	} {
		config, publisher, err := localConnections(true, path, func(name string) string {
			if name == "JUDGE_DATABASE_URL" {
				return queueURL
			}
			return route
		})
		if err == nil || config != nil || publisher != nil {
			t.Fatal("cross-target publisher could reach CLI SQL")
		}
	}
	config, publisher, err := localConnections(true, path, func(name string) string {
		if name == "JUDGE_DATABASE_URL" {
			return queueURL
		}
		return good
	})
	if err != nil || config.User != "queue" || config.Password != "synthetic-queue" || publisher == nil {
		t.Fatal("separate-principal matching target denied", err)
	}
	if functionalReplay([]string{"--publisher-config", path, "--operation", "00000000-0000-0000-0000-000000000001"}) == nil {
		t.Fatal("replay bypassed explicit local-fixtures gate")
	}
}
