import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const categories = JSON.parse(
  readFileSync(new URL('../src/data/glossary-categories.json', import.meta.url), 'utf8')
);

test('glossary categories: titles and hrefs are unique', () => {
  const titles = categories.map((c) => c.title);
  const hrefs = categories.filter((c) => c.href).map((c) => c.href);

  assert.equal(
    new Set(titles).size,
    titles.length,
    'category titles must be unique'
  );
  assert.equal(
    new Set(hrefs).size,
    hrefs.length,
    'category hrefs must be unique'
  );
});

test('glossary categories: hrefs are NFC and well-formed', () => {
  for (const c of categories) {
    if (!c.href) continue;
    assert.equal(
      c.href,
      c.href.normalize('NFC'),
      `href "${c.href}" must be NFC-normalized`
    );
    assert.match(
      c.href,
      /^\/معاجم\/[^/?#%\s]+$/,
      `href "${c.href}" must match /^\\/معاجم\\/[^/?#%\\s]+$/`
    );
    // Title↔route coupling: the route must be derived from the title.
    assert.equal(
      c.href,
      `/معاجم/${c.title}`,
      `href must use the category title as its route: ${c.title}`
    );
  }
});

test('glossary categories: every href has a page on disk', () => {
  for (const c of categories) {
    if (!c.href) continue;
    const path = fileURLToPath(new URL(`../src/pages${c.href}.astro`, import.meta.url));
    assert.ok(
      existsSync(path),
      `expected page file to exist for href "${c.href}" at ${path}`
    );
  }
});

test('glossary pages: every page under معاجم/ is registered', () => {
  const dir = fileURLToPath(new URL('../src/pages/معاجم/', import.meta.url));
  const registered = new Set(
    categories
      .filter((c) => c.href)
      .map((c) => c.href.normalize('NFC'))
  );

  for (const file of readdirSync(dir)) {
    const entryPath = fileURLToPath(new URL(`../src/pages/معاجم/${file}`, import.meta.url));
    if (statSync(entryPath).isDirectory()) {
      assert.fail(`nested route directories are not supported under src/pages/معاجم/: ${file}`);
    }
    if (!file.endsWith('.astro')) continue;
    if (file === 'index.astro') {
      assert.fail('معاجم/index.astro should not exist; use معاجم.astro instead');
    }
    const name = file.slice(0, -'.astro'.length);
    assert.equal(
      name,
      name.normalize('NFC'),
      `category page filename must be NFC on disk: "${file}"`
    );
    const href = `/معاجم/${name}`;
    assert.ok(
      registered.has(href),
      `page "${file}" has no registered href "${href}" in glossary-categories.json`
    );
  }
});

test('glossary categories: only الكيمياء is available in this release', () => {
  // Update this test when a new glossary category goes live.
  const available = categories.filter((c) => c.href);
  assert.deepEqual(
    available.map((c) => c.title),
    ['الكيمياء'],
    'update this test when a new glossary category goes live'
  );
});

test('glossary hub: معاجم.astro and index.astro link exist', () => {
  const hub = fileURLToPath(new URL('../src/pages/معاجم.astro', import.meta.url));
  assert.ok(existsSync(hub), 'src/pages/معاجم.astro must exist');

  const index = readFileSync(
    new URL('../src/pages/index.astro', import.meta.url),
    'utf8'
  ).normalize('NFC');
  assert.match(
    index,
    /href=["']\/معاجم["']/,
    'index.astro must link to /معاجم (single or double quotes)'
  );
});

test('glossary chemistry: scaffold has no table', () => {
  const src = readFileSync(
    new URL('../src/pages/معاجم/الكيمياء.astro', import.meta.url),
    'utf8'
  ).normalize('NFC');
  assert.ok(
    !/<table/i.test(src),
    'الكيمياء.astro must not contain a <table> element'
  );
});

test('glossary nav: Nav.astro has معاجم and keeps شبكة', () => {
  const src = readFileSync(
    new URL('../src/components/Nav.astro', import.meta.url),
    'utf8'
  ).normalize('NFC');
  assert.match(
    src,
    /href:\s*["']\/معاجم["']/,
    'Nav.astro must contain the /معاجم entry'
  );
  assert.match(
    src,
    /href:\s*["']\/شبكة["']/,
    'Nav.astro must retain the pre-existing /شبكة entry'
  );
});

test('glossary styles: shared grid rule, media rule, and print list', () => {
  const css = readFileSync(
    new URL('../src/styles/style.css', import.meta.url),
    'utf8'
  ).normalize('NFC');

  assert.match(
    css,
    /\.source-grid,\s*\.hub-grid\s*\{|\.hub-grid,\s*\.source-grid\s*\{/,
    'base shared grid rule must list .source-grid and .hub-grid'
  );

  // Collect every `@media (max-width: 50rem) { ... }` block and require at
  // least one to contain BOTH .hub-grid and .source-grid (the .with-aside
  // block contains neither).
  const mediaBlocks = extractMediaBlocks(css, 'max-width: 50rem');
  const shared = mediaBlocks.some(
    (block) => block.includes('.hub-grid') && block.includes('.source-grid')
  );
  assert.ok(
    shared,
    'a 50rem media block must contain both .hub-grid and .source-grid'
  );

  assert.match(
    css,
    /\.source-card,\s*\.hub-card|\.hub-card,\s*\.source-card/,
    '.hub-card must be in the print break-inside list next to .source-card'
  );
});

/**
 * Extracts the inner content of every `@media (query) { ... }` block,
 * matching balanced braces so nested rule braces do not truncate the block.
 * @param {string} css
 * @param {string} query
 * @returns {string[]}
 */
function extractMediaBlocks(css, query) {
  const blocks = [];
  const start = `@media (${query}) {`;
  let idx = 0;
  while ((idx = css.indexOf(start, idx)) !== -1) {
    const open = idx + start.length - 1; // index of the opening '{'
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(css.slice(open + 1, end));
    idx = end + 1;
  }
  return blocks;
}
