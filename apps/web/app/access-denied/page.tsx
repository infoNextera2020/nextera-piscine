import Link from 'next/link';
import { logout } from '../login/actions';
import { AccessSurface } from '../../components/learning/access-surface';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import { accessDeniedState } from '../../lib/learning/access-state';
import s from '../../components/learning/access.module.css';

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const state = accessDeniedState(reason);
  return (
    <AccessSurface>
      <HairlineIcon name="gate" size={38} />
      <p className={s.eyebrow}>Access denied</p>
      <h1>This workspace is unavailable</h1>
      <p className={s.description}>{state.message}</p>
      <p className={s.reason}>{state.code}</p>
      <Link href="/app" className={s.secondary}>
        Return to Home <HairlineIcon name="arrow" />
      </Link>
      <form action={logout}>
        <button className={s.secondary}>
          Sign out <HairlineIcon name="logout" />
        </button>
      </form>
    </AccessSurface>
  );
}
