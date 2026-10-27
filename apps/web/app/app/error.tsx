'use client';
import { AccessRecovery } from '../../components/learning/access-surface';
export default function LearningError({ reset }: { reset(): void }) {
  return <AccessRecovery kind="workspace" onRetry={reset} />;
}
