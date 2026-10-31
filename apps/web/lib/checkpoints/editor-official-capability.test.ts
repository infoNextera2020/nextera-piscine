import { describe, expect, it, vi } from 'vitest';
import { CheckpointEditorSession } from './editor-session';
import type { EditorBootstrap } from './editor-bootstrap';
const identity = {
  learnerId: '10000000-0000-4000-8000-000000000001',
  cohortId: '10000000-0000-4000-8000-000000000002',
  attemptId: '10000000-0000-4000-8000-000000000003',
};
describe('source editor exposes official capability without conflating it with autosave', () => {
  it.each([true, false])(
    'projects verified officialSubmit=%s independently of draft readiness',
    async (officialSubmit) => {
      const bootstrap: EditorBootstrap = {
        schema: 1,
        filename: 'answer.go',
        sourceBytes: 1024,
        draft: null,
        offlineRecovery: null,
        window: {
          scope: { ...identity, taskKey: 'q1', definitionDigest: 'a'.repeat(64) },
          access: 'confirmed',
          attempt: 'active',
          serverNow: '2026-10-31T10:00:00Z',
          deadline: '2026-10-31T13:00:00Z',
          capabilities: { draftsV1: true, officialSubmit, visibleRun: null },
        },
      };
      const write = vi.fn(async () => ({ kind: 'uncertain' as const, reason: 'network' as const }));
      const session = new CheckpointEditorSession(identity, {
        now: () => 0,
        requestId: () => identity.attemptId,
        load: async () => ({ kind: 'available', bootstrap }),
        write,
        schedule: () => 0,
        cancel: () => {},
        accessRemoved: () => {},
      });
      session.setAvailability(false, false, {
        active: true,
        serverNow: bootstrap.window.serverNow,
        deadline: bootstrap.window.deadline,
      });
      await session.load('q1');
      expect(session.getSnapshot().q1).toMatchObject({ phase: 'ready', officialSubmit });
      expect(write).not.toHaveBeenCalled();
      session.dispose();
    },
  );
});
