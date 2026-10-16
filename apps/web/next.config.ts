import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@nextera/domain', '@nextera/db'],
  poweredByHeader: false,
};

export default nextConfig;
