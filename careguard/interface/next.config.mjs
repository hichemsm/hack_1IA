/** @type {import('next').NextConfig} */
const nextConfig = {
  // core et bridge sont livrés en TypeScript source dans le monorepo
  transpilePackages: ["@careguard/core", "@careguard/bridge"],
};

export default nextConfig;
