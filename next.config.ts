import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    // @ts-ignore - New experimental option in Next.js 15.3.1
    serverExternalPackages: ["next"],
  },
  // @ts-ignore - Webpack config parameter needs type annotation
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      layers: true,
    };
    return config;
  },
};

export default nextConfig;
