package functional

import (
	"context"
	"github.com/jackc/pgx/v5"
	"nextera.local/runner/internal/localdb"
)

// LoadLocal is the current CLI-only boundary. The general publisher remains a
// separately scoped server building block; work/replay require ALL routes to
// match the declared local queue target before any SQL may be sent.
func LoadLocal(path string, getenv func(string) string, target localdb.Target) (*Publisher, error) {
	publisher, err := Load(path, getenv)
	if err != nil {
		return nil, ErrUnavailable
	}
	if publisher.BindLocalFixture(target) != nil {
		return nil, ErrUnavailable
	}
	return publisher, nil
}
func (p *Publisher) BindLocalFixture(target localdb.Target) error {
	if p == nil {
		return ErrUnavailable
	}
	p.localOnly = true
	p.localBound = false
	p.localTarget = nil
	frozen := map[string]*pgx.ConnConfig{}
	for _, raw := range p.routes {
		config, actual, err := localdb.Parse(raw)
		if err != nil || actual != target || localdb.Check(config, target) != nil {
			return ErrUnavailable
		}
		frozen[raw] = config.Copy()
	}
	if len(frozen) == 0 {
		return ErrUnavailable
	}
	p.call = func(ctx context.Context, raw, query string, args ...any) ([]byte, error) {
		config := frozen[raw]
		if config == nil {
			return nil, ErrUnavailable
		}
		return callFrozenSQL(ctx, config.Copy(), query, args...)
	}
	captured := target
	p.localTarget = &captured
	p.localBound = true
	return nil
}

// Target metadata is symmetric: local CLI envelopes must name their original
// exact target, and generic publishers cannot reopen a target-bound envelope.
// No DSN, user/password or evidence-domain field is added to the outbox.
func (p *Publisher) matchesLocalTarget(target *localdb.Target) error {
	if p == nil {
		return ErrUnavailable
	}
	if p.localOnly {
		if !p.localBound || p.localTarget == nil || target == nil || *target != *p.localTarget {
			return ErrUnavailable
		}
		return nil
	}
	if target != nil {
		return ErrUnavailable
	}
	return nil
}
