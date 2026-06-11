import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@allsetlabs/forge'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
