import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  collectTermIds,
  validateNutrients,
  walkDiagramTerms,
} from '../src/utils/nutrients.mjs';

const data = JSON.parse(
  readFileSync(new URL('../src/data/nutrients.json', import.meta.url), 'utf8')
);
const component = readFileSync(
  new URL('../src/components/NutrientExplorer.astro', import.meta.url),
  'utf8'
).normalize('NFC');
const css = readFileSync(
  new URL('../src/components/nutrient-explorer.css', import.meta.url),
  'utf8'
).normalize('NFC');
const page = readFileSync(
  new URL('../src/pages/معاجم/التغذية.astro', import.meta.url),
  'utf8'
).normalize('NFC');
const hubCategories = JSON.parse(
  readFileSync(
    new URL('../src/data/glossary-categories.json', import.meta.url),
    'utf8'
  )
);
const notice = readFileSync(
  new URL('../src/data/nutrients/NOTICE.md', import.meta.url),
  'utf8'
).normalize('NFC');

const EXPECTED_IDS = [
  'macronutrients',
  'carbohydrates',
  'sugars',
  'monosaccharides',
  'disaccharides',
  'polyols',
  'polysaccharides',
  'starch',
  'glycogen',
  'fibre',
  'proteins',
  'amino-acids',
  'essential-amino-acids',
  'non-essential-amino-acids',
  'protein-quality',
  'complete-protein',
  'incomplete-protein',
  'fats-lipids',
  'triglycerides',
  'saturated-fat',
  'unsaturated-fat',
  'trans-fat',
  'monounsaturated-fat',
  'polyunsaturated-fat',
  'essential-fatty-acids',
  'phospholipids',
  'sterols',
  'cholesterol',
  'micronutrients',
  'vitamins',
  'fat-soluble-vitamins',
  'water-soluble-vitamins',
  'vitamin-a',
  'vitamin-d',
  'vitamin-e',
  'vitamin-k',
  'b-complex',
  'vitamin-c',
  'minerals',
  'major-minerals',
  'trace-minerals',
];

const INVISIBLE_BIDI = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/;

function cloneData() {
  return structuredClone(data);
}

function stripAtRules(source) {
  let result = '';
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('@media', index)) {
      const open = source.indexOf('{', index);
      if (open === -1) break;

      let depth = 0;
      let cursor = open;
      for (; cursor < source.length; cursor++) {
        if (source[cursor] === '{') depth++;
        else if (source[cursor] === '}') {
          depth--;
          if (depth === 0) {
            cursor++;
            break;
          }
        }
      }

      index = cursor;
      continue;
    }

    result += source[index];
    index++;
  }

  return result;
}

function topLevelSelectors(source) {
  const withoutComments = stripAtRules(source).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];

  for (const chunk of withoutComments.split('}')) {
    const before = chunk.split('{')[0];
    if (!before) continue;

    for (const part of before.split(',')) {
      const selector = part.trim();
      if (selector) selectors.push(selector);
    }
  }

  return selectors;
}

test('nutrient data: validator accepts the shipped data', () => {
  const result = validateNutrients(data);
  assert.deepEqual(result.errors, []);
});

test('nutrient validator: dangling branch and column terms are reported', () => {
  const broken = cloneData();
  const branch = broken.diagrams[0].groups[0].branches[0];
  const column = branch.columns[0];

  branch.terms = [...(branch.terms ?? []), 'missing-branch-term'];
  column.terms = [...(column.terms ?? []), 'missing-column-term'];

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) => error.includes('missing-branch-term')),
    'validator must report a dangling branch term'
  );
  assert.ok(
    errors.some((error) => error.includes('missing-column-term')),
    'validator must report a dangling column term'
  );
});

test('nutrient validator: orphan terms are reported', () => {
  const broken = cloneData();
  broken.terms['orphan-term'] = structuredClone(broken.terms.macronutrients);

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some(
      (error) =>
        error.includes('orphan-term') && error.includes('never referenced')
    ),
    'validator must report terms that are defined but never referenced'
  );
});

