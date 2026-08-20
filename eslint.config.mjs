// Root ESLint config. Enforces the module-boundary rule from ARCHITECTURE.md §3:
//   domain depends on nothing but money (a zero-dependency, I/O-free value type).
//   db, providers may depend on domain and money.
//   api/worker depend on all packages.
//   apps never import from each other. Nothing imports from apps/*.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/generated/**',
      // Written by `next dev`/`next build`, not by us — Next re-adds the
      // triple-slash reference to .next/types on every run, so linting it
      // just fails CI on a file nobody is allowed to edit.
      '**/next-env.d.ts',
    ],
  },
  {
    plugins: { boundaries },
    settings: {
      // eslint-plugin-boundaries resolves each import through this to decide
      // which element it belongs to. Without it, a source-level `./foo.js`
      // specifier (NodeNext-style, pointing at a `foo.ts` file on disk)
      // cannot be resolved and every local import is misreported as unknown.
      'import/resolver': {
        typescript: {
          project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
        },
      },
      // Patterns cover the whole package (src AND generated dist), not just
      // src/**: a package-name import like `@fineduc/money` resolves through
      // its "main"/"types" field to dist/index.js, and that resolved path is
      // what boundaries classifies — a src/**-only pattern would misreport
      // every cross-package import (as opposed to relative ./foo.js ones) as
      // unknown.
      'boundaries/elements': [
        { type: 'domain', pattern: 'packages/domain/**' },
        { type: 'money', pattern: 'packages/money/**' },
        { type: 'db', pattern: 'packages/db/**' },
        { type: 'contracts', pattern: 'packages/contracts/**' },
        { type: 'providers', pattern: 'packages/providers/**' },
        { type: 'config', pattern: 'packages/config/**' },
        { type: 'ui', pattern: 'packages/ui/**' },
        { type: 'app-api', pattern: 'apps/api/**' },
        { type: 'app-worker', pattern: 'apps/worker/**' },
        { type: 'app-dashboard', pattern: 'apps/dashboard/**' },
        { type: 'app-pay', pattern: 'apps/pay/**' },
        { type: 'app-web', pattern: 'apps/web/**' },
      ],
    },
    rules: {
      'boundaries/no-unknown': 'error',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // domain imports NOTHING of ours.
            // domain imports nothing of ours EXCEPT money. Reimplementing
            // largest-remainder allocation or half-up percentage rounding
            // inside domain would break rule #1 ("all arithmetic via
            // packages/money"), which outranks a tidier boundary; and money
            // is a true leaf — zero dependencies, no I/O — so it cannot drag
            // anything impure in behind it.
            { from: 'domain', allow: ['money'] },
            // money is a leaf: no internal dependencies.
            { from: 'money', allow: [] },
            // db and providers may depend on domain, money, and config (env/secrets).
            { from: 'db', allow: ['domain', 'money', 'config'] },
            { from: 'providers', allow: ['domain', 'money', 'config'] },
            { from: 'contracts', allow: ['money'] },
            { from: 'config', allow: [] },
            // ui may use money for DISPLAY only (the <Amount> component).
            // AGENTS.md rule #1 means nothing outside packages/money may
            // reimplement money maths — including formatting — so the
            // presentation layer depends on it rather than rolling its own.
            { from: 'ui', allow: ['money'] },
            // apps depend on any package, but NEVER on another app.
            { from: 'app-api', allow: ['domain', 'money', 'db', 'contracts', 'providers', 'config'] },
            { from: 'app-worker', allow: ['domain', 'money', 'db', 'contracts', 'providers', 'config'] },
            { from: 'app-dashboard', allow: ['contracts', 'ui', 'money', 'config'] },
            { from: 'app-pay', allow: ['contracts', 'ui', 'money', 'config'] },
            { from: 'app-web', allow: ['ui', 'config'] },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      // ARCHITECTURE.md §16 / AGENTS.md: new Date() and Math.random() are banned in
      // domain — inject a Clock instead so time and randomness stay testable.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']:not([arguments.length])",
          message: 'new Date() is banned in packages/domain. Inject Clock from shared/clock.ts.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Date.now() is banned in packages/domain. Inject Clock from shared/clock.ts.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Math.random() is banned in packages/domain. Inject a randomness source.',
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
)
