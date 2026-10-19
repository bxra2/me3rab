export const TERM_DEFAULTS = {
  translation: '',
  explanation: '',
  source: [],
  status: 'proposed',
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
