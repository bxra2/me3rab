import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').normalize('NFC');

const ARTICLES = [
  { id: 'تاريخ-الخط-العربي', order: 1 },
  { id: 'الخط-العربي-في-اللغات-الأخرى', order: 2 },
  { id: 'المهمل-والمتروك', order: 3 },
];

test('script section: content collection is registered', () => {
  const cfg = read('../src/content.config.ts');
  assert.match(
    cfg,
    /(?:const\s+script\s*=\s*|script\s*:\s*)defineCollection/,
    'content.config.ts must define a script collection'
  );
  assert.match(
    cfg,
    /collections\s*=\s*\{[^}]*\bscript\b/,
    'script must be exported in collections'
  );
});

test('script section: articles exist with required frontmatter and correct order', () => {
  for (const { id, order } of ARTICLES) {
    const path = fileURLToPath(new URL(`../src/content/script/${id}.md`, import.meta.url));
    assert.ok(existsSync(path), `expected article file ${id}.md`);
    const md = readFileSync(path, 'utf8').normalize('NFC');
    assert.match(md, /^---\s*$/m, `${id}.md must open frontmatter`);
    assert.match(md, /^title:\s*\S/m, `${id}.md must have a title`);
    assert.match(md, /^description:\s*\S/m, `${id}.md must have a description`);
    assert.match(
      md,
      new RegExp(`^order:\\s*${order}\\s*$`, 'm'),
      `${id}.md must have order: ${order}`
    );
  }
});

test('script section: hub, renderer, and entry component exist', () => {
  assert.ok(
    existsSync(fileURLToPath(new URL('../src/pages/الخط.astro', import.meta.url))),
    'src/pages/الخط.astro must exist'
  );
  assert.ok(
    existsSync(fileURLToPath(new URL('../src/pages/الخط/[slug].astro', import.meta.url))),
    'src/pages/الخط/[slug].astro must exist'
  );
  assert.ok(
    existsSync(fileURLToPath(new URL('../src/components/ScriptEntry.astro', import.meta.url))),
    'src/components/ScriptEntry.astro must exist'
  );
});

test('script section: ScriptEntry links articles to /الخط/{id}', () => {
  const entry = read('../src/components/ScriptEntry.astro');
  assert.match(
    entry,
    /href=\{`\$\{import\.meta\.env\.BASE_URL\}\/الخط\/\$\{article\.id\}`\}/,
    'ScriptEntry must link to /الخط/${article.id}'
  );
});

test('script section: renderer keeps post-body, sidenotes, TOC, and Kashida', () => {
  const renderer = read('../src/pages/الخط/[slug].astro');
  assert.match(renderer, /class="post-body"/, 'renderer must keep .post-body');
  assert.match(renderer, /has-sidenotes/, 'renderer must keep hasSidenotes logic');
  assert.match(renderer, /aside-box toc/, 'renderer must keep the TOC aside');
  assert.match(renderer, /<Kashida\b/, 'renderer must render <Kashida>');
});

test('script section: renderer omits blog-only fields', () => {
  const renderer = read('../src/pages/الخط/[slug].astro');
  assert.doesNotMatch(renderer, /<time\b/, 'renderer must not render a <time> element');
  assert.doesNotMatch(renderer, /\.data\.tags\b/, 'renderer must not reference .data.tags');
  assert.doesNotMatch(renderer, /Intl\.DateTimeFormat/, 'renderer must not format dates');
});

test('script section: nav and index link to the section', () => {
  const nav = read('../src/components/Nav.astro');
  assert.match(nav, /href:\s*`\$\{base\}الخط`/, 'Nav.astro must link to /الخط');
  const index = read('../src/pages/index.astro');
  assert.match(index, /href=\{`\$\{base\}الخط`\}/, 'index.astro must link to /الخط');
  assert.match(index, /forgottenHref/, 'index.astro must resolve the forgotten article link dynamically');
});
