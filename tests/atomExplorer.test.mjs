import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  collectTermIds,
  validateTermDiagrams,
  walkDiagramTerms,
} from '../src/utils/termDiagrams.mjs';
import { validateAtoms } from '../src/utils/atoms.mjs';
import { validateNutrients } from '../src/utils/nutrients.mjs';

const data = JSON.parse(
  readFileSync(new URL('../src/data/atoms.json', import.meta.url), 'utf8')
);
const nutrientData = JSON.parse(
  readFileSync(new URL('../src/data/nutrients.json', import.meta.url), 'utf8')
);
const component = readFileSync(
  new URL('../src/components/AtomExplorer.astro', import.meta.url),
  'utf8'
).normalize('NFC');
const css = readFileSync(
  new URL('../src/components/nutrient-explorer.css', import.meta.url),
  'utf8'
).normalize('NFC');
const page = readFileSync(
  new URL('../src/pages/معاجم/الكيمياء.astro', import.meta.url),
  'utf8'
).normalize('NFC');
const hubCategories = JSON.parse(
  readFileSync(
    new URL('../src/data/glossary-categories.json', import.meta.url),
    'utf8'
  )
);
const notice = readFileSync(
  new URL('../src/data/atoms/NOTICE.md', import.meta.url),
  'utf8'
).normalize('NFC');
const builtAtomPath = fileURLToPath(
  new URL('../dist/معاجم/الكيمياء/index.html', import.meta.url)
);

const PINNED_TERMS = [
  ['atom-terminology', 'مصطلحات الذرّة', 'Atom terminology'],
  ['atomic-structure', 'البنية الذرّية', 'Atomic structure'],
  ['electron', 'الإلكترون', 'Electron'],
  ['nucleus', 'النواة', 'Nucleus'],
  ['atomic-number', 'العدد الذري', 'Atomic number (Z)'],
  ['mass-number', 'العدد الكتلي', 'Mass number (A)'],
  ['isotopes', 'النظائر', 'Isotopes'],
  ['nucleons', 'النويات', 'Nucleons'],
  ['proton', 'البروتون', 'Proton'],
  ['neutron', 'النيوترون', 'Neutron'],
  ['quarks', 'الكواركات', 'Quarks'],
  ['up-quark', 'الكوارك العلوي', 'Up quark'],
  ['down-quark', 'الكوارك السفلي', 'Down quark'],
  ['charm-quark', 'الكوارك الساحر', 'Charm quark'],
  ['strange-quark', 'الكوارك الغريب', 'Strange quark'],
  ['top-quark', 'الكوارك القمي', 'Top quark'],
  ['bottom-quark', 'الكوارك القاعي', 'Bottom quark'],
  ['gluon', 'الغلوون', 'Gluon'],
  ['colour-charge', 'الشحنة اللونية', 'Colour charge'],
  ['leptons', 'اللبتونات', 'Leptons'],
  ['muon', 'الميون', 'Muon'],
  ['tau', 'التاو', 'Tau'],
  ['neutrinos', 'النيوترينوات', 'Neutrinos'],
  ['electron-neutrino', 'نيوترينو الإلكترون', 'Electron neutrino'],
  ['muon-neutrino', 'نيوترينو الميون', 'Muon neutrino'],
  ['tau-neutrino', 'نيوترينو التاو', 'Tau neutrino'],
  ['bosons', 'البوزونات', 'Bosons'],
  ['photon', 'الفوتون', 'Photon'],
  ['w-boson', 'البوزون W', 'W boson'],
  ['z-boson', 'البوزون Z', 'Z boson'],
  ['higgs-boson', 'بوزون هيغز', 'Higgs boson'],
  ['hadrons', 'الهادرونات', 'Hadrons'],
  ['baryons', 'الباريونات', 'Baryons'],
  ['mesons', 'الميزونات', 'Mesons'],
  ['fundamental-interactions', 'القوى الأساسية', 'Fundamental interactions'],
  ['strong-interaction', 'القوة الشديدة', 'Strong interaction'],
  ['electromagnetic-interaction', 'القوة الكهرومغناطيسية', 'Electromagnetic interaction'],
  ['weak-interaction', 'القوة الضعيفة', 'Weak interaction'],
  ['gravity', 'الجاذبية', 'Gravity'],
];

