'use client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { CheckpointEditorSession } from './editor-session';
import { loadCheckpointEditor } from './editor-bootstrap';
import { sendDraftIntent } from './editor-sync';
import { EditorRecoveryStore } from './editor-recovery';
export function useEditorSession(input: {
  learnerId?: string | undefined;
  cohortId: string;
  attemptId: string;
  selected: string;
  paused: boolean;
  expired: boolean;
  serverNow: string;
  deadline: string;
  active: boolean;
  onAccessRemoved(): void;
}) {
  const {
    learnerId,
    cohortId,
    attemptId,
    selected,
    paused,
    expired,
    serverNow,
    deadline,
    active,
    onAccessRemoved,
  } = input;
  const session = useMemo(
    () =>
      new CheckpointEditorSession(
        { learnerId: learnerId ?? '', cohortId, attemptId },
        {
          now: () => performance.now(),
          requestId: () => crypto.randomUUID(),
          load: loadCheckpointEditor,
          write: sendDraftIntent,
          schedule: (fn) => setTimeout(fn, 800),
          cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
          recovery: new EditorRecoveryStore(() => localStorage),
          accessRemoved: onAccessRemoved,
        },
      ),
    [learnerId, cohortId, attemptId, onAccessRemoved],
  );
  const drafts = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);
  useEffect(() => {
    session.setAvailability(paused, expired, { serverNow, deadline, active });
  }, [session, paused, expired, serverNow, deadline, active]);
  useEffect(() => {
    if (learnerId && selected) void session.load(selected);
  }, [session, learnerId, selected]);
  useEffect(() => {
    const reconnect = () => {
      if (learnerId && selected) void session.load(selected, true);
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [session, learnerId, selected]);
  return { session, drafts };
}
