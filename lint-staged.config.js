// lint-staged.config.js
// Runs only on staged files. `eslint --fix` repairs + re-stages trivial issues;
// unfixable problems (missing JSDoc, real errors, type errors) block the commit.
// The typecheck entries are functions so they ignore the passed filenames and
// run project-wide for the package that has staged changes.
export default {
  'src/**/*.ts': ['eslint --fix', () => 'npm run typecheck'],
  'test/**/*.ts': ['eslint --fix'],
  'web/src/**/*.{ts,tsx}': ['eslint --fix', () => 'npm --prefix web run typecheck'],
}
