import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGraph, validateRelations } from '../src/utils/relationGraph.mjs';
import { parseTermNames } from '../scripts/lib/terms.mjs';

const relations = JSON.parse(
  readFileSync(new URL('../src/data/relations.json', import.meta.url), 'utf8')
);

const termNames = parseTermNames(
  fileURLToPath(new URL('../src/content/terms/', import.meta.url))
);
const terms = termNames.map((term) => ({
  term,
  translation: '',
  explanation: '',
  status: '',
}));

const graph = buildGraph(terms, relations);

test('matched vs ghost: known terms matched, Mineral is no longer quoted', () => {
  const byName = new Map(graph.nodes.map((n) => [n.name, n]));

  assert.ok(byName.has('Language Model'), 'Language Model should be a node');
  assert.equal(byName.get('Language Model').matched, true);
  assert.equal(byName.get('Language Model').ghost, false);

  assert.ok(byName.has('System of lakes'), 'System of lakes should be a node');
  assert.equal(byName.get('System of lakes').matched, true);

  assert.ok(byName.has('Mineral'), 'Mineral should be a node');
  assert.equal(byName.get('Mineral').matched, true);
  assert.equal(byName.get('Mineral').ghost, false);
  assert.equal(byName.has("'Mineral'"), false);

  // Ghost count derived from data, not hardcoded.
  const expectedGhosts = new Set();
  for (const rel of relations) {
    for (const name of rel.terms) {
      if (!termNames.includes(name)) expectedGhosts.add(name);
    }
  }
  assert.equal(graph.ghosts.length, expectedGhosts.size);
  assert.deepEqual(new Set(graph.ghosts), expectedGhosts);
});

test('dedupe: the two {Process, Operation, Procedure} relations collapse into one structure with two refs', () => {
  // The two relations live at file lines 8 and 11, i.e. 0-based indices 6 and 9
  // (line 1 of the file is the opening "[").
  const structures = graph.structures.filter((s) =>
    s.refs.some((r) => r.relIdx === 6 || r.relIdx === 9)
  );
  assert.equal(structures.length, 1, 'exactly one structure covers indices 6 and 9');

  const structure = structures[0];
  assert.equal(structure.refs.length, 2);
  const refs = structure.refs.map((r) => r.relIdx).sort((a, b) => a - b);
  assert.deepEqual(refs, [6, 9]);

  const byIdx = new Map(structure.refs.map((r) => [r.relIdx, r]));
  assert.equal(byIdx.get(6).note, 'السيرورة وإتمام المهام');
  assert.equal(byIdx.get(9).note, 'متقاربات تحتاج ترجمات متمايزة');

  // The structure id uses the lowest relIdx.
  assert.equal(structure.id, 'hub:6');
});

test('pipeline: Token yields two distinct chain structures with ordered edges', () => {
  const chains = graph.structures.filter(
    (s) => s.kind === 'chain' && s.members.includes('Token')
  );
  assert.equal(chains.length, 2, 'Token appears in exactly two pipelines');

  for (const chain of chains) {
    const chainEdges = graph.edges.filter(
      (e) => e.structureId === chain.id
    );
    assert.equal(chainEdges.length, chain.members.length - 1);
    for (let i = 0; i < chainEdges.length; i++) {
      assert.equal(chainEdges[i].source, chain.members[i]);
      assert.equal(chainEdges[i].target, chain.members[i + 1]);
      assert.equal(chainEdges[i].directed, true);
    }
  }
});

test('mapping: every relation index 0..68 maps to exactly one structure', () => {
  for (let idx = 0; idx < relations.length; idx++) {
    const owners = graph.structures.filter((s) =>
      s.refs.some((r) => r.relIdx === idx)
    );
    assert.equal(owners.length, 1, `relation index ${idx} must map to exactly one structure`);
  }
});

test('validateRelations: error cases', () => {
  const { errors } = validateRelations(
    [
      { type: 'contrast', terms: ['A', 'B'] }, // missing note
      { type: 'contrast', terms: ['A', 'B'], note: 'x', ar: ['a'] }, // ar length mismatch
      { type: 'contrast', terms: ['A'], note: 'x' }, // terms length < 2
      { type: 'bogus', terms: ['A', 'B'], note: 'x' }, // unknown type
      { type: 'contrast', terms: ['A', 'A'], note: 'x' }, // duplicate name
    ],
    ['A', 'B']
  );

  assert.ok(errors.some((e) => e.includes('missing or non-string note')));
  assert.ok(errors.some((e) => e.includes('ar length')));
  assert.ok(errors.some((e) => e.includes('needs at least two terms')));
  assert.ok(errors.some((e) => e.includes('unknown type')));
  assert.ok(errors.some((e) => e.includes('duplicate term')));
});

test('validateRelations: warning cases', () => {
  const known = ['Cat', 'Bat', 'Rat', 'Mat', 'Hat', 'Sat', 'Pat'];
  const { warnings } = validateRelations(
    [
      { type: 'contrast', terms: ['Xat', 'Cat'], note: 'x' }, // unknown with many near-misses
      { type: 'contrast', terms: ['Cat', 'Bat'], note: 'y' }, // Cat in two relations
      { type: 'contrast', terms: ['Rat', 'Mat'], note: 'z', ar: ['a،b', 'c'] }, // arabic comma
    ],
    known
  );

  const unknown = warnings.find((w) => w.type === 'unknown');
  assert.ok(unknown, 'expected an unknown-name warning');
  assert.equal(unknown.names.length, 1);
  assert.equal(unknown.names[0].name, 'Xat');
  assert.ok(unknown.names[0].suggestions.length <= 3, 'suggestions capped at 3');

  const shared = warnings.find((w) => w.type === 'shared-term' && w.term === 'Cat');
  assert.ok(shared, 'expected a shared-term warning for Cat');
  assert.equal(shared.relations.length, 2);

  const comma = warnings.find((w) => w.type === 'arabic-comma');
  assert.ok(comma, 'expected an arabic-comma warning');
  assert.equal(comma.value, 'a،b');
});

test('fallback count: relations.json has 69 raw entries', () => {
  assert.equal(relations.length, 69);
});