const EXPECTED_IDS = PINNED_TERMS.map(([id]) => id);
const REQUIRED_CODE = 'de';
const FORBIDDEN_CODES = new Set(['fr', 'es', 'it', 'pt']);
const NONTYPICAL_CODES = new Set(['is', 'fi', 'hu', 'tr', 'zh', 'ja', 'ko']);
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const INVISIBLE_BIDI = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/;

function primary(code) {
  return String(code).trim().toLowerCase().split('-')[0];
}

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

test('atom data: validator accepts the shipped data', () => {
  const result = validateAtoms(data);
  assert.deepEqual(result.errors, []);
});

test('nutrient regression: shared validator keeps the shipped nutrient data green', () => {
  assert.doesNotThrow(() => validateNutrients(nutrientData));
  assert.deepEqual(validateNutrients(nutrientData).errors, []);
  assert.deepEqual(
    validateTermDiagrams(nutrientData, {
      requiredLanguages: ['الفرنسية', 'الألمانية', 'الإسبانية'],
      requireLanguageCode: false,
    }).errors,
    []
  );
});

test('shared validator: code-based rules are skipped when requireLanguageCode is false', () => {
  const broken = cloneData();
  for (const term of Object.values(broken.terms)) {
    for (const item of term.languages) {
      delete item.code;
      delete item.source;
    }
  }

  const result = validateTermDiagrams(broken, {
    requiredLanguages: [],
    requireLanguageCode: false,
  });
  assert.deepEqual(result.errors, []);
});

test('atom data: exactly the 39 pinned term ids in order', () => {
  assert.equal(Object.keys(data.terms).length, 39);
  assert.deepEqual(Object.keys(data.terms), EXPECTED_IDS);
  assert.deepEqual(collectTermIds(data), EXPECTED_IDS);
});

test('atom data: exactly one diagram because the component reads diagrams[0]', () => {
  assert.equal(data.diagrams.length, 1);
  assert.match(component, /atoms\.diagrams\[0\]/);
});

test('atom data: the shipped diagram has exactly 8 groups', () => {
  assert.equal(data.diagrams[0].groups.length, 8);
});

test('atom data: every pinned Arabic and English label is exact', () => {
  for (const [id, ar, en] of PINNED_TERMS) {
    assert.equal(data.terms[id].ar, ar, `terms.${id}.ar`);
    assert.equal(data.terms[id].en, en, `terms.${id}.en`);
  }
});

test('atom data: every term is referenced and every reference exists', () => {
  const referenced = data.diagrams.flatMap(walkDiagramTerms);
  const referencedSet = new Set(referenced);
  const defined = new Set(collectTermIds(data));

  assert.deepEqual([...referencedSet].sort(), [...defined].sort());
  assert.equal(referencedSet.size, 39);

  for (const id of referenced) {
    assert.ok(defined.has(id), `referenced term "${id}" must be defined`);
  }
  for (const id of EXPECTED_IDS) {
    assert.ok(referencedSet.has(id), `approved term "${id}" must be referenced`);
  }
});

test('atom data: required fields, references, translations and suggestions', () => {
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

    assert.notEqual(
      term.description,
      term.origin,
      `terms.${id}.description must not repeat the origin`
    );
    assert.notEqual(
      term.description,
      term.arabicMeaning,
      `terms.${id}.description must not repeat the Arabic meaning`
    );

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
      assert.ok(
        Array.isArray(term[key]) && term[key].length > 0,
        `terms.${id}.${key} must be a non-empty array`
      );
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

    for (const suggestion of term.suggestions) {
      assert.equal(
        suggestion.source,
        'اقتراح تحريري (معراب)',
        `terms.${id} suggestion source must be editorial`
      );
    }
  }
});

