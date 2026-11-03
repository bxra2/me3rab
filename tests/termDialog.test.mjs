import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const pagePath = path.join(root, 'src/pages/مصطلحات.astro');
const cssPath = path.join(root, 'src/components/term-dialog.css');
const termsDir = path.join(root, 'src/content/terms');

const page = readFileSync(pagePath, 'utf8').normalize('NFC');

function readFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'frontmatter must be delimited by ---');
  return match[1];
}

test('term dialogs: server-rendered dialog per term with close button first', () => {
  assert.match(
    page,
    /<dialog class='term-dialog-shell' data-term=\{e\.term\} aria-label=\{e\.term\}>/,
    'page must render one <dialog class="term-dialog-shell"> per entry'
  );

  const closeIndex = page.indexOf("class='dialog-close'");
  const componentIndex = page.indexOf('<TermDialog');
  assert.ok(closeIndex !== -1, 'each dialog must include a dialog-close button');
  assert.ok(componentIndex !== -1, 'each dialog must render <TermDialog />');
  assert.ok(
    closeIndex < componentIndex,
    'the dialog-close button must come before <TermDialog /> inside the dialog'
  );
});

test('term dialogs: old client-side rendering path is removed', () => {
  assert.doesNotMatch(page, /render\(/, 'page must not call render()');
  assert.doesNotMatch(page, /status-data/, 'page must not include #status-data');

  const scriptStart = page.lastIndexOf('<script>');
  assert.ok(scriptStart !== -1, 'page must include a client script');
  const scriptEnd = page.indexOf('</script>', scriptStart);
  assert.ok(scriptEnd > scriptStart, 'client script must be properly closed');
  const clientScript = page.slice(scriptStart, scriptEnd);

  assert.doesNotMatch(
    clientScript,
    /motivationBadgeClass/,
    'client script must not reference motivationBadgeClass (server-rendered now)'
  );
});

test('term dialogs: frontmatter pre-renders escaped markup and JSON', () => {
  assert.match(
    readFrontmatter(page),
    /const escapeHtml/,
    'page frontmatter must define escapeHtml'
  );

  const occurrences = page.split("\\\\u003c").length - 1;
  assert.ok(
    occurrences >= 2,
    'both #term-data and #relation-data must escape "<" as \\\\u003c'
  );
});

test('term dialogs: component CSS uses scoped shell selectors only', () => {
  const css = readFileSync(cssPath, 'utf8');

  assert.doesNotMatch(
    css,
    /^dialog\s*\{/m,
    'component CSS must not contain a bare top-level dialog selector'
  );
  assert.doesNotMatch(
    css,
    /\.term-dialog(?![a-z-])/,
    'component CSS must not use the old .term-dialog class'
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

test('term dialogs: row buttons and relation chips declare a dialog popup', () => {
  const occurrences = (
    page.match(/aria-haspopup=['"]dialog['"]/g) ?? []
  ).length;
  assert.ok(
    occurrences >= 2,
    `aria-haspopup dialog must appear on the row button and relation chips (found ${occurrences})`
  );
});

test('term dialogs: dialogs container renders after the glossary grid', () => {
  const containerIndex = page.indexOf("<div class='term-dialogs'>");
  assert.ok(containerIndex !== -1, 'page must contain the .term-dialogs container');

  const gridIndex = page.indexOf('glossary-grid');
  assert.ok(gridIndex !== -1, 'page must contain the glossary grid');
  assert.ok(
    containerIndex > gridIndex,
    'the .term-dialogs container must render after the glossary grid'
  );
});
