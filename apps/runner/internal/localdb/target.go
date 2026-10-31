// Package localdb confines the current local-fixtures CLI deployment.
// It freezes pgx's effective target; validation never opens a connection.
package localdb

import (
	"errors"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrTarget = errors.New("LOCAL_FIXTURE_TARGET_UNAVAILABLE")
var databasePattern = regexp.MustCompile(`^foundation_test(?:_[a-z0-9_]+)?$`)
var portPattern = regexp.MustCompile(`^[1-9][0-9]{0,4}$`)

type Target struct {
	Host     string `json:"host"`
	Port     uint16 `json:"port"`
	Database string `json:"database"`
}
type configParser func(string, pgx.ParseConfigOptions) (*pgx.ConnConfig, error)
type environmentLookup func(string) (string, bool)

// Parse requires an explicit numeric port. Previously accepted URLs relying on
// PGPORT/default ports are intentionally unavailable in this local-only CLI.
// Keywords, sockets, service files and routing overrides are outside its scope.
func Parse(raw string) (*pgx.ConnConfig, Target, error) {
	return parse(raw, os.LookupEnv, pgx.ParseConfigWithOptions)
}
func parse(raw string, lookup environmentLookup, parser configParser) (*pgx.ConnConfig, Target, error) {
	var target Target
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Opaque != "" || u.Fragment != "" || u.RawPath != "" ||
		u.User == nil || u.User.Username() == "" || strings.ContainsRune(raw, 0) {
		return nil, target, ErrTarget
	}
	host := u.Hostname()
	port := u.Port()
	if (host != "127.0.0.1" && host != "localhost") || !portPattern.MatchString(port) ||
		u.Host != host+":"+port || !strings.HasPrefix(u.Path, "/") || !databasePattern.MatchString(strings.TrimPrefix(u.Path, "/")) {
		return nil, target, ErrTarget
	}
	number, err := strconv.ParseUint(port, 10, 16)
	if err != nil || number == 0 {
		return nil, target, ErrTarget
	}
	target = Target{Host: host, Port: uint16(number), Database: strings.TrimPrefix(u.Path, "/")}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return nil, Target{}, ErrTarget
	}
	for name, values := range query {
		if len(values) != 1 || values[0] == "" {
			return nil, Target{}, ErrTarget
		}
		switch name {
		case "sslmode", "connect_timeout", "application_name":
		default:
			return nil, Target{}, ErrTarget
		}
	}
	// Explicit URL host/port/database/user override ambient target defaults. Other
	// ambient services, startup options, auth files or TLS files are not adopted.
	for _, name := range []string{"PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGSSLKEY", "PGSSLCERT", "PGSSLROOTCERT", "PGSSLPASSWORD", "PGSSLMODE",
		"PGSSLNEGOTIATION", "PGSSLSNI", "PGTARGETSESSIONATTRS", "PGOPTIONS", "PGMINPROTOCOLVERSION", "PGMAXPROTOCOLVERSION", "PGCHANNELBINDING", "PGREQUIREAUTH"} {
		if value, present := lookup(name); present && value != "" {
			return nil, Target{}, ErrTarget
		}
	}
	password, _ := u.User.Password()
	if password == "" {
		if value, present := lookup("PGPASSWORD"); present && value != "" {
			return nil, Target{}, ErrTarget
		}
	}
	// A placeholder prevents pgx from consulting PGPASSWORD or .pgpass when the
	// declared URL has no password. Restore the declared (possibly empty) value
	// on the frozen config; ConnectConfig never reparses the URI/environment.
	parsedURL := *u
	if password == "" {
		parsedURL.User = url.UserPassword(u.User.Username(), "local-validation-placeholder")
	}
	allowed := []string{"host", "port", "database", "user", "password", "sslmode", "connect_timeout", "application_name"}
	if query.Get("sslmode") == "disable" {
		// TLS is already explicitly disabled; suppress even implicit CA/client-file
		// contents during parsing without changing the selected protection mode.
		query.Set("sslrootcert", "")
		query.Set("sslcert", "")
		query.Set("sslkey", "")
		allowed = append(allowed, "sslrootcert", "sslcert", "sslkey")
	}
	parsedURL.RawQuery = query.Encode()
	config, err := parser(parsedURL.String(), pgx.ParseConfigOptions{ParseConfigOptions: pgconn.ParseConfigOptions{ConnStringAllowedKeys: allowed}})
	if err != nil || config == nil || config.User != u.User.Username() || Check(config, target) != nil {
		return nil, Target{}, ErrTarget
	}
	config.Password = password
	return config.Copy(), target, nil
}

// Check includes TLS fallback entries. No fallback may redirect a connection
// to another host, port, database, socket or implicitly configured target.
func Check(config *pgx.ConnConfig, target Target) error {
	if config == nil || config.Host != target.Host || config.Port != target.Port || config.Database != target.Database ||
		(target.Host != "127.0.0.1" && target.Host != "localhost") || target.Port == 0 || !databasePattern.MatchString(target.Database) {
		return ErrTarget
	}
	for _, fallback := range config.Fallbacks {
		if fallback == nil || fallback.Host != target.Host || fallback.Port != target.Port {
			return ErrTarget
		}
	}
	return nil
}
