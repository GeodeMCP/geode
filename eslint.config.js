// eslint.config.js
import tseslint from 'typescript-eslint'
import jsdoc from 'eslint-plugin-jsdoc'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'web/dist/',
      '**/node_modules/',
      '.worktrees/',
      '**/*.tsbuildinfo',
    ],
  },

  // Baseline conventions for all TypeScript (non-type-checked = fast).
  ...tseslint.configs.recommended,

  // Doc-block enforcement: JSDoc required on the exported (public) API.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
        // Do NOT auto-insert empty JSDoc stubs on `eslint --fix`; a missing doc
        // block must stay a hard error that blocks the commit, forcing a real
        // description to be written by hand.
        enableFixer: false,
        require: {
          FunctionDeclaration: true,
          ClassDeclaration: true,
          MethodDefinition: true,
        },
        contexts: [
          'TSInterfaceDeclaration',
          'TSTypeAliasDeclaration',
          'TSEnumDeclaration',
          'ExportNamedDeclaration > VariableDeclaration',
        ],
      }],
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-alignment': 'error',
    },
  },

  // Root (Node) source + tests get Node globals.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Web override: React/TSX in the browser.
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
    },
  },
)
