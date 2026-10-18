import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGitCurriculum } from '../load';
import { parseEvaluationCatalog, resolveEvaluations } from '../evaluation';

describe('Foundation 003 local candidate publication boundary', () => {
  const candidate = parseEvaluationCatalog(
    readFileSync(new URL('../../../infra/runner/catalog/candidate.json', import.meta.url), 'utf8'),
  );
  const { curriculum } = loadGitCurriculum(fileURLToPath(new URL('../../../', import.meta.url)));
  it('rejects a local candidate wrapper as an approved catalog', () => {
    expect(() => resolveEvaluations(curriculum, candidate)).toThrow(/unknown metadata field/);
  });
  it('rejects unresolved registry references even when the wrapper is removed', () => {
    const inner = (candidate as { catalog: unknown }).catalog;
    expect(() => resolveEvaluations(curriculum, inner)).toThrow();
  });
});
