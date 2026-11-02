import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(
  new URL('../dist/معاجم/التشريح/index.html', import.meta.url)
);
const frontPath = fileURLToPath(
  new URL('../dist/muscles/male_front_muscle_anatomy.svg', import.meta.url)
);
const backPath = fileURLToPath(
  new URL('../dist/muscles/male_back_muscle_anatomy.svg', import.meta.url)
);

if (!existsSync(pagePath)) {
  console.error(
    `muscle page check failed: missing ${pagePath} — run npm run build first`
  );
  process.exit(1);
}

const html = readFileSync(pagePath, 'utf8').normalize('NFC');
const errors = [];

function count(needle) {
  return html.split(needle).length - 1;
}

function expectCount(needle, expected) {
  const actual = count(needle);
  if (actual !== expected) {
    errors.push(`expected ${expected} × ${needle}, found ${actual}`);
  }
}

function expectText(text) {
  if (!html.includes(text)) {
    errors.push(`missing required text/URL: ${text}`);
  }
}

function expectAbsent(text) {
  if (html.includes(text)) {
    errors.push(`forbidden legacy reference present: ${text}`);
  }
}

expectCount('class="muscle-svg male-front-svg"', 1);
expectCount('class="muscle-svg male-back-svg"', 1);
expectCount('class="muscle-shape"', 139);
expectCount('data-side=', 139);
expectCount('data-view=', 139);
expectCount('data-muscle=', 187);
expectCount('class="muscle-index"', 1);
expectCount('<dialog', 1);
expectCount('fill="none"', 2);
expectCount('<img', 0);
expectCount('--muscle-figure-rev', 1);
expectCount('opacity:.6', 2);
expectCount('<g id=', 0);
expectCount('id="gastrocnemius_l"', 0);
expectCount('id="underlayer"', 0);
expectAbsent('c54d4d');

expectText('href="/muscles/male_front_muscle_anatomy.svg"');
expectText('href="/muscles/male_back_muscle_anatomy.svg"');
expectText('Ryan Graves');
expectText('https://creativecommons.org/licenses/by/4.0/');
expectText('https://github.com/suryamolly/muscle_mapper');
expectText(
  'https://www.figma.com/community/file/1320468164820924031/human-anatomy-component-system'
);

expectAbsent('OpenStax');
expectAbsent('snaprepo');
expectAbsent('by-sa');
expectAbsent('muscles_full.svg');
expectAbsent('body-muscles');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const seen = new Map();
for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
for (const [id, occurrences] of seen) {
  if (occurrences > 1) {
    errors.push(`duplicate DOM id "${id}" appears ${occurrences} times`);
  }
}

const allowedIds = new Set([
  'muscle-dialog-title',
  'muscle-dialog-desc',
  'muscle-groups-data',
]);
for (const id of new Set(ids)) {
  if (!allowedIds.has(id)) {
    errors.push(`unexpected DOM id "${id}"`);
  }
}

for (const path of [frontPath, backPath]) {
  if (!existsSync(path)) {
    errors.push(`missing built SVG: ${path}`);
  }
}

const pageSize = statSync(pagePath).size;
if (pageSize >= 420 * 1024) {
  errors.push(`page HTML must be < 420 KiB, found ${pageSize} bytes`);
}

if (errors.length > 0) {
  console.error('muscle page check failed:');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('muscle page check passed');
console.log(` - page: ${pageSize} bytes`);
for (const path of [frontPath, backPath]) {
  if (existsSync(path)) {
    console.log(` - ${path.split('/').pop()}: ${statSync(path).size} bytes`);
  }
}
