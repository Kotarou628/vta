import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* --- 1. HMRのクロスオリジン許可 --- */
  // Next.js 16の開発サーバー(Turbopack)の要求に合わせてここに配置します。
  // 型定義が追いついていないため、@ts-ignore でエラーを回避します。
  // @ts-ignore
  allowedDevOrigins: ['192.168.0.10'],

  /* --- 2. ビルド設定 --- */
  // eslint ブロックは Next.js 16 で廃止されたため削除しました。
  
  typescript: {
    // もし typescript ブロックでも同様のエラーが出る場合は、
    // ここも削除するか、下記のように @ts-ignore を付けてください。
    ignoreBuildErrors: true,
  },
};

export default nextConfig;