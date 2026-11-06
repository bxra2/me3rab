import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(
  new URL('../dist/معاجم/التغذية/index.html', import.meta.url)
);
const macroPath = fileURLToPath(
  new URL('../dist/nutrients/macronutrients.svg', import.meta.url)
);
const microPath = fileURLToPath(
  new URL('../dist/nutrients/micronutrients.svg', import.meta.url)
);
const oldMacroPath = fileURLToPath(
  new URL('../dist/nutrients/macronuentries.svg', import.meta.url)
);

if (!existsSync(pagePath)) {
  console.error(
    `nutrient page check failed: missing ${pagePath} — run npm run build first`
  );
  process.exit(1);
}

const html = readFileSync(pagePath, 'utf8').normalize('NFC');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const errors = [];

function count(needle) {
  return markup.split(needle).length - 1;
}

function expectCount(needle, expected) {
  const actual = count(needle);
  if (actual !== expected) {
    errors.push(`expected ${expected} × ${needle}, found ${actual}`);
  }
}

function expectText(text) {
  if (!markup.includes(text)) {
    errors.push(`missing required text/URL: ${text}`);
  }
}

expectCount('role="tablist"', 1);
expectCount('role="tabpanel"', 2);
expectText('id="nutrient-panel-macro"');
expectText('id="nutrient-panel-micro"');
expectText('aria-controls="nutrient-panel-macro"');
expectText('aria-controls="nutrient-panel-micro"');

expectCount('class="nutrient-dialog"', 41);

const termValues = [
  ...new Set(
    [...markup.matchAll(/data-nutrient="([^"]+)"/g)].map((match) => match[1])
  ),
];

for (const value of termValues) {
  if (!markup.includes(`id="nutrient-term-${value}"`)) {
    errors.push(`data-nutrient="${value}" has no matching dialog id`);
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

expectCount('class="nutrient-dialog-content"', 41);

if (markup.includes('لا اقتراحات تحريرية لهذا المصطلح')) {
  errors.push('no nutrient term may render an empty suggestions message');
}

const englishLabels = [
  ...markup.matchAll(/<bdi class="nutrient-(?:node|tab)-en"[^>]*>/g),
].map((match) => match[0]);

if (englishLabels.length === 0) {
  errors.push('expected English labels with lang="en"');
}
for (const label of englishLabels) {
  if (!label.includes('lang="en"')) {
    errors.push(`English label must declare lang="en": ${label}`);
  }
}

const dialogChunks = markup
  .split('<dialog class="nutrient-dialog"')
  .slice(1);

for (const [index, chunk] of dialogChunks.entries()) {
  const figure = chunk.indexOf('class="nutrient-dialog-figure"');
  const translations = chunk.indexOf('class="nutrient-dialog-translations"');

  if (figure === -1 || translations === -1) {
    errors.push(`dialog ${index} is missing its figure or translations`);
  } else if (figure > translations) {
    errors.push(`dialog ${index} figure must precede translations in DOM order`);
  }
}

if (!html.includes('history.replaceState')) {
  errors.push('page script must contain history.replaceState');
}

const pageSize = statSync(pagePath).size;
if (pageSize >= 420 * 1024) {
  errors.push(`page HTML must be < 420 KiB, found ${pageSize} bytes`);
}

for (const [href, path] of [
  ['/nutrients/macronutrients.svg', macroPath],
  ['/nutrients/micronutrients.svg', microPath],
]) {
  expectText(`href="${href}"`);
  if (!existsSync(path)) {
    errors.push(`missing built SVG: ${path}`);
  }
}

if (existsSync(oldMacroPath)) {
  errors.push('legacy macronuentries.svg must not be copied to dist/nutrients');
}

expectCount('<img', 0);

if (errors.length > 0) {
  console.error('nutrient page check failed:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('nutrient page check passed');
console.log(` - page: ${pageSize} bytes`);
console.log(` - referenced terms: ${termValues.length}`);
console.log(` - dialogs: ${count('class="nutrient-dialog"')}`);
for (const path of [macroPath, microPath]) {
  if (existsSync(path)) {
    console.log(` - ${path.split('/').pop()}: ${statSync(path).size} bytes`);
  }
}
