import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideTheme } from '../src/utils/theme.js';

const css = readFileSync(
  new URL('../src/styles/style.css', import.meta.url),
  'utf8'
).normalize('NFC');

const lightMatch = css.match(/(?:^|\n):root\s*\{([^}]*)\}/);
assert.ok(lightMatch, 'style.css must define :root');

const darkMatch = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
assert.ok(darkMatch, 'style.css must define :root[data-theme="dark"]');

const darkTokens = new Map(
  [...darkMatch[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ])
);

function token(name) {
  const value = darkTokens.get(name);
  assert.ok(value, `missing dark token ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? token(alias[1]) : value;
}

function parseColor(value) {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
}

function relativeLuminance(value) {
  const [r, g, b] = parseColor(value).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (lighter + 0.05) / (darker + 0.05);
}

test('decideTheme: stored value wins when valid', () => {
  assert.equal(decideTheme('light', true), 'light');
  assert.equal(decideTheme('dark', false), 'dark');
});

test('decideTheme: missing or invalid stored value follows the system', () => {
  assert.equal(decideTheme(undefined, true), 'dark');
  assert.equal(decideTheme(null, false), 'light');
  assert.equal(decideTheme('', true), 'dark');
  assert.equal(decideTheme('sepia', false), 'light');
});

test('decideTheme: a throwing storage read falls back to the system', () => {
  const storage = {
    getItem() {
      throw new Error('storage blocked');
    },
  };

  let stored = null;
  try {
    stored = storage.getItem('muarrib-theme');
  } catch {
    stored = null;
  }

  assert.equal(decideTheme(stored, true), 'dark');
  assert.equal(decideTheme(stored, false), 'light');
});

test('dark palette: text tokens meet WCAG AA (>= 4.5:1)', () => {
  const pairs = [
    ['--color-ink', '--bg-color'],
    ['--color-accent', '--bg-color'],
    ['--color-secondary', '--bg-color'],
    ['--color-complete', '--bg-color'],
    ['--term-stat-head-fg', '--surface'],
  ];

  for (const [foreground, background] of pairs) {
    const ratio = contrastRatio(token(foreground), token(background));
    assert.ok(
      ratio >= 4.5,
      `${foreground} on ${background} must be >= 4.5:1 (got ${ratio.toFixed(2)})`
    );
  }
});

test('print block redeclares every custom property from :root', () => {
  const rootTokens = new Set(
    [...lightMatch[1].matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])
  );
  assert.ok(rootTokens.size > 0, 'expected custom properties on :root');

  const printRootMatch = css.match(
    /html:root,\s*html:root\[data-theme="dark"\]\s*\{([^}]*)\}/
  );
  assert.ok(
    printRootMatch,
    'print block must redeclare tokens at html:root specificity'
  );

  const printIndex = css.indexOf('@media print');
  assert.ok(
    printIndex !== -1 && printIndex < printRootMatch.index,
    'print token override must live inside @media print'
  );
  assert.match(printRootMatch[1], /color-scheme:\s*light/);

  for (const token of rootTokens) {
    assert.match(
      printRootMatch[1],
      new RegExp(`${token}\\s*:`),
      `${token} must be redeclared in the print block`
    );
  }
});

test('FOUC guard runs before fonts and validates only light/dark', () => {
  const layout = readFileSync(
    new URL('../src/layouts/BaseLayout.astro', import.meta.url),
    'utf8'
  );

  const guard = layout.indexOf('// keep in sync with src/utils/theme.js');
  const fonts = layout.indexOf('fonts.googleapis.com/css2');
  assert.ok(guard !== -1, 'inline FOUC guard must exist');
  assert.ok(fonts !== -1, 'Google Fonts link must exist');
  assert.ok(guard < fonts, 'FOUC guard must appear before the fonts link');

  assert.match(
    layout,
    /stored === 'light' \|\| stored === 'dark'/,
    'stored theme must be validated against light and dark only'
  );
  assert.match(layout, /name="theme-color"/);
  assert.match(layout, /theme === 'dark' \? '#1f2a25' : '#f2ecdd'/);
});

test('dark palette: periodic-table categories keep ink legible', () => {
  const categories = [
    'alk',
    'aec',
    'trn',
    'trm',
    'met',
    'rnm',
    'hln',
    'nbl',
    'lan',
    'act',
  ];
  const ink = token('--color-ink');

  for (const category of categories) {
    const ratio = contrastRatio(ink, token(`--pt-cat-${category}`));
    assert.ok(
      ratio >= 4.5,
      `--pt-cat-${category} against ink must be >= 4.5:1 (got ${ratio.toFixed(2)})`
    );
  }
});
