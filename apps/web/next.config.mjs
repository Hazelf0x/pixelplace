/** @type {import('next').NextConfig} */
const nextConfig = {
  // The DSL engine is a workspace package; let Next process it through its pipeline.
  transpilePackages: ['@pixelplace/pixelcraft']
}

export default nextConfig
