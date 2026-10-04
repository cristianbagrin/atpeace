// Renders icons/icon.svg to icons/icon-{16,32,48,96,128}.png with the pre-installed Chromium
// (Playwright library, no network). Usage: `node tools/make-icons.mjs`.
// PLAYWRIGHT_PATH overrides the location of the Playwright library entry point.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);

const SIZES = [16, 32, 48, 96, 128];
const svg = await readFile(join(root, 'icons', 'icon.svg'), 'utf8');

// Chromium only starts here when `channel: 'chromium'` AND a proxy are configured (sandbox quirk);
// the page below needs no network. Without a proxy in the environment, launch plainly.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ channel: 'chromium', headless: true, proxy });

try {
  await mkdir(join(root, 'icons'), { recursive: true });
  for (const size of SIZES) {
    // Rescale via the root element's width/height; viewBox keeps the geometry identical.
    const sized = svg.replace(/(<svg[^>]*?)\swidth="\d+"\sheight="\d+"/, `$1 width="${size}" height="${size}"`);
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`,
    );
    const png = await page.screenshot({ omitBackground: true, type: 'png' });
    await writeFile(join(root, 'icons', `icon-${size}.png`), png);
    await page.close();
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
