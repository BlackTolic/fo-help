// ESLint 9 flat config (ESM).
// 目标:TS 语法检查 + 一致性约束;关掉对 native bridge (winax/dm.dll) 项目过严的规则
// 类型感知(recommendedTypeChecked)会喷 no-unsafe-* 一屏幕,目前不上,等代码全 TypeScript 化了再说
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  // 全局 ignore
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'dist-workers/**',
      'release/**',
      '.deprecated/**',
      'thumbnails/**',
      'testscreen-*.png',
      'assets/dll/**', // 二进制,根本不解析
      '*.min.js',
      'coverage/**',
    ],
  },

  // JS 基线规则
  js.configs.recommended,

  // TS 规则(recommended + stylistic)
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,

  // 全局规则开关
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // 跟项目节奏相关的常用阉割
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // winax/dm.dll 都是 any 返回值,unsafe-* 一屏幕,关掉
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // 一些项目里无所谓的小规则
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/require-await': 'off',
      // winax/dm.dll/jimp/fs 都是 require 来的 CommonJS 模块,这一条关掉
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // ESLint 原生
      'no-undef': 'off', // TS 自己管类型
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },

  // 渲染端放宽某些规则(我们用 window.fohelp,React useEffect 没有 deps 数组也比较多)
  {
    files: ['renderer/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Prettier 兼容(放到最后,关掉冲突规则)
  prettier,
];
