/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/ui ships TypeScript source (no build step) so Next compiles it
  // with the app — one less build artefact to keep in sync in the monorepo.
  transpilePackages: ['@fineduc/ui'],
}

export default nextConfig
