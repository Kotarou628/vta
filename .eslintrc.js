// .eslintrc.js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'next/core-web-vitals'
  ],
  ignorePatterns: [
    'node_modules/',
    '.next/',
    'src/generated/prisma/**', // 自動生成コードは無視
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    '@typescript-eslint/no-require-imports': 'off'
  }
};
