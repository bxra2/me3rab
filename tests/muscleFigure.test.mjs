import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const data = JSON.parse(
  readFileSync(
    new URL('../src/data/muscles/body-muscles.json', import.meta.url),
    'utf8'
  )
);
const groups = data.groups;

const svgPaths = {
  front: fileURLToPath(
    new URL('../public/muscles/male_front_muscle_anatomy.svg', import.meta.url)
  ),
  back: fileURLToPath(
    new URL('../public/muscles/male_back_muscle_anatomy.svg', import.meta.url)
  ),
};
const svgs = {
  front: readFileSync(svgPaths.front, 'utf8'),
  back: readFileSync(svgPaths.back, 'utf8'),
};

const component = readFileSync(
  new URL('../src/components/MuscleFigure.astro', import.meta.url),
  'utf8'
).normalize('NFC');
const css = readFileSync(
  new URL('../src/components/muscle-figure.css', import.meta.url),
  'utf8'
).normalize('NFC');
const notice = readFileSync(
  new URL('../src/data/muscles/NOTICE.md', import.meta.url),
  'utf8'
).normalize('NFC');
const readme = readFileSync(
  new URL('../src/data/muscles/README.md', import.meta.url),
  'utf8'
).normalize('NFC');
const page = readFileSync(
  new URL('../src/pages/معاجم/التشريح.astro', import.meta.url),
  'utf8'
).normalize('NFC');

const VALID_REGIONS = new Set([
  'chest',
  'core',
  'adductors',
  'arms',
  'shoulders',
  'back',
  'glutes',
  'legs',
  'neck',
]);
const EXCLUDED = {
  front: /^(?:underlayer|hand_|foot_|ankle_|iliotibial_tract_)/,
  back: /^(?:underlayer|hand_|wrist_|palm_|iliotibial_tract_)/,
};
const HASHES = {
  front: {
    sha1: 'edfbc2102fac0ba294ccbfca6bf084df4850e129',
    sha256: 'fb7a1d4933820843446966bda10a915975364589048e509f124067d4211aea26',
  },
  back: {
    sha1: '0cf50f25f050fa360bcb107147f28573f18f6487',
    sha256: '764b128436ffe5bbe05663c019692601c7e6291c7727c4b311f669fb95927af1',
  },
};

function extractMediaBlocks(source, query) {
  const blocks = [];
  const starts = [`@media (${query}) {`, `@media ${query} {`];
  let idx = 0;
  while (true) {
    let start = -1;
    let marker = '';
    for (const candidate of starts) {
      const found = source.indexOf(candidate, idx);
      if (found !== -1 && (start === -1 || found < start)) {
        start = found;
        marker = candidate;
      }
    }
    if (start === -1) break;

    const open = start + marker.length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(source.slice(open + 1, end));
    idx = end + 1;
  }
  return blocks;
}

function stripMediaBlocks(source) {
  let result = source;
  for (const query of [
    'hover: hover',
    'max-width: 50rem',
    'prefers-reduced-motion: reduce',
    'print',
    'forced-colors: active',
  ]) {
    for (const block of extractMediaBlocks(result, query)) {
      result = result.replace(block, '');
    }
  }
  return result;
}

const pathIds = {
  front: [...svgs.front.matchAll(/<path\b[^>]*?\bid="([^"]+)"/g)].map(
    (match) => match[1]
  ),
  back: [...svgs.back.matchAll(/<path\b[^>]*?\bid="([^"]+)"/g)].map(
    (match) => match[1]
  ),
};
const groupIds = {
  front: [...svgs.front.matchAll(/<g\b[^>]*?\bid="([^"]+)"/g)],
  back: [...svgs.back.matchAll(/<g\b[^>]*?\bid="([^"]+)"/g)],
};
const mapped = {
  front: Object.values(groups).flatMap((meta) => meta.views.front ?? []),
  back: Object.values(groups).flatMap((meta) => meta.views.back ?? []),
};
const expectedMusclePaths = {
  front: pathIds.front.filter((id) => !EXCLUDED.front.test(id)),
  back: pathIds.back.filter((id) => !EXCLUDED.back.test(id)),
};

test('body muscle data: 48 groups and 139 mapped path entries', () => {
  assert.equal(Object.keys(groups).length, 48, 'body-muscles.json must define 48 groups');
  assert.equal(mapped.front.length, 87, 'front view must map 87 paths');
  assert.equal(mapped.back.length, 52, 'back view must map 52 paths');
  assert.equal(mapped.front.length + mapped.back.length, 139, 'both views must map 139 paths');
  assert.equal(new Set(mapped.front).size, 87, 'front paths must be unique within the view');
  assert.equal(new Set(mapped.back).size, 52, 'back paths must be unique within the view');
});

