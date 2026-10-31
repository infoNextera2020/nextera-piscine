'use client';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { SubmissionIntents } from '../submissions/retry-intent';
import type { MixedCheckpointAnswer } from './checkpoint-answer';
import { CheckpointMixedAnswerSession } from './answer-session';

export function useCheckpointMixedAnswerSession(input: {
  learnerId: string;
  cohortId: string;
  attemptId: string;
  selected: null | { key: string; kind: MixedCheckpointAnswer['kind'] };
  paused: boolean;
  closed: boolean;
  serverNow: string;
  deadline: string;
  newSubmitAllowed: boolean;
  onAccessRemoved(): void;
}) {
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const latest = useRef(input);
  latest.current = input;
  const { learnerId, cohortId, attemptId } = input;
  const session = useMemo(
    () =>
      new CheckpointMixedAnswerSession(
        { learnerId, cohortId, attemptId },
        {
          send: (...args) => fetch(...args),
          now: () => performance.now(),
          requestId: () => crypto.randomUUID(),
          intents: new SubmissionIntents(() => sessionStorage),
          changed,
          accessRemoved: () => {
            const current = latest.current;
            if (
              current.learnerId === learnerId &&
              current.cohortId === cohortId &&
              current.attemptId === attemptId
            )
              current.onAccessRemoved();
          },
        },
      ),
    [learnerId, cohortId, attemptId, changed],
  );
  useEffect(() => {
    session.mount();
    return () => session.dispose();
  }, [session]);
  const selectedKey = input.selected?.key,
    selectedKind = input.selected?.kind;
  useEffect(() => {
    session.updateWindow(input.paused, input.closed, input.serverNow, input.deadline);
    if (selectedKey && selectedKind && !input.paused && !input.closed) {
      session.setSubmitCapability(selectedKey, input.newSubmitAllowed);
      void session.load(selectedKey, selectedKind).then(() => {
        const current = latest.current;
        if (current.selected?.key === selectedKey && current.selected.kind === selectedKind)
          session.setSubmitCapability(selectedKey, current.newSubmitAllowed);
      });
    }
  }, [
    session,
    input.paused,
    input.closed,
    input.serverNow,
    input.deadline,
    selectedKey,
    selectedKind,
    input.newSubmitAllowed,
  ]);
  return { session, states: session.all() };
}
