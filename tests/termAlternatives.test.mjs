import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const defaultTermsDir = fileURLToPath(
  new URL('../src/content/terms/', import.meta.url)
);
// Set TERMS_DIR to validate a temporary copy (used by the smoke test).
const termsDir = process.env.TERMS_DIR
  ? path.resolve(process.env.TERMS_DIR)
  : defaultTermsDir;

const invisibles = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/g;
const tashkeel = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const translationMap = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ى: 'ي',
  ی: 'ي',
  ئ: 'ي',
  ؤ: 'و',
  ک: 'ك',
  ۀ: 'ه',
};

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(tashkeel, '')
    .replace(invisibles, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱىیئؤکۀ]/g, (char) => translationMap[char])
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const normalizationVectors = JSON.parse(
  readFileSync(
    new URL('./fixtures/normalization-vectors.json', import.meta.url),
    'utf8'
  )
);

function readFrontmatter(content) {
  assert.ok(content.startsWith('---\n'), 'frontmatter must start with ---');
  const end = content.indexOf('\n---', 4);
  assert.ok(end > 0, 'frontmatter must have a closing ---');
  return content.slice(4, end);
}

const files = readdirSync(termsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort();

test('normalization: Python and Node share the same key algorithm', () => {
  for (const [input, expected] of normalizationVectors) {
    assert.equal(
      normalizeKey(input),
      expected,
      `normalizeKey(${JSON.stringify(input)})`
    );
  }
});

test('terms: every alternatives value is a valid array', () => {
  assert.ok(files.length > 0, `no term files found in ${termsDir}`);
  for (const file of files) {
    const content = readFileSync(path.join(termsDir, file), 'utf8');
    const data = yaml.load(readFrontmatter(content));
    assert.ok(data && typeof data === 'object', `${file}: invalid frontmatter`);
    assert.ok(
      Array.isArray(data.alternatives),
      `${file}: alternatives must be an array`
    );
  }
});

test('terms: alternative translations are non-empty and well typed', () => {
  for (const file of files) {
    const content = readFileSync(path.join(termsDir, file), 'utf8');
    const data = yaml.load(readFrontmatter(content));
    for (const [index, item] of data.alternatives.entries()) {
      assert.ok(
        item && typeof item === 'object',
        `${file}: alternative ${index} must be an object`
      );
      assert.equal(
        typeof item.translation,
        'string',
        `${file}: alternative ${index} translation must be a string`
      );
      assert.ok(
        item.translation.trim().length > 0,
        `${file}: alternative ${index} translation must be non-empty`
      );
      if (item.note !== undefined) {
        assert.equal(
          typeof item.note,
          'string',
          `${file}: alternative ${index} note must be a string`
        );
      }
    }
  }
});

test('terms: alternatives do not duplicate each other or the primary', () => {
  for (const file of files) {
    const content = readFileSync(path.join(termsDir, file), 'utf8');
    const data = yaml.load(readFrontmatter(content));
    const primary = normalizeKey(data.translation ?? '');
    const seen = new Set();

    for (const [index, item] of data.alternatives.entries()) {
      const key = normalizeKey(item.translation);
      assert.ok(
        !seen.has(key),
        `${file}: alternative ${index} duplicates another alternative (${item.translation})`
      );
      assert.notEqual(
        key,
        primary,
        `${file}: alternative ${index} duplicates the primary translation (${item.translation})`
      );
      seen.add(key);
    }
  }
});
