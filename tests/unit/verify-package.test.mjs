// tools/verify-package.mjs: the zip reader and the reference checks, on small in-memory packages.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { checkPackage, readZip } from '../../tools/verify-package.mjs';

/** Builds a zip in memory: one stored and one deflated entry, plus a directory. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const nameBuf = Buffer.from(name);
    const body = deflate ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** A package as checkPackage wants it: { files, read, manifest }. */
function pkg(manifest, contents) {
  return { manifest, files: new Set(Object.keys(contents)), read: async (path) => contents[path] };
}

const MANIFEST = {
  icons: { 16: 'icons/icon-16.png' },
  action: { default_popup: 'src/pages/popup/popup.html' },
  background: { scripts: ['src/a.js'] },
  content_scripts: [{ js: ['src/a.js'] }],
  web_accessible_resources: [{ resources: ['src/pages/pause/*'], matches: ['<all_urls>'] }],
};
const GOOD = {
  'icons/icon-16.png': '',
  'src/a.js': "const url = 'src/pages/pause/pause.html';",
  'src/pages/popup/popup.html': '<link rel="stylesheet" href="popup.css"><script src="../common/c.js"></script><script type="module" src="popup.js"></script>',
  'src/pages/popup/popup.css': 'a { background: url(../common/x.png) } b { background: url(data:image/png;base64,AAA) }',
  'src/pages/popup/popup.js': "import { x } from './lib.js'; export * from '../common/c.js';",
  'src/pages/popup/lib.js': '',
  'src/pages/common/c.js': '',
  'src/pages/common/x.png': '',
  'src/pages/pause/pause.html': '<p>hi</p>',
};

describe('readZip', () => {
  test('reads stored and deflated entries and directories', () => {
    const zip = makeZip([
      { name: 'src/', data: Buffer.alloc(0) },
      { name: 'src/a.txt', data: Buffer.from('hello'), deflate: false },
      { name: 'src/b.txt', data: Buffer.from('world '.repeat(50)), deflate: true },
    ]);
    const out = readZip(zip);
    assert.deepEqual(out.map((e) => [e.name, e.isDir]), [['src/', true], ['src/a.txt', false], ['src/b.txt', false]]);
    assert.equal(out[1].data.toString(), 'hello');
    assert.equal(out[2].data.toString(), 'world '.repeat(50));
  });

  test('refuses something that is not a zip', () => {
    assert.throws(() => readZip(Buffer.from('not a zip at all, just text')), /not a zip/);
  });
});

describe('checkPackage', () => {
  test('a consistent package has no errors; unused files are only warnings', async () => {
    const { errors, warnings } = await checkPackage(pkg(MANIFEST, { ...GOOD, 'src/unused.js': '' }));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings.map((w) => w.split(':')[0]), ['src/unused.js']);
  });

  test('a manifest reference to a missing file is an error (icon, popup, background, content script)', async () => {
    const contents = { ...GOOD };
    for (const path of ['icons/icon-16.png', 'src/pages/popup/popup.html', 'src/a.js']) delete contents[path];
    const { errors } = await checkPackage(pkg(MANIFEST, contents));
    for (const path of ['icons/icon-16.png', 'src/pages/popup/popup.html', 'src/a.js']) assert.ok(errors.some((e) => e.includes(`"${path}"`)), path);
  });

  test('a page that names a missing script, image (CSS url) or module import fails', async () => {
    const contents = { ...GOOD };
    for (const path of ['src/pages/common/c.js', 'src/pages/common/x.png', 'src/pages/popup/lib.js']) delete contents[path];
    const { errors } = await checkPackage(pkg(MANIFEST, contents));
    for (const missing of ['src/pages/common/c.js', 'src/pages/common/x.png', 'src/pages/popup/lib.js']) {
      assert.ok(errors.some((e) => e.includes(`"${missing}" is not in the package`)), missing);
    }
  });

  test('a stylesheet link to a missing file fails', async () => {
    const contents = { ...GOOD };
    delete contents['src/pages/popup/popup.css'];
    const { errors } = await checkPackage(pkg(MANIFEST, contents));
    assert.ok(errors.some((e) => e.includes('"src/pages/popup/popup.css" is not in the package')));
  });

  test('a web_accessible_resources pattern that matches nothing fails', async () => {
    const contents = { ...GOOD };
    delete contents['src/pages/pause/pause.html'];
    const { errors } = await checkPackage(pkg(MANIFEST, contents));
    assert.ok(errors.some((e) => e.includes('src/pages/pause/*') && e.includes('matches nothing')));
    assert.ok(errors.some((e) => e.includes('"src/pages/pause/pause.html" is not in the package')), 'the string literal in the code is checked too');
  });

  test('remote loads, inline scripts and inline handlers are errors', async () => {
    const contents = {
      ...GOOD,
      'src/pages/popup/popup.html': '<script src="https://cdn.example/x.js"></script><script>alert(1)</script><button onclick="go()">x</button>',
      'src/pages/popup/popup.css': '@import url("https://fonts.example/a.css"); a { background: url(//img.example/x.png) }',
    };
    const { errors } = await checkPackage(pkg(MANIFEST, contents));
    assert.ok(errors.some((e) => e.includes('loads from the network') && e.includes('cdn.example')));
    assert.ok(errors.some((e) => e.includes('inline script')));
    assert.ok(errors.some((e) => e.includes('inline event handler')));
    assert.ok(errors.filter((e) => e.includes('popup.css') && e.includes('network')).length >= 2);
  });
});