test('body muscle data: every mapped path exists in its SVG', () => {
  const frontIds = new Set(pathIds.front);
  const backIds = new Set(pathIds.back);
  for (const id of mapped.front) {
    assert.ok(frontIds.has(id), `front path "${id}" must exist in the front SVG`);
  }
  for (const id of mapped.back) {
    assert.ok(backIds.has(id), `back path "${id}" must exist in the back SVG`);
  }
});

test('body muscle data: required fields are non-empty and NFC', () => {
  for (const [key, meta] of Object.entries(groups)) {
    assert.equal(key, key.normalize('NFC'), `group key "${key}" must be NFC`);
    for (const field of ['ar', 'en', 'desc', 'region']) {
      assert.equal(typeof meta[field], 'string', `group "${key}" ${field} must be a string`);
      assert.ok(meta[field].trim().length > 0, `group "${key}" ${field} must be non-empty`);
      assert.equal(meta[field], meta[field].normalize('NFC'), `group "${key}" ${field} must be NFC`);
    }
    assert.deepEqual(Object.keys(meta.views).sort(), ['back', 'front'], `group "${key}" must have front/back views`);
    for (const view of ['front', 'back']) {
      assert.ok(Array.isArray(meta.views[view]), `group "${key}" ${view} must be an array`);
      for (const id of meta.views[view]) {
        assert.equal(id, id.normalize('NFC'), `group "${key}" ${view} path must be NFC`);
      }
    }
  }
});

test('body muscle data: regions are from the known set', () => {
  for (const [key, meta] of Object.entries(groups)) {
    assert.ok(VALID_REGIONS.has(meta.region), `group "${key}" has unknown region "${meta.region}"`);
  }
});

test('body muscle data: named muscle paths are mapped exactly once and exclusions are absent', () => {
  for (const view of ['front', 'back']) {
    const expected = new Set(expectedMusclePaths[view]);
    const actual = new Set(mapped[view]);
    for (const id of expectedMusclePaths[view]) {
      assert.ok(actual.has(id), `${view} named muscle path "${id}" must be mapped`);
    }
    for (const id of mapped[view]) {
      assert.ok(expected.has(id), `${view} mapped path "${id}" must not be excluded/unnamed`);
    }
    assert.equal(mapped[view].length, expected.size, `${view} mapped paths must cover the named muscles exactly once`);
  }
});

test('body muscle data: 24 front-only, 13 back-only, 11 both-view groups', () => {
  let frontOnly = 0;
  let backOnly = 0;
  let both = 0;
  for (const meta of Object.values(groups)) {
    const hasFront = (meta.views.front ?? []).length > 0;
    const hasBack = (meta.views.back ?? []).length > 0;
    assert.ok(hasFront || hasBack, 'every group must belong to at least one view');
    if (hasFront && hasBack) both++;
    else if (hasFront) frontOnly++;
    else backOnly++;
  }
  assert.equal(frontOnly, 24, 'expected 24 front-only groups');
  assert.equal(backOnly, 13, 'expected 13 back-only groups');
  assert.equal(both, 11, 'expected 11 shared groups');
});

test('body muscle SVGs: counts, roots, and documented hashes', () => {
  assert.match(svgs.front, /<svg\b[^>]*\bfill="none"/, 'front root must keep fill="none"');
  assert.match(svgs.back, /<svg\b[^>]*\bfill="none"/, 'back root must keep fill="none"');
  assert.equal([...svgs.front.matchAll(/<path\b/g)].length, 126, 'front source must have 126 paths');
  assert.equal(pathIds.front.length, 96, 'front source must have 96 named paths');
  assert.equal(groupIds.front.length, 11, 'front source must have 11 group ids');
  assert.equal([...svgs.back.matchAll(/<path\b/g)].length, 80, 'back source must have 80 paths');
  assert.equal(pathIds.back.length, 61, 'back source must have 61 named paths');
  assert.equal(groupIds.back.length, 12, 'back source must have 12 group ids');
  assert.equal(expectedMusclePaths.front.length, 87, 'front must expose 87 muscle paths');
  assert.equal(expectedMusclePaths.back.length, 52, 'back must expose 52 muscle paths');

  for (const view of ['front', 'back']) {
    const file = readFileSync(svgPaths[view]);
    assert.equal(createHash('sha1').update(file).digest('hex'), HASHES[view].sha1, `${view} SHA-1 must match`);
    assert.equal(createHash('sha256').update(file).digest('hex'), HASHES[view].sha256, `${view} SHA-256 must match`);
  }
});

