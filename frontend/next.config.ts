const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Monorepo: silence "multiple lockfiles" / wrong workspace root during build
  outputFileTracingRoot: path.join(__dirname, '..'),
  /** Wallet stack may live in the workspace root `node_modules`. */
  transpilePackages: [
    '@rainbow-me/rainbowkit',
    'wagmi',
    'viem',
    '@tanstack/react-query',
  ],
};

module.exports = nextConfig;
