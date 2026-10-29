import { readRaidQueue } from '@nextera/db/raids';
import { authorizePage, getDatabase } from '../../lib/auth/server';
import { AdminOverview, MentorOverview } from '../../components/operator/staff-overview';
import { StaffShell } from '../../components/operator/staff-shell';

export default async function OperatorPage() {
  const user = await authorizePage(['operator', 'admin']);
  const queue = await readRaidQueue(getDatabase(), user.authUserId).catch(() => null);
  return (
    <StaffShell
      user={{ displayName: user.displayName, role: user.role === 'admin' ? 'admin' : 'operator' }}
      active={user.role === 'admin' ? 'overview' : 'reviews'}
    >
      {user.role === 'admin' ? <AdminOverview queue={queue} /> : <MentorOverview queue={queue} />}
    </StaffShell>
  );
}
