import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(
  new URL('../dist/معاجم/الكيمياء/index.html', import.meta.url)
);
const atomSvgPath = fileURLToPath(
  new URL('../dist/atoms/atom.svg', import.meta.url)
);
const oldAtomSvgPath = fileURLToPath(
  new URL('../dist/atom.svg', import.meta.url)
);

if (!existsSync(pagePath)) {
  console.error(
    `atom page check failed: missing ${pagePath} — run npm run build first`
  );
  process.exit(1);
}

const html = readFileSync(pagePath, 'utf8').normalize('NFC');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const errors = [];

function count(needle) {
  return markup.split(needle).length - 1;
}

function expectText(text) {
  if (!markup.includes(text)) {
    errors.push(`missing required text/URL: ${text}`);
  }
}

expectText('class="periodic-table"');
expectText('مصطلحات الذرّة');

const dialogCount = count('class="nutrient-dialog atom-dialog"');
if (dialogCount !== 39) {
  errors.push(`expected 39 × class="nutrient-dialog atom-dialog", found ${dialogCount}`);
}

const termValues = [
  ...new Set(
    [...markup.matchAll(/data-atom="([^"]+)"/g)].map((match) => match[1])
  ),
];

if (termValues.length !== 39) {
  errors.push(`expected 39 unique data-atom values, found ${termValues.length}`);
}

for (const value of termValues) {
  if (!markup.includes(`id="atom-term-${value}"`)) {
    errors.push(`data-atom="${value}" has no matching dialog id`);
  }
}

const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const seen = new Map();
for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
for (const [id, occurrences] of seen) {
  if (occurrences > 1) {
    errors.push(`duplicate DOM id "${id}" appears ${occurrences} times`);
  }
}

const pageSize = statSync(pagePath).size;
if (pageSize >= 800 * 1024) {
  errors.push(`page HTML must be < 800 KiB, found ${pageSize} bytes`);
}

if (!existsSync(atomSvgPath)) {
  errors.push(`missing built SVG: ${atomSvgPath}`);
}

if (existsSync(oldAtomSvgPath)) {
  errors.push('legacy atom.svg must not remain at the root of dist');
}

expectText('href="/atoms/atom.svg"');

if (html.includes('href="/atom.svg"')) {
  errors.push('page must not reference the old root atom.svg path');
}

const atomLink = markup.match(
  /<a\b[^>]*href="\/atoms\/atom\.svg"[^>]*>/
);
if (!atomLink) {
  errors.push('missing anchor for /atoms/atom.svg');
} else if (!/\bdownload\b/.test(atomLink[0])) {
  errors.push('the atom SVG link must have a download attribute');
}

if (markup.includes('<img')) {
  errors.push('page must not contain an <img> element');
}

if (errors.length > 0) {
  console.error('atom page check failed:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('atom page check passed');
console.log(` - page: ${pageSize} bytes`);
console.log(` - atom terms: ${termValues.length}`);
console.log(` - dialogs: ${dialogCount}`);