test('atom data: every suggestion differs from the main Arabic term', () => {
  for (const [id, term] of Object.entries(data.terms)) {
    for (const [index, suggestion] of term.suggestions.entries()) {
      assert.notEqual(
        suggestion.term.normalize('NFC').trim(),
        term.ar.normalize('NFC').trim(),
        `terms.${id}.suggestions[${index}] must differ from ar`
      );
    }
  }
});

test('atom data: languages use German plus at least three non-typical codes', () => {
  for (const [id, term] of Object.entries(data.terms)) {
    assert.ok(
      Array.isArray(term.languages) && term.languages.length >= 4,
      `terms.${id}.languages must have at least four entries`
    );

    const unique = new Set();
    for (const item of term.languages) {
      assert.ok(
        typeof item.language === 'string' && item.language.trim().length > 0,
        `terms.${id} language entry needs a language`
      );
      assert.ok(
        typeof item.code === 'string' && item.code.trim().length > 0,
        `terms.${id} language entry needs a code`
      );
      assert.match(
        item.code,
        LANGUAGE_CODE_PATTERN,
        `terms.${id} language code must be BCP-47 shaped`
      );
      assert.ok(
        typeof item.term === 'string' && item.term.trim().length > 0,
        `terms.${id} language entry needs a term`
      );
      assert.ok(
        typeof item.source === 'string' && item.source.trim().length > 0,
        `terms.${id} language entry needs a source`
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
      unique.add(primary(item.code));
    }

    assert.ok(unique.size >= 4, `terms.${id} needs four distinct primary codes`);
    assert.ok(unique.has(REQUIRED_CODE), `terms.${id} must include de`);

    const nontypical = [...unique].filter((code) => NONTYPICAL_CODES.has(code));
    assert.ok(
      nontypical.length >= 3,
      `terms.${id} needs at least three non-typical languages`
    );

    for (const code of unique) {
      assert.ok(
        !FORBIDDEN_CODES.has(code),
        `terms.${id} must not include forbidden code ${code}`
      );
    }
  }
});

test('atom validator: missing German is reported', () => {
  const broken = cloneData();
  broken.terms.electron.languages = broken.terms.electron.languages.filter(
    (item) => primary(item.code) !== 'de'
  );

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('terms.electron.languages must include language code "de"')
    )
  );
});

test('atom validator: forbidden fr-FR and FR are both reported', () => {
  for (const code of ['fr-FR', 'FR']) {
    const broken = cloneData();
    broken.terms.electron.languages.push({
      language: 'الفرنسية',
      code,
      term: 'électron',
      source: 'Wiktionary',
    });

    const { errors } = validateAtoms(broken);
    assert.ok(
      errors.some((error) =>
        error.includes('must not include forbidden language code "fr"')
      ),
      `forbidden code ${code} must be reported`
    );
  }
});

test('atom validator: forbidden es, it and pt codes are reported', () => {
  for (const code of ['es', 'it', 'pt']) {
    const broken = cloneData();
    broken.terms.electron.languages.push({
      language: 'اختبار',
      code,
      term: 'اختبار',
      source: 'Wiktionary',
    });

    const { errors } = validateAtoms(broken);
    assert.ok(
      errors.some((error) =>
        error.includes(`must not include forbidden language code "${code}"`)
      ),
      `forbidden code ${code} must be reported`
    );
  }
});

test('atom validator: fewer than four languages is reported', () => {
  const broken = cloneData();
  broken.terms.electron.languages = broken.terms.electron.languages.slice(0, 3);

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('terms.electron.languages must include at least 4 languages')
    )
  );
});

test('atom validator: fewer than three non-typical languages is reported', () => {
  const broken = cloneData();
  broken.terms.electron.languages = broken.terms.electron.languages.filter(
    (item) => ['de', 'is', 'fi'].includes(primary(item.code))
  );

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'terms.electron.languages must include at least 3 non-typical languages'
      )
    )
  );
});

