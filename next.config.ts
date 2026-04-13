import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    // ビルド時のESLintエラー（anyの使用など）を無視する
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ビルド時のTypeScript型エラーを無視する
    ignoreBuildErrors: true,
  },
};

export default nextConfig;