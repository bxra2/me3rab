export const TERM_DEFAULTS = {
  translation: '',
  explanation: '',
  source: [],
  status: 'proposed',
  termSource: 'unknown',
  termMotivation: 'ambiguity',
  termFormation: 'derivation',
  alternatives: [],
  derivations: [],
};

export function fillTermKeys(partial = {}) {
  const copy = (v, fallback) => (Array.isArray(v) ? v : fallback).map((x) => ({ ...x }));
  return {
    term: partial.term ?? '',
    translation: partial.translation ?? TERM_DEFAULTS.translation,
    explanation: partial.explanation ?? TERM_DEFAULTS.explanation,
    source: copy(partial.source, TERM_DEFAULTS.source),
    status: partial.status ?? TERM_DEFAULTS.status,
    termSource: partial.termSource ?? TERM_DEFAULTS.termSource,
    termMotivation: partial.termMotivation ?? TERM_DEFAULTS.termMotivation,
    termFormation: partial.termFormation ?? TERM_DEFAULTS.termFormation,
    alternatives: copy(partial.alternatives, TERM_DEFAULTS.alternatives),
    derivations: copy(partial.derivations, TERM_DEFAULTS.derivations),
  };
}

export function slugifyTerm(term) {
  return String(term)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