test('atom validator: duplicate primary subtags count once', () => {
  const broken = cloneData();
  broken.terms.electron.languages = [
    { language: 'الألمانية', code: 'de', term: 'Elektron', source: 'Wiktionary' },
    { language: 'الآيسلندية', code: 'is', term: 'rafeind', source: 'Wiktionary' },
    { language: 'الآيسلندية', code: 'is-IS', term: 'rafeind', source: 'Wiktionary' },
    { language: 'الفنلندية', code: 'fi', term: 'elektroni', source: 'Wiktionary' },
  ];

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'terms.electron.languages must include at least 3 non-typical languages'
      )
    ),
    'is and is-IS must count as a single non-typical language'
  );
});

test('atom validator: de plus de-AT satisfies German and counts once', () => {
  const broken = cloneData();
  broken.terms.electron.languages = [
    { language: 'الألمانية', code: 'de', term: 'Elektron', source: 'Wiktionary' },
    { language: 'الألمانية', code: 'de-AT', term: 'Elektron', source: 'Wiktionary' },
    { language: 'الآيسلندية', code: 'is', term: 'rafeind', source: 'Wiktionary' },
    { language: 'الفنلندية', code: 'fi', term: 'elektroni', source: 'Wiktionary' },
    { language: 'المجرية', code: 'hu', term: 'elektron', source: 'Wiktionary' },
  ];

  const { errors } = validateAtoms(broken);
  assert.deepEqual(errors, []);
});

test('atom validator: zh-Hans counts as a non-typical language', () => {
  const broken = cloneData();
  broken.terms.electron.languages = [
    { language: 'الألمانية', code: 'de', term: 'Elektron', source: 'Wiktionary' },
    { language: 'الصينية', code: 'zh-Hans', term: '电子', source: 'Wiktionary' },
    { language: 'الفنلندية', code: 'fi', term: 'elektroni', source: 'Wiktionary' },
    { language: 'المجرية', code: 'hu', term: 'elektron', source: 'Wiktionary' },
  ];

  const { errors } = validateAtoms(broken);
  assert.deepEqual(errors, []);
});

test('atom validator: malformed language codes are reported', () => {
  for (const code of ['english', 'd', 'de_DE']) {
    const broken = cloneData();
    broken.terms.electron.languages.push({
      language: 'اختبار',
      code,
      term: 'اختبار',
      source: 'اختبار',
    });

    const { errors } = validateAtoms(broken);
    assert.ok(
      errors.some((error) =>
        error.includes('must be a valid BCP-47 language code')
      ),
      `malformed code ${code} must be reported`
    );
  }
});

test('atom validator: missing language code is reported', () => {
  const broken = cloneData();
  broken.terms.electron.languages.push({
    language: 'اختبار',
    term: 'اختبار',
    source: 'اختبار',
  });

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) => error.includes('.code must be a non-empty string'))
  );
});

test('atom validator: missing language source is reported', () => {
  const broken = cloneData();
  broken.terms.electron.languages.push({
    language: 'الهولندية',
    code: 'nl',
    term: 'elektron',
  });

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) => error.includes('.source must be a non-empty string'))
  );
});

test('atom validator: dangling branch and column terms are reported', () => {
  const broken = cloneData();
  const branch = broken.diagrams[0].groups[0].branches[0];
  const column = branch.columns[0];

  branch.terms = [...(branch.terms ?? []), 'missing-branch-term'];
  column.terms = [...(column.terms ?? []), 'missing-column-term'];

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) => error.includes('missing-branch-term')),
    'validator must report a dangling branch term'
  );
  assert.ok(
    errors.some((error) => error.includes('missing-column-term')),
    'validator must report a dangling column term'
  );
});

test('atom validator: diagrams[0].groups must be a non-empty array', () => {
  const cases = [
    ['missing', undefined],
    ['non-array', {}],
    ['empty', []],
  ];

  for (const [label, groups] of cases) {
    const broken = cloneData();
    if (groups === undefined) {
      delete broken.diagrams[0].groups;
    } else {
      broken.diagrams[0].groups = groups;
    }

    const { errors } = validateAtoms(broken);
    assert.ok(
      errors.some((error) =>
        error.includes('diagrams[0].groups must be a non-empty array')
      ),
      `${label} groups must be reported`
    );
  }
});

