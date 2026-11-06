const commonRules = {
  'array-callback-return': 'error',
  'constructor-super': 'error',
  curly: ['error', 'multi-line'],
  eqeqeq: ['error', 'always'],
  'no-alert': 'error',
  'no-async-promise-executor': 'error',
  'no-constant-binary-expression': 'error',
  'no-constant-condition': 'error',
  'no-debugger': 'error',
  'no-duplicate-imports': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-prototype-builtins': 'error',
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'valid-typeof': 'error',
};

const nodeGlobals = {
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  clearImmediate: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  exports: 'writable',
  fetch: 'readonly',
  global: 'readonly',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
  setImmediate: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  window: 'readonly',
};

const browserGlobals = {
  Blob: 'readonly',
  browser: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  Element: 'readonly',
  Event: 'readonly',
  fetch: 'readonly',
  FormData: 'readonly',
  HTMLElement: 'readonly',
  location: 'readonly',
  MediaRecorder: 'readonly',
  MutationObserver: 'readonly',
  navigator: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  window: 'readonly',
};

module.exports = [
  {
    ignores: ['build/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.js', 'SafariExtension/**/*.js', 'scripts/**/*.cjs', 'eslint.config.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: commonRules,
  },
  {
    files: ['src/main.js', 'src/preload.js', 'scripts/**/*.cjs', 'eslint.config.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    files: ['src/renderer.js', 'SafariExtension/**/*.js'],
    languageOptions: {
      globals: browserGlobals,
    },
  },
];
