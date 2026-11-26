import babelParser from '@babel/eslint-parser';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/*/frontend/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ['@babel/preset-typescript'] },
      },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      'no-constant-condition': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
    },
  },
  {
    files: ['src/*/frontend/**/*.{jsx,tsx}'],
    languageOptions: {
      parserOptions: {
        babelOptions: {
          presets: ['@babel/preset-typescript'],
          plugins: ['@babel/plugin-syntax-jsx'],
        },
      },
    },
  },
];
