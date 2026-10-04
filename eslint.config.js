import js from '@eslint/js';
import globals from 'globals';

// Everything in src/ is shipped as-is (no bundler). Classic scripts attach to the AtPeace
// namespace (PLAN §3.1); only src/pages/** may use ES modules.
const srcRules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  // PLAN §3.3: all extension API access goes through AP.api (src/shared/browser-api.js reads
  // them via globalThis, which this rule does not flag).
  'no-restricted-globals': [
    'error',
    { name: 'chrome', message: 'Use AP.api instead of chrome.* (PLAN §3.3).' },
    { name: 'browser', message: 'Use AP.api instead of browser.* (PLAN §3.3).' },
  ],
  // PLAN §3.2: build DOM with createElement / textContent, never from HTML strings.
  'no-restricted-syntax': [
    'error',
    {
      selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
      message: 'Do not assign HTML strings; use createElement / textContent (PLAN §3.2).',
    },
    {
      selector:
        "CallExpression[callee.property.name='insertAdjacentHTML'], CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
      message: 'Do not inject HTML strings; use createElement / textContent (PLAN §3.2).',
    },
  ],
};

export default [
  {
    ignores: ['node_modules/', 'web-ext-artifacts/', 'tests/e2e/artifacts/', '.cache/', '**/*.xpi'],
  },

  js.configs.recommended,

  // Extension code: classic scripts by default.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        AtPeace: 'readonly',
      },
    },
    rules: srcRules,
  },

  // Extension pages (popup, options, pause, blocked, welcome) may be ES modules.
  {
    files: ['src/pages/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },

  // Chrome test-only service worker: importScripts() & friends.
  {
    files: ['src/background/sw-chrome.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },

  // Node-side code: tests, tools, config files. ES modules.
  {
    files: ['tests/**/*.{js,mjs}', 'tools/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // Firefox chrome-context scripts (executeScript after setContext('chrome')) see these.
  {
    files: ['tests/firefox/**/*.mjs'],
    languageOptions: { globals: { Services: 'readonly', Ci: 'readonly', ChromeUtils: 'readonly', WebExtensionPolicy: 'readonly' } },
  },

  // Browser-driven tests pass functions to page.evaluate / executeScript; those run in the
  // browser, so DOM and extension globals are legitimate there.
  {
    files: ['tests/e2e/**/*.mjs', 'tests/firefox/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions, AtPeace: 'readonly' },
    },
  },
];
