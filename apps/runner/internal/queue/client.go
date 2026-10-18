// Package queue exposes only the six worker operations in ADR-008.
package queue

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"nextera.local/runner/internal/protocol"
	"time"
)

type Client struct{ URL string }

// Each short call owns its connection. No transaction/connection spans sandbox execution.
func (c Client) call(ctx context.Context, query string, args ...any) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, c.URL)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())
	var data []byte
	err = conn.QueryRow(ctx, query, args...).Scan(&data)
	return data, err
}
func (c Client) Claim(ctx context.Context) (*protocol.Claim, error) {
	b, e := c.call(ctx, "SELECT judge.claim_job()")
	if e != nil || len(b) == 0 {
		return nil, e
	}
	var claim protocol.Claim
	if e = json.Unmarshal(b, &claim); e != nil {
		return nil, e
	}
	return &claim, nil
}
func (c Client) op(ctx context.Context, query string, cl *protocol.Claim, extra ...any) error {
	args := []any{cl.Job, cl.Attempt, cl.Token, cl.Generation}
	args = append(args, extra...)
	_, e := c.call(ctx, query, args...)
	return e
}
func (c Client) Renew(ctx context.Context, cl *protocol.Claim) error {
	return c.op(ctx, "SELECT judge.renew_lease($1,$2,$3,$4)::text", cl)
}
func (c Client) Start(ctx context.Context, cl *protocol.Claim) error {
	return c.op(ctx, "SELECT judge.record_execution_attempt($1,$2,$3,$4)::text", cl)
}
func (c Client) Heartbeat(ctx context.Context) error {
	_, e := c.call(ctx, "SELECT judge.heartbeat()::text")
	return e
}
func (c Client) Result(ctx context.Context, cl *protocol.Claim, verdict string, metrics map[string]int64) error {
	b, _ := json.Marshal(metrics)
	return c.op(ctx, "SELECT judge.record_result($1,$2,$3,$4,$5,$6::jsonb)::text", cl, verdict, string(b))
}
func (c Client) Failure(ctx context.Context, cl *protocol.Claim, code string) error {
	return c.op(ctx, "SELECT judge.record_infrastructure_failure($1,$2,$3,$4,$5)::text", cl, code)
}