test('muscle component: imports merged data and processes both SVGs', () => {
  assert.match(
    component,
    /import\s+data\s+from\s+['"]\.\.\/data\/muscles\/body-muscles\.json['"]/,
    'component must import body-muscles.json'
  );
  assert.match(component, /male_front_muscle_anatomy\.svg/, 'component must read the front SVG');
  assert.match(component, /male_back_muscle_anatomy\.svg/, 'component must read the back SVG');
  assert.match(component, /readFileSync\(svgFile, 'utf8'\)/, 'component must read SVGs at build time');
  assert.match(component, /expectedPaths:\s*87/, 'front replacement count must be validated at 87');
  assert.match(component, /expectedPaths:\s*52/, 'back replacement count must be validated at 52');
  assert.match(component, /replaced\s*!==\s*view\.expectedPaths/, 'replacement mismatch must throw');
  assert.match(component, /male-front-svg/, 'front SVG class must be present');
  assert.match(component, /male-back-svg/, 'back SVG class must be present');
  assert.match(component, /class="muscle-svg \$\{view\.className\}"/, 'both roots must share .muscle-svg');
  assert.ok(
    component.includes(String.raw`svg.replace(/(<path\b[^>]*?)\sid="[^"]*"/g, '$1')`),
    'component must strip ids from every path after annotation'
  );
});

test('muscle component: interactive contract and accessible index', () => {
  assert.match(component, /role="img"/, 'SVG must declare role="img"');
  assert.match(component, /<title>/, 'SVG must contain a <title>');
  assert.match(component, /class="muscle-shape"/, 'paths must receive .muscle-shape');
  assert.match(component, /data-muscle=/, 'paths/buttons must receive data-muscle');
  assert.match(component, /data-side=/, 'paths must receive data-side');
  assert.match(component, /data-view=/, 'paths must receive data-view');
  assert.match(component, /<details class="muscle-index"/, 'index must be a details element');
  assert.match(component, /<summary>/, 'index must render a summary');
  assert.match(component, /groupEntries\.map/, 'index buttons must be data-driven');
  assert.match(component, /aria-haspopup="dialog"/, 'index buttons must declare dialog popup');
  assert.match(component, /class="term-dialog muscle-dialog"/, 'component must render the dialog');
  assert.match(component, /data-muscle-close/, 'dialog must have a close control');
  assert.match(component, /id="muscle-dialog-title"/, 'dialog must have a title id');
  assert.match(component, /showModal\(\)/, 'script must call showModal()');
  assert.match(component, /\.textContent\s*=/, 'script must set dialog text via textContent');
  assert.doesNotMatch(component, /innerHTML/, 'script must not use innerHTML');
  assert.match(
    component,
    /set:html=\{JSON\.stringify\(groups\)\.replace\(\/<\/g, '\\\\u003c'\)\}/,
    'embedded groups JSON must escape < as \\u003c'
  );
  assert.doesNotMatch(component, /JSON\.stringify\(svg\)/, 'must not embed the SVG JSON');
  assert.match(component, /details\.open = true/, 'close handler must open the index');
  assert.doesNotMatch(component, /tabindex/i, 'muscle shapes must not be keyboard-focusable');
});

test('muscle component: view/side labels and dialog behavior', () => {
  assert.match(component, /المنظران: أمامي وخلفي/, 'script must label groups present in both views');
  assert.match(component, /الجهة: اليسرى/, 'script must label the left side');
  assert.match(component, /الجهة: اليمنى/, 'script must label the right side');
  assert.match(component, /كلتا الجهتين/, 'script must label both sides');
  assert.match(component, /خط الوسط/, 'script must label the midline');
  assert.match(component, /dialog\.close\(\)/, 'dialog must close via the close control/backdrop');
  assert.match(component, /window\.setTimeout/, 'focus restoration must be asynchronous');
  assert.match(component, /preventScroll:\s*true/, 'focus restoration must prevent scrolling');
});

test('muscle CSS: pointer rules, hover scope, active state, and responsive grid', () => {
  assert.match(css, /--muscle-figure-rev:\s*3/, 'CSS must carry revision 3');
  assert.match(
    css,
    /\.muscle-svg path\s*\{[^}]*pointer-events:\s*none/,
    'all SVG paths must ignore pointer events by default'
  );
  assert.match(
    css,
    /\.muscle-svg \.muscle-shape\s*\{[^}]*pointer-events:\s*auto[^}]*cursor:\s*pointer[^}]*transition:/,
    'muscle shapes must opt back into pointer events and transitions'
  );
  assert.match(
    css,
    /\.muscle-views\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    'views must use a two-column grid'
  );
  assert.match(
    css,
    /@media \(max-width: 50rem\)\s*\{[\s\S]*?\.muscle-views\s*\{[^}]*grid-template-columns:\s*1fr/,
    'views must stack at 50rem'
  );

  const hoverBlocks = extractMediaBlocks(css, 'hover: hover');
  assert.ok(
    hoverBlocks.some((block) => block.includes('.muscle-shape:hover')),
    'hover styling must live inside @media (hover: hover)'
  );
  const withoutMedia = stripMediaBlocks(css);
  assert.doesNotMatch(
    withoutMedia,
    /\.muscle-shape:hover/,
    'hover styling must not exist outside the hover media query'
  );
  assert.match(
    withoutMedia,
    /\.muscle-shape\.is-active/,
    'the is-active state must exist outside the hover media query'
  );
  assert.match(
    css,
    /\.muscle-shape\.is-active\s*\{[^}]*opacity:\s*0?\.6[^}]*stroke:\s*var\(--color-accent\)[^}]*stroke-width:\s*1\.4/,
    'active shapes must use opacity .6, accent stroke, and 1.4 width'
  );
  assert.match(css, /\.muscle-index button:focus-visible/, 'index buttons need :focus-visible');
  assert.match(css, /\.muscle-index summary:focus-visible/, 'index summary needs :focus-visible');
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.muscle-shape\s*\{[^}]*transition:\s*none/,
    'reduced motion must disable the shape transition'
  );

  const printBlock = extractMediaBlocks(css, 'print')[0] ?? '';
  assert.match(
    printBlock,
    /\.muscle-dialog,[\s\S]*?\.muscle-index,[\s\S]*?\.muscle-hint\s*\{[^}]*display:\s*none/,
    'print must hide the dialog, index, and hint in the same rule'
  );
  assert.doesNotMatch(printBlock, /--muscle-figure-rev/, 'the revision marker must not be inside the print block');
  assert.doesNotMatch(
    css,
    /^(?:body|svg|path|dialog)\b/m,
    'CSS must not contain top-level body/svg/path/dialog element rules'
  );
});