test('nutrient validator: branches need a term or label', () => {
  const broken = cloneData();
  const branch = broken.diagrams[0].groups[0].branches[0];
  delete branch.term;
  delete branch.label;

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) => error.includes('must have a term or label')),
    'validator must reject branches without a term or label'
  );
});

test('nutrient validator: missing required language is reported', () => {
  const broken = cloneData();
  broken.terms.proteins.languages = broken.terms.proteins.languages.filter(
    (item) => item.language !== 'الفرنسية'
  );

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('terms.proteins.languages must include الفرنسية')
    ),
    'validator must report a missing required language'
  );
});

test('nutrient validator: empty languages cannot skip required-language checks', () => {
  const broken = cloneData();
  broken.terms.macronutrients.languages = [];

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('terms.macronutrients.languages must be a non-empty array')
    ),
    'validator must reject empty language arrays'
  );
  for (const language of REQUIRED_LANGUAGES) {
    assert.ok(
      errors.some((error) =>
        error.includes(`terms.macronutrients.languages must include ${language}`)
      ),
      `validator must still require ${language} for an empty language array`
    );
  }
});

test('nutrient validator: missing column term is reported', () => {
  const broken = cloneData();
  const column = broken.diagrams[0].groups[0].branches[0].columns[0];
  delete column.term;

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('columns[0].term must be a non-empty string')
    ),
    'validator must report a missing column term'
  );
});

test('nutrient validator: missing root term is reported', () => {
  const broken = cloneData();
  delete broken.diagrams[0].root.term;

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('diagrams[0].root.term must be a non-empty string')
    ),
    'validator must report a missing root term'
  );
});

test('nutrient validator: non-array columns are reported', () => {
  const broken = cloneData();
  const branch = broken.diagrams[0].groups[0].branches[0];
  branch.columns = {};

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) => error.includes('.columns must be an array')),
    'validator must reject non-array columns'
  );
});

test('nutrient validator: unsupported group accent is reported', () => {
  const broken = cloneData();
  broken.diagrams[0].groups[0].accent = 'rainbow';

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('.accent must be one of accent/secondary/ink')
    ),
    'validator must reject unsupported accents'
  );
});

test('nutrient validator: unsafe href values are reported', () => {
  const broken = cloneData();
  broken.terms.macronutrients.references[0].href =
    'javascript:alert(document.domain)';

  const { errors } = validateNutrients(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('.references[0].href must be an http(s) or site-relative URL')
    ),
    'validator must reject javascript: URLs'
  );
});

test('nutrient data: exactly the 41 approved term ids', () => {
  assert.equal(Object.keys(data.terms).length, 41);
  assert.deepEqual(Object.keys(data.terms), EXPECTED_IDS);
  assert.deepEqual(collectTermIds(data), EXPECTED_IDS);
});

test('nutrient data: required fields, references, translations and suggestions', () => {
  for (const [id, term] of Object.entries(data.terms)) {
    for (const field of [
      'ar',
      'en',
      'origin',
      'arabicMeaning',
      'description',
    ]) {
      assert.equal(
        typeof term[field],
        'string',
        `terms.${id}.${field} must be a string`
      );
      assert.ok(
        term[field].trim().length > 0,
        `terms.${id}.${field} must be non-empty`
      );
      assert.equal(
        term[field],
        term[field].normalize('NFC'),
        `terms.${id}.${field} must be NFC`
      );
      assert.doesNotMatch(
        term[field],
        INVISIBLE_BIDI,
        `terms.${id}.${field} must not contain invisible bidi characters`
      );
    }

    assert.ok(
      Array.isArray(term.references) && term.references.length > 0,
      `terms.${id}.references must be a non-empty array`
    );
    for (const reference of term.references) {
      assert.ok(
        typeof reference.name === 'string' && reference.name.trim().length > 0,
        `terms.${id} reference name must be non-empty`
      );
    }

    for (const key of ['translations', 'suggestions']) {
      assert.ok(Array.isArray(term[key]), `terms.${id}.${key} must be an array`);
      for (const item of term[key]) {
        assert.ok(
          typeof item.term === 'string' && item.term.trim().length > 0,
          `terms.${id}.${key} item needs a non-empty term`
        );
        assert.ok(
          typeof item.source === 'string' && item.source.trim().length > 0,
          `terms.${id}.${key} item needs a non-empty source`
        );
      }
    }
  }
});

