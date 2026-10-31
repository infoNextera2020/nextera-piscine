package localdb

import (
	"crypto/tls"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const validURL = "postgres://queue:synthetic-password@127.0.0.1:5432/foundation_test_unit?sslmode=disable"

func noEnvironment(string) (string, bool) { return "", false }
func parsedFixture(raw string, _ pgx.ParseConfigOptions) (*pgx.ConnConfig, error) {
	u, _ := url.Parse(raw)
	return &pgx.ConnConfig{Config: pgconn.Config{Host: u.Hostname(), Port: 5432, Database: strings.TrimPrefix(u.Path, "/"), User: u.User.Username()}}, nil
}
func TestLocalTargetRejectsRoutingBeforeParserOrAnyConnector(t *testing.T) {
	bad := []string{
		"", "host=127.0.0.1 port=5432 dbname=foundation_test_unit user=queue",
		"postgres://queue:pw@remote.example:5432/foundation_test_unit",
		"postgres://queue:pw@127.0.0.1/foundation_test_unit",
		"postgres://queue:pw@127.0.0.1:0/foundation_test_unit",
		"postgres://queue:pw@127.0.0.1:65536/foundation_test_unit",
		"postgres://queue:pw@127.0.0.1:5432/production",
		"postgres://queue:pw@127.0.0.1:5432/",
		"postgres://queue:pw@:5432/foundation_test_unit",
		"postgres://queue:pw@127.0.0.1:5432,remote.example:5432/foundation_test_unit",
		"postgres://queue:pw@%2Ftmp:5432/foundation_test_unit",
		"postgres://queue:pw@[::1]:5432/foundation_test_unit",
		"postgres://127.0.0.1:5432/foundation_test_unit",
		validURL + "#target", validURL + "&sslmode=disable",
	}
	for _, key := range []string{"host", "hostaddr", "port", "dbname", "database", "service", "servicefile", "passfile", "sslcert", "sslkey", "sslrootcert", "options", "user", "password"} {
		bad = append(bad, validURL+"&"+key+"=synthetic-forbidden")
	}
	for _, raw := range bad {
		calls := 0
		_, _, err := parse(raw, noEnvironment, func(s string, o pgx.ParseConfigOptions) (*pgx.ConnConfig, error) { calls++; return parsedFixture(s, o) })
		if err == nil || calls != 0 {
			t.Fatalf("unapproved target reached pgx parser/connector (calls=%d)", calls)
		}
		if strings.Contains(err.Error(), "synthetic-password") || strings.Contains(err.Error(), "remote.example") {
			t.Fatal("DSN/error leaked")
		}
	}
}
func TestLocalTargetValidatesEveryEffectiveFallbackAndPreservesSeparatePrincipals(t *testing.T) {
	for _, mutate := range []func(*pgx.ConnConfig){
		func(c *pgx.ConnConfig) { c.Host = "remote.example" },
		func(c *pgx.ConnConfig) { c.Port = 6432 },
		func(c *pgx.ConnConfig) { c.Database = "production" },
		func(c *pgx.ConnConfig) { c.Fallbacks = []*pgconn.FallbackConfig{{Host: "remote.example", Port: 5432}} },
		func(c *pgx.ConnConfig) { c.Fallbacks = []*pgconn.FallbackConfig{{Host: "127.0.0.1", Port: 6432}} },
		func(c *pgx.ConnConfig) { c.Fallbacks = []*pgconn.FallbackConfig{nil} },
	} {
		_, _, err := parse(validURL, noEnvironment, func(s string, o pgx.ParseConfigOptions) (*pgx.ConnConfig, error) {
			c, _ := parsedFixture(s, o)
			mutate(c)
			return c, nil
		})
		if err == nil {
			t.Fatal("effective pgx routing mismatch/fallback admitted")
		}
	}
	config, target, err := parse(validURL, noEnvironment, func(s string, o pgx.ParseConfigOptions) (*pgx.ConnConfig, error) {
		c, _ := parsedFixture(s, o)
		c.Fallbacks = []*pgconn.FallbackConfig{{Host: c.Host, Port: c.Port}}
		return c, nil
	})
	if err != nil || target != (Target{"127.0.0.1", 5432, "foundation_test_unit"}) || config.User != "queue" || config.Password != "synthetic-password" {
		t.Fatal("explicit local target/credentials changed", err)
	}
}
func TestLocalTargetRejectsAmbientServicesAndPasswordFallbackWithoutReadingFiles(t *testing.T) {
	for _, name := range []string{"PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGSSLKEY", "PGSSLCERT", "PGSSLROOTCERT", "PGOPTIONS", "PGSSLMODE"} {
		calls := 0
		_, _, err := parse(validURL, func(key string) (string, bool) { return "synthetic-forbidden", key == name }, func(s string, o pgx.ParseConfigOptions) (*pgx.ConnConfig, error) { calls++; return parsedFixture(s, o) })
		if err == nil || calls != 0 {
			t.Fatal("ambient service/file configuration reached parser")
		}
	}
	raw := "postgres://queue@127.0.0.1:5432/foundation_test_unit?sslmode=disable"
	if _, _, err := parse(raw, func(key string) (string, bool) { return "synthetic-password", key == "PGPASSWORD" }, parsedFixture); err == nil {
		t.Fatal("undeclared ambient password adopted")
	}
	config, _, err := parse(raw, noEnvironment, func(s string, o pgx.ParseConfigOptions) (*pgx.ConnConfig, error) {
		u, _ := url.Parse(s)
		password, present := u.User.Password()
		if !present || password == "" {
			t.Fatal("pgx could read .pgpass")
		}
		return parsedFixture(s, o)
	})
	if err != nil || config.Password != "" {
		t.Fatal("declared empty/trust password changed")
	}
}
func TestLocalTargetPreservesTLSModeAndIgnoresExplicitlyOverriddenTargetDefaults(t *testing.T) {
	for _, mode := range []string{"disable", "allow", "prefer", "require", "verify-ca", "verify-full"} {
		raw := "postgres://queue:synthetic-password@localhost:5432/foundation_test_unit?sslmode=" + mode
		config, _, err := parse(raw, func(name string) (string, bool) {
			switch name {
			case "PGHOST":
				return "remote.example", true
			case "PGPORT":
				return "9999", true
			case "PGDATABASE":
				return "production", true
			}
			return "", false
		},
			func(s string, o pgx.ParseConfigOptions) (*pgx.ConnConfig, error) {
				u, _ := url.Parse(s)
				if u.Query().Get("sslmode") != mode {
					t.Fatal("TLS mode weakened")
				}
				c, _ := parsedFixture(s, o)
				if mode != "disable" {
					if _, present := u.Query()["sslrootcert"]; present {
						t.Fatal("implicit certificate protection changed")
					}
					c.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
				}
				return c, nil
			})
		if err != nil || (mode != "disable" && config.TLSConfig == nil) {
			t.Fatal("declared TLS config not frozen", mode, err)
		}
	}
}

// The actual authoritative parser smoke uses an explicit disabled-TLS synthetic
// URL and password. It cannot read client keys, CA contents or a passfile.
func TestLocalTargetActualPGXParserAndNoImplicitPort(t *testing.T) {
	config, target, err := Parse(validURL)
	if err != nil {
		t.Fatal("explicit local fixture URL rejected (ambient services/files are unsupported)", err)
	}
	if Check(config, target) != nil || config.TLSConfig != nil || len(config.Fallbacks) != 0 {
		t.Fatal("effective pgx target not fixed")
	}
}
