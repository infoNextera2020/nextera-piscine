import 'server-only';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import {
  VisibleRunStorageError,
  readVisibleRunAuthority,
  readVisibleRun,
  reserveVisibleRun,
} from '@nextera/db/visible-runs';
import { createVisibleRunBackend } from './visible-run-backend';
import { EditorApiError } from './editor-http';
import { parseVisibleRunPolicy, visiblePolicyDigest } from './visible-run-spec';

/** Prepared/injected only. Importing this factory opens no connection; production wiring stays null. */
export function createPostgresVisibleRunBackend(db: OperationalDatabase) {
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof VisibleRunStorageError) {
        const code =
          e.code === 'forbidden'
            ? 'FORBIDDEN'
            : e.code === 'closed'
              ? 'CLOSED'
              : e.code === 'definition_mismatch'
                ? 'DEFINITION_MISMATCH'
                : e.code === 'idempotency_conflict'
                  ? 'IDEMPOTENCY_CONFLICT'
                  : e.code === 'rate_limited'
                    ? 'RATE_LIMITED'
                    : 'UNAVAILABLE';
        throw new EditorApiError(code);
      }
      throw e;
    }
  }
  return createVisibleRunBackend({
    authority: {
      load(actor, task) {
        return call(async () => {
          const raw = await readVisibleRunAuthority(
            db,
            actor.authUserId,
            task.attemptId,
            task.taskKey,
          );
          if (raw.editor.scope.learnerId !== actor.id) throw new EditorApiError('FORBIDDEN');
          const policy = parseVisibleRunPolicy(raw.policy);
          if (visiblePolicyDigest(policy) !== raw.policyDigest)
            throw new EditorApiError('UNAVAILABLE');
          return { ...raw, policy };
        });
      },
    },
    reservations: {
      reserve(input) {
        return call(() =>
          reserveVisibleRun(db, {
            authId: input.actor.authUserId,
            intent: input.intent,
            intentDigest: input.intentDigest,
          }),
        );
      },
      read(actor, scope, lookup) {
        return call(() => readVisibleRun(db, actor.authUserId, scope, lookup));
      },
    },
  });
}
