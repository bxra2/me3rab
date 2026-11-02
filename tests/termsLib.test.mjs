import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  allocateSlug,
  extractFrontmatter,
  parseTermNames,
  readAllowlist,
  readTerm,
  renderTermMarkdown,
} from '../scripts/lib/terms.mjs';

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'muarrib-terms-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeTerm(path, term) {
  writeFileSync(path, `---\nterm: ${term}\n---\n`, 'utf8');
}

test('extractFrontmatter: returns the YAML block only', () => {
  assert.equal(
    extractFrontmatter('---\nterm: Alpha\ntranslation: ألفا\n---\nbody\n'),
    'term: Alpha\ntranslation: ألفا'
  );
  assert.equal(extractFrontmatter('no frontmatter here'), '');
  assert.equal(extractFrontmatter('---\nterm: Unclosed\n'), '');
});

test('readTerm: reads the term value from frontmatter', () => {
  assert.equal(readTerm('---\nterm: Widget\ntranslation: ودجة\n---\n'), 'Widget');
  assert.equal(readTerm('plain body'), undefined);
  assert.equal(readTerm('---\ntranslation: بلا اسم\n---\n'), undefined);
});

test('parseTermNames: walks recursively and skips dotfiles/dot-dirs', () => {
  const dir = makeTempDir();
  writeFileSync(join(dir, 'alpha.md'), '---\nterm: Alpha\n---\n');
  writeFileSync(join(dir, 'beta.md'), '---\nterm: Beta\n---\n');
  writeFileSync(join(dir, 'not-a-term.txt'), 'term: Nope');

  writeFileSync(join(dir, '.hidden.md'), '---\nterm: Hidden\n---\n');
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'secret.md'), '---\nterm: Secret\n---\n');

  mkdirSync(join(dir, 'nested', 'deeper'), { recursive: true });
  writeFileSync(
    join(dir, 'nested', 'deeper', 'gamma.md'),
    '---\nterm: Gamma\n---\n'
  );

  assert.deepEqual(parseTermNames(dir).sort(), ['Alpha', 'Beta', 'Gamma']);
});

test('parseTermNames: malformed frontmatter is skipped and reported', () => {
  const dir = makeTempDir();
  const goodPath = join(dir, 'good.md');
  const badPath = join(dir, 'bad.md');
  writeFileSync(goodPath, '---\nterm: Good\n---\n');
  writeFileSync(badPath, '---\nterm: [unclosed\n---\n');

  const failures = [];
  const names = parseTermNames(dir, (failure) => failures.push(failure));

  assert.deepEqual(names, ['Good']);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].path, badPath);
  assert.ok(failures[0].error instanceof Error);
  assert.equal(readTerm('---\nterm: [unclosed\n---\n'), undefined);
});

test('readAllowlist: filters strings and distinguishes missing vs broken', () => {
  const dir = makeTempDir();
  const validPath = join(dir, 'allow.json');
  writeFileSync(validPath, JSON.stringify(['One', 2, null, 'Two']));

  assert.deepEqual(readAllowlist(validPath), ['One', 'Two']);

  const missingFailures = [];
  assert.deepEqual(
    readAllowlist(join(dir, 'missing.json'), (message) =>
      missingFailures.push(message)
    ),
    []
  );
  assert.deepEqual(missingFailures, [], 'missing files must stay silent');

  const brokenPath = join(dir, 'broken.json');
  writeFileSync(brokenPath, '{ not json');
  const brokenFailures = [];
  assert.deepEqual(
    readAllowlist(brokenPath, (message) => brokenFailures.push(message)),
    []
  );
  assert.equal(brokenFailures.length, 1);
  assert.match(brokenFailures[0], /allowlist:/);

  const nonArrayPath = join(dir, 'non-array.json');
  writeFileSync(nonArrayPath, JSON.stringify({ not: 'an array' }));
  const nonArrayFailures = [];
  assert.deepEqual(
    readAllowlist(nonArrayPath, (message) => nonArrayFailures.push(message)),
    []
  );
  assert.equal(nonArrayFailures.length, 1);
  assert.match(nonArrayFailures[0], /expected an array/);
});

test('renderTermMarkdown: fixed key order and YAML round-trip', () => {
  const entry = {
    term: 'Widget',
    translation: 'ودجة',
    explanation: 'قطعة واجهة',
    status: 'coined',
    source: [{ name: 'قاموس', link: 'https://example.com' }],
    alternatives: [{ translation: 'أداة', note: 'بديل' }],
    derivations: [{ form: 'وديجات', gloss: 'جمع' }],
  };

  const markdown = renderTermMarkdown(entry);
  assert.ok(markdown.startsWith('---\n'));
  assert.ok(markdown.endsWith('---\n'));

  const order = [
    'term:',
    'translation:',
    'explanation:',
    'status:',
    'source:',
    'alternatives:',
    'derivations:',
  ].map((key) => markdown.indexOf(key));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'frontmatter keys must keep the fixed order'
  );

  const parsed = yaml.load(extractFrontmatter(markdown));
  assert.deepEqual(parsed, entry);
  assert.equal(readTerm(markdown), 'Widget');
});

test('renderTermMarkdown: applies defaults for missing keys', () => {
  const parsed = yaml.load(
    extractFrontmatter(renderTermMarkdown({ term: 'Bare' }))
  );
  assert.equal(parsed.status, 'proposed');
  assert.equal(parsed.translation, '');
  assert.equal(parsed.explanation, '');
  assert.deepEqual(parsed.source, []);
  assert.deepEqual(parsed.alternatives, []);
  assert.deepEqual(parsed.derivations, []);
});

test('allocateSlug: empty base falls back to term and suffixes', () => {
  const used = new Set();
  assert.equal(allocateSlug('مصطلح', used), 'term');
  assert.equal(allocateSlug('مصطلح آخر', used), 'term-2');
  assert.equal(allocateSlug('مصطلح ثالث', used), 'term-3');
  assert.ok(used.has('term-3'));
});

test('allocateSlug: numeric suffix for a colliding latin slug', () => {
  const used = new Set(['tool']);
  assert.equal(allocateSlug('Tool', used), 'tool-2');
  assert.equal(allocateSlug('Tool', used), 'tool-3');
});
