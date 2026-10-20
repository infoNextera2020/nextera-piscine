import type { NodeKind, ProgressState, SubmissionState } from '@nextera/domain';
export type LearningNode = {
  key: string;
  title: string;
  kind: NodeKind;
  questKey: string;
  questTitle: string;
  state: ProgressState | null;
  assessmentState: string | null;
  label: string;
  lockedReason: string | null;
  prerequisites: string[];
  skills: string[];
  href: string | null;
  roadmapHref: string;
  startedAt: string | null;
  unlockedAt: string | null;
  masteredAt: string | null;
};
export type LearningModule = {
  key: string;
  title: string;
  nodes: LearningNode[];
  mastered: number;
  state: ProgressState | null;
  next: LearningNode | null;
};
export type LearningUpdate = {
  id: string;
  title: string;
  detail: string;
  state: SubmissionState | 'mastered' | 'available';
  at: string;
  href: string;
};
export type LearningSubmission = {
  id: string;
  title: string;
  state: SubmissionState;
  at: string;
  href: string;
};
export type LearningOverview = {
  nodes: LearningNode[];
  modules: LearningModule[];
  current: LearningNode | null;
  checkpoint: LearningNode | null;
  checkpointStatus: string | null;
  currentDescription: string | null;
  updates: LearningUpdate[];
  submissions: LearningSubmission[];
  counts: {
    total: number;
    mastered: number;
    challenges: number;
    challengesPassed: number;
    checkpoints: number;
    checkpointsPassed: number;
    projects: number;
    projectsActive: number;
    available: number;
    started: number;
  };
};