test('muscle provenance: NOTICE, README, and CC BY 4.0 license cover both SVGs', () => {
  for (const [name, text] of [
    ['NOTICE', notice],
    ['README', readme],
  ]) {
    assert.match(text, /Ryan Graves/, `${name} must credit Ryan Graves`);
    assert.match(text, /CC BY 4\.0/, `${name} must reference CC BY 4.0`);
    assert.match(text, /muscle_mapper/, `${name} must reference muscle_mapper`);
    assert.match(
      text,
      /https:\/\/www\.figma\.com\/community\/file\/1320468164820924031\/human-anatomy-component-system/,
      `${name} must link the Figma Community asset`
    );
    for (const view of ['front', 'back']) {
      assert.match(text, new RegExp(HASHES[view].sha1), `${name} must document the ${view} SHA-1`);
      assert.match(text, new RegExp(HASHES[view].sha256), `${name} must document the ${view} SHA-256`);
    }
  }

  const licensePath = fileURLToPath(
    new URL('../src/data/muscles/LICENSE-CC-BY-4.0.txt', import.meta.url)
  );
  assert.ok(existsSync(licensePath), 'LICENSE-CC-BY-4.0.txt must exist');
  assert.ok(statSync(licensePath).size > 1000, 'license must be larger than 1000 bytes');
  const license = readFileSync(licensePath, 'utf8');
  assert.match(license, /Attribution 4\.0 International/, 'license must be the CC BY 4.0 legal text');
});

test('muscle page: both views, both downloads, and no legacy attribution', () => {
  assert.match(page, /<MuscleFigure\s*\/>/, 'page must render MuscleFigure');
  assert.match(page, /<h2>عضلات المنظرين الأمامي والخلفي<\/h2>/, 'page must be front+back');
  assert.match(
    page,
    /href=\{`\$\{base\}muscles\/male_front_muscle_anatomy\.svg`\}[^>]*download/,
    'page must offer the front SVG download'
  );
  assert.match(
    page,
    /href=\{`\$\{base\}muscles\/male_back_muscle_anatomy\.svg`\}[^>]*download/,
    'page must offer the back SVG download'
  );
  assert.match(page, /Ryan Graves/, 'page must credit Ryan Graves');
  assert.match(page, /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//, 'page must link CC BY 4.0');
  assert.match(page, /muscle_mapper/, 'page must credit muscle_mapper');
  assert.match(
    page,
    /https:\/\/www\.figma\.com\/community\/file\/1320468164820924031\/human-anatomy-component-system/,
    'page must link the Figma Community asset'
  );
  assert.doesNotMatch(page, /OpenStax/i, 'page must not mention OpenStax');
  assert.doesNotMatch(page, /snaprepo/i, 'page must not mention snaprepo');
  assert.doesNotMatch(page, /by-sa/i, 'page must not mention BY-SA');
  assert.doesNotMatch(page, /muscles_full\.svg/, 'page must not reference the old static atlas');
  assert.doesNotMatch(page, /body-muscles/i, 'page must not mention the old body-muscles attribution');
  assert.doesNotMatch(page, /<img\b/i, 'page must not contain a static <img>');
});
