'use client';
import { AccessRecovery } from '../../components/learning/access-surface';
export default function LoginError({ reset }: { reset(): void }) {
  return <AccessRecovery kind="login" onRetry={reset} />;
}