test('atom validator: branch and column terms must be non-empty strings', () => {
  const broken = cloneData();
  const branch = broken.diagrams[0].groups[0].branches[0];
  const column = branch.columns[0];

  branch.terms = ['', 42];
  column.terms = ['', null];

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('branches[0].terms[0] must be a non-empty string')
    ),
    'empty branch term must be reported'
  );
  assert.ok(
    errors.some((error) =>
      error.includes('branches[0].terms[1] must be a non-empty string')
    ),
    'non-string branch term must be reported'
  );
  assert.ok(
    errors.some((error) =>
      error.includes('columns[0].terms[0] must be a non-empty string')
    ),
    'empty column term must be reported'
  );
  assert.ok(
    errors.some((error) =>
      error.includes('columns[0].terms[1] must be a non-empty string')
    ),
    'non-string column term must be reported'
  );
});

test('atom validator: branch and column items must be non-empty strings', () => {
  const broken = cloneData();
  const branch = broken.diagrams[0].groups[0].branches[0];
  const column = branch.columns[0];

  branch.items = ['', 42];
  column.items = ['', null];

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some((error) =>
      error.includes('branches[0].items[0] must be a non-empty string')
    ),
    'empty branch item must be reported'
  );
  assert.ok(
    errors.some((error) =>
      error.includes('branches[0].items[1] must be a non-empty string')
    ),
    'non-string branch item must be reported'
  );
  assert.ok(
    errors.some((error) =>
      error.includes('columns[0].items[0] must be a non-empty string')
    ),
    'empty column item must be reported'
  );
  assert.ok(
    errors.some((error) =>
      error.includes('columns[0].items[1] must be a non-empty string')
    ),
    'non-string column item must be reported'
  );
});

test('atom validator: orphan terms are reported', () => {
  const broken = cloneData();
  broken.terms['orphan-term'] = structuredClone(broken.terms.electron);

  const { errors } = validateAtoms(broken);
  assert.ok(
    errors.some(
      (error) =>
        error.includes('orphan-term') && error.includes('never referenced')
    )
  );
});

test('atom validator: NFC and bidi violations are reported', () => {
  const nfcBroken = cloneData();
  nfcBroken.terms.electron.en = 'E\u0301lectron';
  assert.ok(
    validateAtoms(nfcBroken).errors.some((error) =>
      error.includes('must be NFC-normalized')
    )
  );

  const bidiBroken = cloneData();
  bidiBroken.terms.electron.description += '\u200f';
  assert.ok(
    validateAtoms(bidiBroken).errors.some((error) =>
      error.includes('must not contain invisible bidi/control characters')
    )
  );
});

test('atom validator: structural errors keep their expected messages', () => {
  const missingColumn = cloneData();
  delete missingColumn.diagrams[0].groups[0].branches[0].columns[0].term;

  const columnErrors = validateAtoms(missingColumn).errors;
  assert.ok(
    columnErrors.some((error) =>
      error.includes('columns[0].term must be a non-empty string')
    )
  );

  const missingRoot = cloneData();
  delete missingRoot.diagrams[0].root.term;

  const rootErrors = validateAtoms(missingRoot).errors;
  assert.ok(
    rootErrors.some((error) =>
      error.includes('diagrams[0].root.term must be a non-empty string')
    )
  );

  const nonArrayColumns = cloneData();
  nonArrayColumns.diagrams[0].groups[0].branches[0].columns = {};

  const columnArrayErrors = validateAtoms(nonArrayColumns).errors;
  assert.ok(
    columnArrayErrors.some((error) =>
      error.includes('.columns must be an array')
    )
  );

  const badAccent = cloneData();
  badAccent.diagrams[0].groups[0].accent = 'rainbow';

  const accentErrors = validateAtoms(badAccent).errors;
  assert.ok(
    accentErrors.some((error) =>
      error.includes('.accent must be one of accent/secondary/ink')
    )
  );

  const unsafeHref = cloneData();
  unsafeHref.terms.electron.references[0].href = 'javascript:alert(1)';

  const hrefErrors = validateAtoms(unsafeHref).errors;
  assert.ok(
    hrefErrors.some((error) =>
      error.includes(
        '.references[0].href must be an http(s) or site-relative URL'
      )
    )
  );
});

