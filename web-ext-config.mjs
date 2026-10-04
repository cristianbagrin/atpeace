// Read automatically by `web-ext` (build / lint / run / sign) from the repo root.
//
// What ships in the add-on is exactly: manifest.json, icons/, src/. Everything else (dev tooling,
// tests, docs, markdown) stays out of the package. web-ext already skips dotfiles/dot-folders
// (.git, .github, .gitignore…), node_modules, *.xpi and *.zip on its own.
export default {
  sourceDir: '.',
  artifactsDir: 'web-ext-artifacts',
  ignoreFiles: [
    'tests',
    'tests/**',
    'tools',
    'tools/**',
    'docs',
    'docs/**',
    '*.md',
    'package.json',
    'package-lock.json',
    'eslint.config.js',
    'web-ext-config.mjs',
    // Chrome-only service worker used by the E2E harness. Firefox (the target) never loads it.
    'src/background/sw-chrome.js',
  ],
  build: {
    filename: 'at-peace-{version}.zip',
    overwriteDest: true,
  },
  run: {
    startUrl: ['https://www.youtube.com/'],
  },
};
