/**
 * @fileoverview Builds an interactive relations graph from term frontmatter
 * and a relations dataset, and validates that dataset.
 *
 * Plain ESM with JSDoc types only (no TypeScript syntax).
 */

/**
 * @typedef {Object} TermInput
 * @property {string} term
 * @property {string} [translation]
 * @property {string} [explanation]
 * @property {string} [status]
 */

/**
 * @typedef {Object} Relation
 * @property {'contrast'|'family'|'pipeline'} type
 * @property {string[]} terms
 * @property {string} note
 * @property {string[]} [ar]
 */

/**
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {string} name
 * @property {boolean} matched
 * @property {boolean} ghost
 * @property {TermInput} [term]
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} id
 * @property {string} source
 * @property {string} target
 * @property {'contrast'|'family'|'pipeline'} type
 * @property {string} structureId
 * @property {boolean} directed
 */

/**
 * @typedef {Object} StructureRef
 * @property {number} relIdx
 * @property {string} note
 * @property {string[]|null} ar
 * @property {string[]} terms
 */

/**
 * @typedef {Object} GraphStructure
 * @property {string} id
 * @property {'contrast'|'family'|'pipeline'} type
 * @property {'hub'|'chain'|'edge'} kind
 * @property {string[]} members
 * @property {StructureRef[]} refs
 * @property {string} note
 */

const VALID_TYPES = new Set(['contrast', 'family', 'pipeline']);

/**
 * A stable, order-insensitive key for contrast/family relations and an
 * order-sensitive key for pipelines.
 * @param {Relation} rel
 * @returns {string}
 */
function dedupKey(rel) {
  const members =
    rel.type === 'pipeline' ? rel.terms : [...rel.terms].sort();
  return `${rel.type}:${members.join('\u0000')}`;
}

/**
 * @param {Relation} rel
 * @returns {'hub'|'chain'|'edge'}
 */
function kindOf(rel) {
  if (rel.type === 'pipeline') return 'chain';
  if (rel.type === 'family') return 'hub';
  return rel.terms.length === 2 ? 'edge' : 'hub';
}

/**
 * @param {Relation} rel
 * @param {number} relIdx
 * @returns {string}
 */
function structureId(rel, relIdx) {
  if (rel.type === 'pipeline') return `chain:${relIdx}`;
  if (rel.type === 'family') return `hub:${relIdx}`;
  return rel.terms.length === 2 ? `edge:${relIdx}` : `hub:${relIdx}`;
}

/**
 * Builds a graph from term frontmatter and a relations dataset.
 *
 * @param {TermInput[]} terms
 * @param {Relation[]} relations
 * @returns {{nodes: GraphNode[], edges: GraphEdge[], structures: GraphStructure[], ghosts: string[]}}
 */
export function buildGraph(terms, relations) {
  const termByName = new Map();
  for (const t of terms) termByName.set(t.term, t);

  // One node per distinct member name across all relations.
  const nodeMap = new Map();
  const ghostSet = new Set();

  for (const rel of relations) {
    for (const name of rel.terms) {
      if (nodeMap.has(name)) continue;
      const matched = termByName.has(name);
      /** @type {GraphNode} */
      const node = {
        id: name,
        name,
        matched,
        ghost: !matched,
      };
      if (matched) {
        const t = termByName.get(name);
        node.term = {
          term: t.term,
          translation: t.translation ?? '',
          explanation: t.explanation ?? '',
          status: t.status ?? '',
        };
      }
      nodeMap.set(name, node);
      if (!matched) ghostSet.add(name);
    }
  }

  const nodes = [...nodeMap.values()];

  // Deduplicate relations into drawn structures.
  const structureMap = new Map();
  /** @type {GraphStructure[]} */
  const structures = [];

  relations.forEach((rel, relIdx) => {
    const key = dedupKey(rel);
    let structure = structureMap.get(key);
    if (!structure) {
      structure = {
        id: structureId(rel, relIdx),
        type: rel.type,
        kind: kindOf(rel),
        members: [...rel.terms],
        refs: [],
        note: rel.note,
      };
      structureMap.set(key, structure);
      structures.push(structure);
    }
    structure.refs.push({
      relIdx,
      note: rel.note,
      ar: Array.isArray(rel.ar) ? [...rel.ar] : null,
      terms: [...rel.terms],
    });
  });

  // Emit edges per structure.
  /** @type {GraphEdge[]} */
  const edges = [];
  for (const structure of structures) {
    if (structure.kind === 'hub') {
      for (const member of structure.members) {
        edges.push({
          id: `${structure.id}:${member}`,
          source: structure.id,
          target: member,
          type: structure.type,
          structureId: structure.id,
          directed: false,
        });
      }
    } else if (structure.kind === 'chain') {
      for (let i = 0; i < structure.members.length - 1; i++) {
        edges.push({
          id: `${structure.id}:${i}`,
          source: structure.members[i],
          target: structure.members[i + 1],
          type: structure.type,
          structureId: structure.id,
          directed: true,
        });
      }
    } else {
      edges.push({
        id: `${structure.id}:edge`,
        source: structure.members[0],
        target: structure.members[1],
        type: structure.type,
        structureId: structure.id,
        directed: false,
      });
    }
  }

  return {
    nodes,
    edges,
    structures,
    ghosts: [...ghostSet],
  };
}