test('nutrient data: every one of the 41 terms has an editorial suggestion', () => {
  for (const [id, term] of Object.entries(data.terms)) {
    assert.ok(
      Array.isArray(term.suggestions) && term.suggestions.length > 0,
      `terms.${id}.suggestions must be a non-empty array`
    );
    for (const suggestion of term.suggestions) {
      assert.ok(
        typeof suggestion.note === 'string' &&
          suggestion.note.trim().length > 0,
        `terms.${id}.suggestions item needs a non-empty note`
      );
    }
  }

  assert.equal(Object.keys(data.terms).length, 41);
});

test('nutrient data: mandatory French, German and Spanish languages', () => {
  for (const [id, term] of Object.entries(data.terms)) {
    assert.ok(
      Array.isArray(term.languages) && term.languages.length >= 3,
      `terms.${id}.languages must have at least three entries`
    );

    const languages = new Set();
    for (const item of term.languages) {
      assert.ok(
        typeof item.language === 'string' && item.language.trim().length > 0,
        `terms.${id} language entry needs a language`
      );
      assert.ok(
        typeof item.term === 'string' && item.term.trim().length > 0,
        `terms.${id} language entry needs a term`
      );
      assert.doesNotMatch(
        item.language,
        INVISIBLE_BIDI,
        `terms.${id} language must not contain invisible bidi characters`
      );
      assert.doesNotMatch(
        item.term,
        INVISIBLE_BIDI,
        `terms.${id} language term must not contain invisible bidi characters`
      );
      languages.add(item.language);
    }
  }
});

test('nutrient data: every term is referenced and every reference exists', () => {
  const referenced = data.diagrams.flatMap(walkDiagramTerms);
  const referencedSet = new Set(referenced);
  const defined = new Set(collectTermIds(data));

  assert.deepEqual([...referencedSet].sort(), [...defined].sort());
  for (const id of referenced) {
    assert.ok(defined.has(id), `referenced term "${id}" must be defined`);
  }
  for (const id of EXPECTED_IDS) {
    assert.ok(referencedSet.has(id), `approved term "${id}" must be referenced`);
  }
});

