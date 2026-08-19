/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/ui ships TypeScript source (no build step) so Next compiles it
  // with the app — one less build artefact to keep in sync in the monorepo.
  transpilePackages: ['@fineduc/ui'],

  // French-first (PRD §5). A config-level redirect issues a real 308 rather
  // than rendering a page to bounce the user, which keeps the root out of
  // the index and avoids needing a second root layout just for `/`.
  async redirects() {
    return [{ source: '/', destination: '/fr', permanent: false }]
  },
}

export default nextConfig
