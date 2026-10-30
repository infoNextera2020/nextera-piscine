package executor

import (
	"context"
	"nextera.local/runner/internal/sandbox"
)

type gradingPhase interface {
	Import(context.Context, map[string][]byte) error
	Exec(context.Context, []string, []string, []byte, int) ([]byte, []byte, int, error)
	Close()
}
type gradingEngine interface {
	VerifyImage(context.Context, string) error
	Create(context.Context, string, bool) (gradingPhase, error)
}
type sandboxGradingEngine struct{ engine *sandbox.Engine }

func (e sandboxGradingEngine) VerifyImage(ctx context.Context, image string) error {
	if e.engine == nil {
		return sandbox.ErrInfrastructure
	}
	return e.engine.VerifyImage(ctx, image)
}
func (e sandboxGradingEngine) Create(ctx context.Context, image string, compile bool) (gradingPhase, error) {
	if e.engine == nil {
		return nil, sandbox.ErrInfrastructure
	}
	return e.engine.Create(ctx, image, compile)
}
func (e Executor) runtimeEngine() gradingEngine {
	if e.engine != nil {
		return e.engine
	}
	return sandboxGradingEngine{e.Engine}
}
