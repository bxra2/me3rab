import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const pagePath = path.join(root, 'src/pages/مصطلحات.astro');
const routePath = path.join(root, 'src/pages/مصطلحات/[term].astro');
const componentPath = path.join(root, 'src/components/TermPage.astro');
const cssPath = path.join(root, 'src/components/term-page.css');
const schemaPath = path.join(root, 'src/content.config.ts');
const termsDir = path.join(root, 'src/content/terms');

const page = readFileSync(pagePath, 'utf8').normalize('NFC');
const route = readFileSync(routePath, 'utf8').normalize('NFC');
const component = readFileSync(componentPath, 'utf8').normalize('NFC');
const css = readFileSync(cssPath, 'utf8').normalize('NFC');
const schema = readFileSync(schemaPath, 'utf8').normalize('NFC');

function readFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'frontmatter must be delimited by ---');
  return match[1];
}

test('term pages: dialog implementation is fully removed', () => {
  assert.ok(
    !existsSync(path.join(root, 'src/components/TermDialog.astro')),
    'TermDialog.astro must be deleted'
  );
  assert.ok(
    !existsSync(path.join(root, 'src/components/term-dialog.css')),
    'term-dialog.css must be deleted'
  );
  assert.ok(!/<dialog/i.test(page), 'hub page must not render any <dialog>');
  assert.ok(
    !page.includes('TermDialog') && !page.includes('term-dialog'),
    'hub page must not reference the removed dialog component'
  );
  assert.ok(
    !page.includes('aria-haspopup'),
    'hub page rows must navigate, not open dialogs'
  );
});

test('term pages: hub rows are links to per-term routes', () => {
  assert.match(
    page,
    /<a\s*\n?\s*class='term-row'/,
    'hub must render term rows as <a class="term-row">'
  );
  assert.match(
    page,
    /href=\{`\$\{base\}مصطلحات\/\$\{encodeURIComponent\(/,
    'term row href must point at /مصطلحات/<slug>'
  );
});

test('term pages: route generates a static page per term slug', () => {
  assert.match(
    route,
    /export async function getStaticPaths/,
    '[term].astro must define getStaticPaths'
  );
  assert.match(
    route,
    /params:\s*\{\s*term:\s*entry\.id\s*\}/,
    'route params must use the content entry id (filename slug)'
  );
  assert.match(
    route,
    /getCollection\(['"]terms['"]\)/,
    'getStaticPaths must read the terms collection'
  );
  assert.match(
    route,
    /import\s+TermPage\s+from\s+['"]\.\.\/\.\.\/components\/TermPage\.astro['"]/,
    'route must render the TermPage component'
  );
  assert.match(
    route,
    /relations\.filter\(\(r\)\s*=>\s*r\.terms\.includes/,
    'route must pass only the relations that include the term'
  );
});

test('term pages: component lays out sections in a named-area grid', () => {
  assert.match(
    component,
    /import\s+['"]\.\/term-page\.css['"]/,
    'TermPage must import ./term-page.css'
  );
  assert.match(
    component,
    /<div class="term-layout">/,
    'TermPage must use the fixed term-layout grid'
  );
  assert.match(
    component,
    /term-section-placeholder/,
    'empty sections must render a section-level placeholder'
  );
  assert.match(
    component,
    /l\.link \? \(\s*<a href=\{l\.link\}/,
    'language entries must render as links when a link is provided'
  );
  assert.doesNotMatch(
    component,
    /<tr class="term-placeholder"/,
    'the languages table must not contain fake placeholder rows'
  );
  assert.match(component, /term-states/, 'component must render the states section');
  assert.match(component, /term-relations/, 'component must render the relations section');
  assert.match(component, /term-main/, 'component must render the main section');
  assert.match(component, /term-side/, 'component must render the side section');
  assert.match(component, /<h2>الاشتقاق<\/h2>/, 'component must render the derivations section');
  assert.match(component, /<table class="term-languages">/, 'languages must render as a table');
  assert.doesNotMatch(component, /<ul class="term-languages">/, 'languages must not render as a list');
  assert.match(component, /<h2>مصطلحات مقترحة<\/h2>/, 'alternatives section must be titled مصطلحات مقترحة');
  assert.match(component, /<h2>بقية اللغات<\/h2>/, 'languages section must be titled بقية اللغات');
  assert.match(component, /<h2>المصادر<\/h2>/, 'sources section must be titled المصادر');
});

test('term pages: layout grid, section placeholders, and mobile stack', () => {
  assert.match(
    css,
    /grid-template-areas:\s*\n\s*'states states states'\s*\n\s*'rels main side'/,
    'desktop grid must place relations right, main center, side left'
  );
  assert.doesNotMatch(
    css,
    /\.term-layout\.no-rels\s*\{/,
    'sections always render, so column-collapse variants must not exist'
  );
  assert.doesNotMatch(
    css,
    /\.term-layout\.no-side\s*\{/,
    'sections always render, so column-collapse variants must not exist'
  );
  assert.match(
    css,
    /\.term-section-placeholder\s*\{/,
    'empty sections must have a dashed placeholder style'
  );
  assert.match(css, /\.term-languages\s*\{/, 'languages table must be styled');
  assert.match(
    css,
    /@media \(max-width: 50rem\)\s*\{[\s\S]*?\.term-layout\s*\{/,
    'the 50rem media block must stack the term layout'
  );
  assert.doesNotMatch(css, /^dialog\s*\{/m, 'component CSS must not style dialogs');
});

test('term pages: schema carries the languages field', () => {
  assert.match(
    schema,
    /languages:\s*z\.array\(z\.object\(\{\s*language:\s*z\.string\(\),\s*term:\s*z\.string\(\),\s*link:\s*z\.string\(\)\.default\(''\)\s*\}\)\)\.default\(\[\]\)/,
    'terms schema must define an optional languages array with an optional link'
  );
});

test('terms: term values are unique across frontmatter files', () => {
  const files = readdirSync(termsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  const seen = new Map();
  for (const file of files) {
    const content = readFileSync(path.join(termsDir, file), 'utf8');
    const data = yaml.load(readFrontmatter(content));
    assert.ok(data && typeof data === 'object', `${file}: invalid frontmatter`);
    const term = data.term;
    assert.ok(term, `${file}: missing term`);
    seen.set(term, (seen.get(term) ?? []).concat(file));
  }

  const duplicates = [...seen.entries()].filter(([, files]) => files.length > 1);
  assert.deepEqual(
    duplicates.map(([term]) => term),
    [],
    `duplicate term values: ${duplicates
      .map(([term, files]) => `${term} (${files.join(', ')})`)
      .join('; ')}`
  );
});
