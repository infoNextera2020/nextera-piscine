import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@nextera/domain', '@nextera/db'],
  poweredByHeader: false,
  // Bound production-build workers on the pilot's small local/CI hosts.
  experimental: { cpus: 2 },
};

export default nextConfig;