test('nutrient component: data, style and validator wiring', () => {
  assert.match(
    component,
    /import\s+['"]\.\/nutrient-explorer\.css['"]/,
    'component must import its stylesheet'
  );
  assert.match(
    component,
    /import\s+nutrients\s+from\s+['"]\.\.\/data\/nutrients\.json['"]/,
    'component must import ../data/nutrients.json'
  );
  assert.match(
    component,
    /import\s+\{[^}]*validateNutrients[^}]*\}\s+from\s+['"]\.\.\/utils\/nutrients\.mjs['"]/,
    'component must import the shared validator'
  );
  assert.match(
    component,
    /toArabicDigits/,
    'component must use the shared Arabic digit helper'
  );
  assert.match(component, /\.map\(/, 'component must render from data with .map');
  assert.match(
    component,
    /throw new Error/,
    'component must throw when validation fails'
  );
});

test('nutrient component: tabs, panels, dialogs and accessibility contract', () => {
  assert.match(component, /data-nutrient-explorer/, 'root hook must exist');
  assert.match(component, /role="tablist"/, 'tabs need a tablist');
  assert.match(component, /role="tab"/, 'tabs need role="tab"');
  assert.match(component, /role="tabpanel"/, 'panels need role="tabpanel"');
  assert.match(component, /aria-controls=/, 'tabs must point at panels');
  assert.match(component, /aria-selected=/, 'tabs must expose aria-selected');
  assert.match(component, /aria-labelledby=/, 'panels/dialogs need labels');
  assert.match(component, /aria-haspopup="dialog"/, 'openers must declare a dialog');
  assert.match(component, /<dialog/, 'component must render dialogs');
  assert.match(component, /data-nutrient-close/, 'dialogs need a close control');
  assert.match(component, /showModal\(\)/, 'script must open dialogs with showModal');
  assert.match(component, /dir="rtl"/, 'dialogs must be RTL');
  assert.match(component, /lang="ar"/, 'dialogs must declare Arabic');
  assert.match(
    component,
    /nutrient-dialog-title-\$\{/,
    'each dialog needs a unique title id'
  );
  assert.match(
    component,
    /nutrient-dialog-desc-\$\{/,
    'each dialog needs a unique description id'
  );
  assert.match(component, /class="nutrient-dialog"/, 'dialogs must use the class');
  assert.match(component, /class="nutrient-empty"/, 'empty states must be rendered');
  assert.match(component, /rel="noopener noreferrer"/, 'external links need rel');
});

test('nutrient component: no HTML injection or static images', () => {
  assert.doesNotMatch(component, /innerHTML/, 'must not use innerHTML');
  assert.doesNotMatch(component, /readFileSync/, 'must not read files at runtime');
  assert.doesNotMatch(component, /set:html/, 'must not inject HTML');
  assert.doesNotMatch(component, /<img\b/i, 'must not embed a static image');
});

test('nutrient component: both panels start visible and dialogs come last', () => {
  const panelOpenings = [
    ...component.matchAll(/<section\s+class="nutrient-panel"[\s\S]*?>/g),
  ].map((match) => match[0]);
  assert.equal(panelOpenings.length, 1, 'one panel template is mapped');
  for (const opening of panelOpenings) {
    assert.doesNotMatch(
      opening,
      /\shidden(?:\s|>|=)/,
      'panels must not be rendered with an initial hidden attribute'
    );
  }

  const lastPanel = component.lastIndexOf('data-nutrient-panel=');
  const indexStart = component.indexOf('class="nutrient-index"');
  const firstDialog = component.indexOf('<dialog');
  assert.ok(lastPanel !== -1, 'panels must be present');
  assert.ok(indexStart > lastPanel, 'index must come after the panels');
  assert.ok(firstDialog > indexStart, 'dialogs must come after the index');
});

test('nutrient component: inline script implements the interaction contract', () => {
  assert.match(component, /<script is:inline>/, 'component needs an inline script');
  assert.match(
    component,
    /const root = document\.querySelector\('\[data-nutrient-explorer\]'\);/,
    'script must query the root'
  );
  assert.match(component, /if \(!root\) return;/, 'script must guard a missing root');
  assert.match(
    component,
    /root\.dataset\.enhanced = ''/,
    'script must mark the enhanced state'
  );
  assert.match(
    component,
    /panel\.toggleAttribute\('hidden', !active\)/,
    'script must hide inactive panels with toggleAttribute'
  );
  assert.match(
    component,
    /window\.addEventListener\('hashchange'/,
    'script must listen for hash changes'
  );
  assert.match(component, /ArrowLeft/, 'keyboard support must include ArrowLeft');
  assert.match(component, /ArrowRight/, 'keyboard support must include ArrowRight');
  assert.match(component, /Home/, 'keyboard support must include Home');
  assert.match(component, /End/, 'keyboard support must include End');
  assert.match(
    component,
    /element\.classList\.toggle\('is-active'/,
    'hover/focus linking must toggle is-active'
  );
  assert.match(
    component,
    /CSS\.escape\(id\)/,
    'attribute selector must escape the term id'
  );
  assert.match(component, /\.open = true/, 'closing must reopen the index');
  assert.match(
    component,
    /preventScroll: true/,
    'focus restoration must prevent scrolling'
  );
  assert.doesNotMatch(component, /\.innerHTML\s*=/, 'script must not set innerHTML');
});

test('nutrient component: tab changes replace the hash without new history entries', () => {
  assert.match(
    component,
    /history\.replaceState\(null,\s*'',\s*'#'\s*\+\s*activeId\)/,
    'tab changes must update the hash with history.replaceState'
  );
  assert.doesNotMatch(component, /pushState/, 'tab changes must not add history entries');
});

test('nutrient component: English labels declare lang="en"', () => {
  const englishLabels = [
    ...component.matchAll(/<bdi\s+class="nutrient-(?:node|tab)-en"[^>]*>/g),
  ].map((match) => match[0]);

  assert.ok(englishLabels.length > 0, 'component must render English labels');
  for (const opening of englishLabels) {
    assert.match(
      opening,
      /lang="en"/,
      `English label must declare lang="en": ${opening}`
    );
  }

  assert.match(
    component,
    /class="nutrient-dialog-en" lang="en"/,
    'dialog English term must declare lang="en"'
  );
});

test('nutrient component: known language entries render language codes', () => {
  assert.match(component, /الفرنسية:\s*'fr'/, 'French must map to fr');
  assert.match(component, /الألمانية:\s*'de'/, 'German must map to de');
  assert.match(component, /الإسبانية:\s*'es'/, 'Spanish must map to es');
  assert.match(
    component,
    /lang=\{languageCode\(item\.language\)\}/,
    'language entries must render lang from the language-code map'
  );
});

test('nutrient component: dialog figure precedes translations in DOM order', () => {
  const figure = component.indexOf('class="nutrient-dialog-figure"');
  const translations = component.indexOf('class="nutrient-dialog-translations"');
  const languages = component.indexOf('class="nutrient-dialog-languages"');

  assert.ok(figure !== -1, 'dialog must render the figure');
  assert.ok(translations !== -1, 'dialog must render translations');
  assert.ok(languages !== -1, 'dialog must render languages');
  assert.ok(
    figure < translations,
    'the dialog figure (with h2) must come before translations in the DOM'
  );
  assert.ok(
    figure < languages,
    'the dialog figure (with h2) must come before languages in the DOM'
  );
});

test('nutrient component: dialog content wrapper and opener tracking', () => {
  assert.match(
    component,
    /class="nutrient-dialog-content"/,
    'dialog content needs an inner wrapper so padding clicks do not close it'
  );
  assert.match(
    component,
    /openedFromIndex = Boolean\(opener\.closest\('\.nutrient-index'\)\)/,
    'the dialog must track whether it was opened from the index'
  );
  assert.match(
    component,
    /openedFromIndex && indexDetails/,
    'the index must only reopen for dialogs opened from the index'
  );
});

function extractMediaBlocks(source, query) {
  const blocks = [];
  const starts = [`@media (${query}) {`, `@media ${query} {`];
  let index = 0;

  while (true) {
    let startIndex = -1;
    let marker = '';

    for (const candidate of starts) {
      const found = source.indexOf(candidate, index);
      if (found !== -1 && (startIndex === -1 || found < startIndex)) {
        startIndex = found;
        marker = candidate;
      }
    }

    if (startIndex === -1) break;

    const open = startIndex + marker.length - 1;
    let depth = 0;
    let end = open;

    for (let cursor = open; cursor < source.length; cursor++) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') {
        depth--;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }

    blocks.push(source.slice(open + 1, end));
    index = end + 1;
  }

  return blocks;
}

test('nutrient CSS: scoped selectors, app tokens and no rounded cards', () => {
  const selectors = topLevelSelectors(css);
  assert.ok(selectors.length > 0, 'CSS must have top-level rules');

  for (const selector of selectors) {
    assert.ok(
      selector.startsWith('.nutrient-'),
      `top-level selector must start with .nutrient-: ${selector}`
    );
  }

  assert.match(css, /var\(--color-ink\)/, 'CSS must use the ink token');
  assert.match(css, /var\(--color-accent\)/, 'CSS must use the accent token');
  assert.match(css, /var\(--color-secondary\)/, 'CSS must use the secondary token');
  assert.match(css, /var\(--bg-color\)/, 'CSS must use the paper token');
  assert.match(css, /color-mix\(/, 'CSS must use color-mix tints');
  assert.doesNotMatch(css, /:root\b/, 'CSS must not add global :root tokens');
  assert.doesNotMatch(
    css,
    /border-radius\s*:/,
    'cards must stay square (no border-radius)'
  );
  assert.match(
    css,
    /\.nutrient-groups--macro\s*\{[^}]*grid-template-columns:\s*repeat\(3/,
    'macro groups must use three columns'
  );
  assert.match(
    css,
    /\.nutrient-groups--micro\s*\{[^}]*grid-template-columns:\s*repeat\(2/,
    'micro groups must use two columns'
  );
});

test('nutrient CSS: the explorer renders as one card', () => {
  assert.match(
    css,
    /\.nutrient-explorer\s*\{[^}]*border:\s*2px solid var\(--color-ink\)/,
    'the explorer must have a card border'
  );
  assert.match(
    css,
    /\.nutrient-explorer\s*\{[^}]*padding:\s*var\(--space-l\)/,
    'the explorer must have card padding'
  );
  assert.match(
    css,
    /\.nutrient-explorer\s*\{[^}]*background:\s*var\(--bg-color\)/,
    'the explorer must have a card background'
  );
});

test('nutrient CSS: dialog grid placement preserves the visual layout', () => {
  assert.match(
    css,
    /\.nutrient-dialog-figure\s*\{[^}]*grid-column:\s*2/,
    'the dialog figure must stay in the centre column'
  );
  assert.match(
    css,
    /\.nutrient-dialog-translations\s*\{[^}]*grid-column:\s*3/,
    'translations must stay visually left in the RTL grid'
  );
  assert.match(
    css,
    /\.nutrient-dialog-languages\s*\{[^}]*grid-column:\s*1/,
    'languages must stay visually right in the RTL grid'
  );
});

test('nutrient CSS: responsive, motion, print and forced-colors rules', () => {
  assert.match(css, /@media \(max-width: 50rem\)/, 'CSS needs a 50rem breakpoint');
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)/,
    'CSS needs reduced-motion rules'
  );
  assert.match(css, /@media \(forced-colors: active\)/, 'CSS needs forced-colors rules');
  assert.match(css, /@media print/, 'CSS needs print rules');

  const printBlocks = extractMediaBlocks(css, 'print');
  assert.equal(printBlocks.length, 1, 'there must be exactly one print block');
  const printBlock = printBlocks[0];

  assert.match(
    printBlock,
    /\.nutrient-panel\[hidden\]\s*\{\s*display:\s*block\s*!important;?\s*\}/,
    'print must reveal hidden panels with display: block !important'
  );
  assert.doesNotMatch(
    printBlock,
    /\b(?:revert|unset)\b/,
    'print must not use revert/unset for the hidden override'
  );
  assert.match(printBlock, /\.nutrient-tabs/, 'print must hide the tabs');
  assert.match(printBlock, /\.nutrient-index/, 'print must hide the index');
  assert.match(printBlock, /\.nutrient-hint/, 'print must hide the hint');
  assert.match(printBlock, /\.nutrient-dialog/, 'print must hide the dialogs');
  assert.match(printBlock, /break-inside:\s*avoid/, 'print must avoid breaks inside cards');
});

test('nutrient page: layout, downloads and no embedded posters', () => {
  assert.match(
    page,
    /import\s+BaseLayout\s+from\s+['"]\.\.\/\.\.\/layouts\/BaseLayout\.astro['"]/,
    'page must import BaseLayout'
  );
  assert.match(
    page,
    /import\s+NutrientExplorer\s+from\s+['"]\.\.\/\.\.\/components\/NutrientExplorer\.astro['"]/,
    'page must import NutrientExplorer'
  );
  assert.match(page, /<NutrientExplorer\s*\/>/, 'page must render the explorer');
  assert.match(page, /<a href=\{`\$\{base\}معاجم`\}>العودة إلى المعاجم<\/a>/, 'page must link back');
  assert.match(page, /<h1>التغذية<\/h1>/, 'page must have the right h1');
  assert.match(page, /<h2>خريطة المغذيات<\/h2>/, 'page must have the map heading');
  assert.doesNotMatch(page, /<img\b/i, 'page must not contain an <img>');
  assert.doesNotMatch(
    page,
    /macronuentries\.svg/,
    'page must not reference the old misspelled file'
  );

  const assets = [...page.matchAll(/nutrients\/[^"'\s`]+/g)].map((m) => m[0]);
  assert.ok(
    assets.includes('nutrients/macronutrients.svg'),
    'page must link the macronutrients SVG'
  );
  assert.ok(
    assets.includes('nutrients/micronutrients.svg'),
    'page must link the micronutrients SVG'
  );

  for (const asset of assets) {
    const file = fileURLToPath(new URL(`../public/${asset}`, import.meta.url));
    assert.ok(existsSync(file), `referenced asset must exist under public/: ${asset}`);
  }
});

test('nutrient provenance: NOTICE hashes match the supplied SVGs', () => {
  const macroPath = fileURLToPath(
    new URL('../public/nutrients/macronutrients.svg', import.meta.url)
  );
  const microPath = fileURLToPath(
    new URL('../public/nutrients/micronutrients.svg', import.meta.url)
  );

  assert.ok(existsSync(macroPath), 'macronutrients.svg must exist');
  assert.ok(existsSync(microPath), 'micronutrients.svg must exist');
  assert.ok(
    !existsSync(
      fileURLToPath(
        new URL('../public/nutrients/macronuentries.svg', import.meta.url)
      )
    ),
    'the old misspelled macronuentries.svg must not remain'
  );

  for (const file of [macroPath, microPath]) {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.ok(notice.includes(hash), `NOTICE must document ${file.split('/').pop()} SHA-256`);
  }

  assert.match(notice, /صاحب المشروع/, 'NOTICE must state the project owner supplied the posters');
  assert.match(notice, /لا تضمّن/, 'NOTICE must state the page does not embed the posters');
  assert.match(notice, /macronuentries\.svg/, 'NOTICE must mention the old misspelled name');
});

test('glossary hub: nutrition card is registered after anatomy', () => {
  const available = hubCategories.filter((category) => category.href);
  assert.deepEqual(
    available.map((category) => category.title),
    ['الكيمياء', 'التشريح', 'التغذية']
  );

  for (const category of available) {
    assert.equal(
      typeof category.description,
      'string',
      `category "${category.title}" description must be a string`
    );
    assert.ok(
      category.description.trim().length > 0,
      `category "${category.title}" description must be non-empty`
    );
  }

  const nutrition = hubCategories.find(
    (category) => category.title === 'التغذية'
  );
  assert.ok(nutrition, 'nutrition category must exist');
  assert.equal(nutrition.href, '/معاجم/التغذية');
  assert.ok(nutrition.kicker && nutrition.kicker.trim().length > 0);
  assert.ok(nutrition.cta && nutrition.cta.trim().length > 0);
  assert.ok(nutrition.ariaLabel && nutrition.ariaLabel.trim().length > 0);
});