test('atom component: data, style and validator wiring', () => {
  assert.match(
    component,
    /import\s+['"]\.\/nutrient-explorer\.css['"]/,
    'component must import the shared stylesheet'
  );
  assert.match(
    component,
    /import\s+atoms\s+from\s+['"]\.\.\/data\/atoms\.json['"]/,
    'component must import ../data/atoms.json'
  );
  assert.match(
    component,
    /import\s+\{[^}]*validateAtoms[^}]*\}\s+from\s+['"]\.\.\/utils\/atoms\.mjs['"]/,
    'component must import the atom validator'
  );
  assert.match(component, /toArabicDigits/, 'component must use Arabic digits');
  assert.match(component, /\.map\(/, 'component must render from data with .map');
  assert.match(component, /throw new Error/, 'component must throw on invalid data');
});

test('atom component: single diagram, no tab widgets', () => {
  assert.match(component, /data-atom-explorer/, 'root hook must exist');
  assert.match(component, /nutrient-explorer/, 'root must reuse the shared card class');
  assert.match(component, /atom-explorer/, 'root must carry the atom class');
  assert.doesNotMatch(component, /role="tablist"/, 'atom section has no tablist');
  assert.doesNotMatch(component, /role="tabpanel"/, 'atom section has no tabpanel');
  assert.match(component, /data-atom=/, 'openers must carry data-atom');
  assert.match(component, /aria-haspopup="dialog"/, 'openers must declare a dialog');
});

test('atom component: renders 39 dialogs from the pinned terms', () => {
  assert.ok(
    component.includes('class="nutrient-dialog atom-dialog"'),
    'dialog class needle must be present in the template'
  );
  assert.match(
    component,
    /termIds\.map\(/,
    'dialogs must be server-rendered by mapping over term ids'
  );
  assert.equal(EXPECTED_IDS.length, 39);
});

test(
  'atom component: built page contains exactly 39 dialogs (requires built dist)',
  { skip: !existsSync(builtAtomPath) },
  () => {
    const built = readFileSync(builtAtomPath, 'utf8').normalize('NFC');
    const count = built.split('class="nutrient-dialog atom-dialog"').length - 1;
    assert.equal(count, 39, 'built page must contain exactly 39 atom dialogs');
  }
);

test('atom component: dialog accessibility, ordering and empty states', () => {
  assert.match(component, /id=\{`atom-term-\$\{id\}`\}/, 'dialogs need unique ids');
  assert.match(component, /id=\{`atom-dialog-title-\$\{id\}`\}/, 'dialogs need title ids');
  assert.match(component, /id=\{`atom-dialog-desc-\$\{id\}`\}/, 'dialogs need description ids');
  assert.match(component, /dir="rtl"/, 'dialogs must be RTL');
  assert.match(component, /lang="ar"/, 'dialogs must declare Arabic');
  assert.match(component, /مصطلح ذرّي/, 'dialogs need the atom kicker');
  assert.match(component, /data-atom-close/, 'dialogs need a close control');
  assert.match(component, /class="nutrient-dialog-inner"/, 'dialogs need an inner wrapper');
  assert.match(component, /class="nutrient-empty"/, 'empty states must be rendered');
  assert.match(component, /rel="noopener noreferrer"/, 'external links need rel');

  const figure = component.indexOf('class="nutrient-dialog-figure"');
  const translations = component.indexOf('class="nutrient-dialog-translations"');
  const languages = component.indexOf('class="nutrient-dialog-languages"');

  assert.ok(figure !== -1, 'dialog must render the figure');
  assert.ok(translations !== -1, 'dialog must render translations');
  assert.ok(languages !== -1, 'dialog must render languages');
  assert.ok(figure < translations, 'the figure and h2 must precede translations in DOM');
  assert.ok(figure < languages, 'the figure and h2 must precede languages in DOM');
});

test('atom component: index is a details group with plain buttons', () => {
  assert.match(component, /<details class="nutrient-index">/, 'index must be a details element');
  assert.match(
    component,
    /class="nutrient-index-grid"[\s\S]*?role="group"[\s\S]*?aria-label="فهرس المصطلحات"/,
    'index grid must carry role=group and its label'
  );
  assert.doesNotMatch(
    component,
    /<button[^>]*role="group"/,
    'buttons must not carry role=group'
  );
  assert.match(
    component,
    /data-atom=\{id\}[\s\S]*?aria-haspopup="dialog"/,
    'index buttons must be plain buttons with aria-haspopup'
  );
});

test('atom component: shown groups use the atom two-column container', () => {
  assert.match(
    component,
    /class="nutrient-groups nutrient-groups--atom"/,
    'groups must render in the atom container'
  );
});

test('atom component: no HTML injection or static images', () => {
  assert.doesNotMatch(component, /innerHTML/, 'must not use innerHTML');
  assert.doesNotMatch(component, /readFileSync/, 'must not read files at runtime');
  assert.doesNotMatch(component, /set:html/, 'must not inject HTML');
  assert.doesNotMatch(component, /<svg\b/i, 'must not embed an SVG');
  assert.doesNotMatch(component, /<img\b/i, 'must not embed a static image');
  assert.doesNotMatch(component, /ATOM TERMINOLOGY/, 'must not copy SVG English text');
});

test('atom component: inline script implements the interaction contract', () => {
  assert.match(component, /<script is:inline>/, 'component needs an inline script');
  assert.match(component, /\(\(\) => \{/, 'script must be an IIFE');
  assert.match(
    component,
    /const root = document\.querySelector\('\[data-atom-explorer\]'\);/,
    'script must query the root'
  );
  assert.match(component, /if \(!root\) return;/, 'script must guard a missing root');
  assert.match(component, /showModal\(\)/, 'script must open dialogs with showModal');
  assert.match(component, /CSS\.escape\(id\)/, 'attribute selector must escape the term id');
  assert.match(
    component,
    /element\.classList\.toggle\('is-active'/,
    'hover/focus linking must toggle is-active'
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
  assert.match(component, /\.open = true/, 'closing must reopen the index');
  assert.match(component, /preventScroll: true/, 'focus restoration must prevent scrolling');
  assert.doesNotMatch(component, /\.innerHTML\s*=/, 'script must not set innerHTML');
});

test('atom component: languages and digits use the shared helpers', () => {
  assert.match(
    component,
    /lang=\{item\.code\}/,
    'language entries must render the authored code in lang'
  );
  assert.match(
    component,
    /toArabicDigits\(String\(termCount\)\)/,
    'index count must use Arabic digits'
  );
});

test('atom CSS: two-column atom groups and shared 50rem stack', () => {
  assert.match(
    css,
    /\.nutrient-groups--atom\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'atom groups must use two columns'
  );

  const blocks = extractMediaBlocks(css, 'max-width: 50rem');
  assert.ok(
    blocks.some((block) => block.includes('.nutrient-groups--atom')),
    'atom groups must stack at the 50rem breakpoint'
  );
});

test('atom CSS: scoped selectors, app tokens and no rounded cards', () => {
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
  assert.doesNotMatch(css, /:root\b/, 'CSS must not add global :root tokens');
  assert.doesNotMatch(
    css,
    /border-radius\s*:/,
    'cards must stay square (no border-radius)'
  );
  assert.match(
    css,
    /\.nutrient-dialog-inner\s*\{|\.nutrient-dialog-content,\s*\n\.nutrient-dialog-inner\s*\{/,
    'the atom dialog inner wrapper must preserve padding'
  );
});

test('atom CSS: exactly one print block remains', () => {
  const printBlocks = extractMediaBlocks(css, 'print');
  assert.equal(printBlocks.length, 1, 'there must be exactly one print block');
  assert.match(printBlocks[0], /\.nutrient-dialog/, 'print must hide the dialogs');
  assert.match(printBlocks[0], /\.nutrient-index/, 'print must hide the index');
});

test('atom page: imports, section order and download', () => {
  assert.match(
    page,
    /import\s+AtomExplorer\s+from\s+['"]\.\.\/\.\.\/components\/AtomExplorer\.astro['"]/,
    'page must import AtomExplorer'
  );
  assert.match(page, /<AtomExplorer\s*\/>/, 'page must render the explorer');
  assert.match(page, /<PeriodicTable\s*\/>/, 'page must keep the periodic table');
  assert.match(page, /<h2>مصطلحات الذرّة<\/h2>/, 'page must have the atom heading');
  assert.match(
    page,
    /<a href=\{`\$\{base\}atoms\/atom\.svg`\} download>/,
    'page must offer the atom SVG as a download'
  );
  assert.doesNotMatch(page, /href="\/atom\.svg"/, 'page must not use the old root path');
  assert.doesNotMatch(page, /<img\b/i, 'page must not contain an <img>');

  const periodicTable = page.indexOf('<PeriodicTable />');
  const atomExplorer = page.indexOf('<AtomExplorer />');
  assert.ok(periodicTable !== -1, 'page must render the periodic table');
  assert.ok(atomExplorer !== -1, 'page must render the atom explorer');
  assert.ok(
    atomExplorer > periodicTable,
    'the atom section must come after the periodic table section'
  );

  const between = page.slice(periodicTable, atomExplorer);
  assert.match(
    between,
    /<\/section>\s*<section\b/,
    'the atom explorer must live in its own section after the periodic table'
  );
  assert.doesNotMatch(page, /<dialog/, 'atom dialogs must not be nested in the page source');
});

test('atom page: referenced assets exist under public', () => {
  const assets = [...page.matchAll(/atoms\/[^"'\s`]+/g)].map((m) => m[0]);
  assert.ok(assets.includes('atoms/atom.svg'), 'page must link the atom SVG');

  for (const asset of assets) {
    const file = fileURLToPath(new URL(`../public/${asset}`, import.meta.url));
    assert.ok(existsSync(file), `referenced asset must exist under public/: ${asset}`);
  }
});

test('atom provenance: NOTICE hash and move match the supplied SVG', () => {
  const atomPath = fileURLToPath(
    new URL('../public/atoms/atom.svg', import.meta.url)
  );
  const oldAtomPath = fileURLToPath(
    new URL('../public/atom.svg', import.meta.url)
  );

  assert.ok(existsSync(atomPath), 'public/atoms/atom.svg must exist');
  assert.ok(!existsSync(oldAtomPath), 'the old public/atom.svg must not remain');

  const hash = createHash('sha256').update(readFileSync(atomPath)).digest('hex');
  assert.ok(notice.includes(hash), 'NOTICE must document the atom SVG SHA-256');

  assert.match(notice, /صاحب المشروع/, 'NOTICE must state the project owner supplied the SVG');
  assert.match(notice, /ترخيص/, 'NOTICE must state no third-party license metadata was supplied');
  assert.match(notice, /لا تضمّن/, 'NOTICE must state the page does not embed the SVG');
  assert.match(notice, /تحميل/, 'NOTICE must mention the download reference');
  assert.match(notice, /نُقل الملف من جذر/, 'NOTICE must describe the move');
  assert.doesNotMatch(notice, /\/atom\.svg/, 'NOTICE must not write the old URL string');
});

test('glossary hub: chemistry mentions the atom glossary without a new card', () => {
  const available = hubCategories.filter((category) => category.href);
  assert.deepEqual(
    available.map((category) => category.title),
    ['الكيمياء', 'التشريح', 'التغذية']
  );

  const chemistry = hubCategories.find(
    (category) => category.title === 'الكيمياء'
  );
  assert.ok(chemistry, 'chemistry category must exist');
  assert.match(
    chemistry.description,
    /مصطلحات الذرّة/,
    'chemistry description must mention the atom glossary'
  );
  assert.doesNotMatch(
    chemistry.description,
    /الفرنسية/,
    'chemistry must not claim French for the atom glossary'
  );
});
