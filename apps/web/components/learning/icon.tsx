import type { ReactNode } from 'react';
const paths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  map: (
    <>
      <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" />
      <path d="M9 3v16M15 5v16" />
    </>
  ),
  code: (
    <>
      <path d="m7 7-5 5 5 5m10-10 5 5-5 5m-3-13-4 16" />
    </>
  ),
  gate: (
    <>
      <path d="M5 21V5l7-3 7 3v16M9 21V9h6v12M3 21h18" />
      <path d="M11 5h2" />
    </>
  ),
  evidence: (
    <>
      <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v2" />
    </>
  ),
  resource: (
    <>
      <path d="M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-3-2H4Zm16 0h-4a3 3 0 0 0-3 3v15a4 4 0 0 1 3-2h4Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="12" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 6v2" />
    </>
  ),
  close: <path d="m5 5 14 14M5 19 19 5" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  logout: (
    <>
      <path d="M10 3H4v18h6m3-5 5-4-5-4m-5 4h13" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  folder: <path d="M3 6h7l2 2h9v12H3Z" />,
  alert: (
    <>
      <path d="m12 3 10 18H2Z" />
      <path d="M12 9v5m0 3v1" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.evidence}
    </svg>
  );
}