/**
 * Strips quote characters and whitespace, then lowercases.
 * @param {string} s
 * @returns {string}
 */
export function normalizeName(s) {
  return s
    .replace(/['"`«»]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Levenshtein edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Returns known term names that are near-misses for `name`.
 * @param {string} name
 * @param {string[]} termNames
 * @returns {string[]}
 */
function nearMisses(name, termNames) {
  const norm = normalizeName(name);
  const lower = name.toLowerCase();
  const results = [];
  for (const t of termNames) {
    if (normalizeName(t) === norm) {
      results.push(t);
    } else if (editDistance(lower, t.toLowerCase()) <= 2) {
      results.push(t);
    }
  }
  return results;
}

/**
 * Validates a relations dataset against known term names.
 *
 * @param {Relation[]} relations
 * @param {string[]} termNames
 * @returns {{errors: string[], warnings: Object[]}}
 */
export function validateRelations(relations, termNames) {
  const errors = [];
  const warnings = [];
  const known = new Set(termNames);

  const termToRelations = new Map();

  relations.forEach((rel, i) => {
    const where = `relations.json[${i}]`;

    if (typeof rel.note !== 'string' || rel.note.trim() === '') {
      errors.push(`${where}: missing or non-string note`);
    }

    if (!Array.isArray(rel.terms) || rel.terms.length < 2) {
      errors.push(`${where}: needs at least two terms`);
    }

    if (!VALID_TYPES.has(rel.type)) {
      errors.push(`${where}: unknown type "${rel.type}"`);
    }

    if (rel.ar !== undefined && rel.ar !== null) {
      if (!Array.isArray(rel.ar) || rel.ar.length !== rel.terms.length) {
        errors.push(
          `${where}: ar length (${Array.isArray(rel.ar) ? rel.ar.length : 'n/a'}) does not match terms length (${rel.terms.length})`
        );
      }
    }

    if (Array.isArray(rel.terms)) {
      const seen = new Set();
      for (const t of rel.terms) {
        if (seen.has(t)) {
          errors.push(`${where}: duplicate term "${t}"`);
        }
        seen.add(t);
      }
    }

    if (Array.isArray(rel.terms)) {
      const unknown = rel.terms.filter((t) => !known.has(t));
      if (unknown.length) {
        warnings.push({
          type: 'unknown',
          relation: i,
          names: unknown.map((name) => ({
            name,
            suggestions: nearMisses(name, termNames).slice(0, 3),
          })),
        });
      }
      for (const t of rel.terms) {
        if (!termToRelations.has(t)) termToRelations.set(t, []);
        termToRelations.get(t).push(i);
      }
    }

    if (Array.isArray(rel.ar)) {
      for (const a of rel.ar) {
        if (typeof a === 'string' && a.includes('،')) {
          warnings.push({
            type: 'arabic-comma',
            relation: i,
            value: a,
          });
        }
      }
    }
  });

  for (const [term, rels] of termToRelations) {
    if (rels.length >= 2) {
      warnings.push({
        type: 'shared-term',
        term,
        relations: rels,
      });
    }
  }

  return { errors, warnings };
}
