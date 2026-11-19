#!/usr/bin/env node
// Prints the addons.mozilla.org metadata for a version as JSON, for `web-ext sign --amo-metadata`:
// the version notes (that version's section of CHANGELOG.md) and the notes to reviewer
// (docs/store/reviewer-notes.txt; Mozilla takes at most 3,000 characters).
//
//   node tools/amo-metadata.mjs 0.6.0 > amo-metadata.json
import { readFileSync } from 'node:fs';

const version = process.argv[2] ?? JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version;
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notes = changelog.match(new RegExp(`\\n## ${esc(version)}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1]?.trim();
if (!notes) {
  console.error(`No "## ${version}" section in CHANGELOG.md. Release with npm run release.`);
  process.exit(1);
}
const reviewer = readFileSync(new URL('../docs/store/reviewer-notes.txt', import.meta.url), 'utf8').trim();
if (reviewer.length > 3000) {
  console.error(`docs/store/reviewer-notes.txt is ${reviewer.length} characters; Mozilla takes at most 3000.`);
  process.exit(1);
}
console.log(JSON.stringify({ version: { release_notes: { 'en-US': notes }, approval_notes: reviewer } }, null, 2));
