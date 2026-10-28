import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import '../styles/workspace-tokens.css';

export const metadata: Metadata = {
  title: '01 coding Piscine',
  description: '01 coding Piscine learning portal.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
