/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
  },
  // Workspace packages ship TypeScript sources with `.js` extension imports
  // (Node ESM / Bun-compatible). Tell Next.js to compile them from source.
  transpilePackages: ['@aldo-ai/api-contract', '@aldo-ai/types'],
  webpack(config) {
    // Resolve `import './foo.js'` to `./foo.ts` source files inside the
    // workspace, matching TypeScript's NodeNext/ESM convention.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
