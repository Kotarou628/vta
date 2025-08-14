// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .eslintrc系の拡張をFlat Configに取り込むための互換ヘルパー
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  // ★ まず無視リストを定義（ビルド成果物・自動生成物はLintしない）
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "out/**",
      "coverage/**",
      "src/generated/**",          // 生成物（Prisma含む）を丸ごと無視
      "src/generated/prisma/**",   // 念のため明示
    ],
  },

  // Next.js の推奨設定 + TypeScript設定
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Flat Config では追加のルールやparserOptionsは別ブロックで上書き
  {
    languageOptions: {
      parserOptions: {
        // 型情報を使う厳しめルールを無効化（プロジェクト参照を要求されるのを避ける）
        project: false,
      },
    },
    rules: {
      // 使っていない引数・変数でも "_" 始まりは許可（Nextのハンドラなどでよく使う）
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // 生成物由来で大量に出る表現系の警告はOFF
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
