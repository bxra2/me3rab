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

test('glossary chemistry: periodic table is integrated', () => {
  const page = readFileSync(
    new URL('../src/pages/معاجم/الكيمياء.astro', import.meta.url),
    'utf8'
  ).normalize('NFC');
  assert.match(
    page,
    /import\s+PeriodicTable\s+from\s+['"]\.\.\/\.\.\/components\/PeriodicTable\.astro['"]/,
    'الكيمياء.astro must import PeriodicTable from ../../components/PeriodicTable.astro'
  );
  assert.match(
    page,
    /<PeriodicTable\s*\/>/,
    'الكيمياء.astro must render <PeriodicTable />'
  );
  assert.ok(
    !/<table/i.test(page),
    'الكيمياء.astro must not contain a <table> element'
  );

  const component = readFileSync(
    new URL('../src/components/PeriodicTable.astro', import.meta.url),
    'utf8'
  ).normalize('NFC');
  assert.equal(
    (component.match(/<li\b/g) || []).length,
    118,
    'PeriodicTable.astro must contain exactly 118 <li> elements'
  );
  assert.match(
    component,
    /import\s+['"]\.\/periodic-table\.css['"]/,
    'PeriodicTable.astro must import ./periodic-table.css'
  );
  assert.match(
    component,
    /<div[^>]*class=["']periodic-table["'][^>]*>/,
    'PeriodicTable.astro must wrap content in <div class="periodic-table">'
  );
  assert.match(
    component,
    /<div[^>]*dir=["']ltr["'][^>]*>/,
    'PeriodicTable.astro wrapper must set dir="ltr"'
  );
  assert.match(
    component,
    /<div[^>]*lang=["']en["'][^>]*>/,
    'PeriodicTable.astro wrapper must set lang="en"'
  );
});

test('glossary chemistry: table is a component, not a route', () => {
  assert.ok(
    !existsSync(
      fileURLToPath(new URL('../src/pages/معاجم/table.astro', import.meta.url))
    ),
    'src/pages/معاجم/table.astro must not exist'
  );
  assert.ok(
    !existsSync(
      fileURLToPath(new URL('../src/pages/معاجم/table.css', import.meta.url))
    ),
    'src/pages/معاجم/table.css must not exist'
  );
});

test('glossary chemistry: table CSS is scoped', () => {
  const css = readFileSync(
    new URL('../src/components/periodic-table.css', import.meta.url),
    'utf8'
  ).normalize('NFC');
  assert.match(css, /^\.periodic-table\s*\{/m, 'CSS must scope .periodic-table');
  assert.doesNotMatch(css, /^body\b/m, 'CSS must not have a top-level body rule');
  assert.doesNotMatch(
    css,
    /^(?:fieldset|ol)\s*\{/m,
    'CSS must not have top-level fieldset/ol rules'
  );
  assert.doesNotMatch(
    css,
    /^\.(?:alk|aec|trn|trm|met|rnm|hln|nbl|lan|act)\s*\{/m,
    'CSS must not have top-level color class rules'
  );
  assert.match(
    css,
    /\.periodic-table:has\(#alk:checked\)/,
    'CSS must scope the filter :has() rule under .periodic-table'
  );
  assert.match(
    css,
    /^\.periodic-table label\s*\{/m,
    'CSS must scope filter labels under .periodic-table'
  );
  assert.doesNotMatch(
    css,
    /^(?:abbr|li)\s*\{/m,
    'CSS must not have top-level abbr/li element selectors'
  );
  assert.match(
    css,
    /\.periodic-table:has\(#brb:checked\)/,
    'CSS must scope the Heisenberg :has() rule under .periodic-table'
  );
  // The ol declares font-size: 2cqi. cqi resolves against the nearest ANCESTOR
  // container, so container-type must live on the .periodic-table wrapper.
  // On the ol itself it would fall back to viewport width and the table would
  // break on viewports wider than the 70rem page box.
  assert.match(
    css,
    /^\.periodic-table\s*\{[^}]*container-type:\s*inline-size/m,
    'CSS must declare container-type on the .periodic-table wrapper'
  );
  assert.doesNotMatch(
    css,
    /\.periodic-table ol\s*\{[^}]*container-type/m,
    'CSS must not declare container-type on the ol (cqi would resolve to viewport width)'
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
