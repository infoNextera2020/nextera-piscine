import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import '../styles/workspace-tokens.css';

export const metadata: Metadata = {
  title: 'NextEra Piscine',
  description: 'NextEra Piscine — Vertical Slice 001 foundation.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
