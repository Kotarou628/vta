// .eslintrc.js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: [
    'next',
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: [
    '.next/**',
    'node_modules/**',
    // ← 生成コードは Lint 対象外
    'src/generated/**',
  ],
  overrides: [
    // .d.ts は型宣言用なので未使用変数を許容
    {
      files: ['**/*.d.ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    // 念のため：もし generated を完全除外しない構成でも、ここで無効化
    {
      files: ['src/generated/**'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
};
