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
};

module.exports = nextConfig;
