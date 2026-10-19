import type { TermStatusKey } from '../data/statuses'

export interface Source {
  name: string;
  link: string;
}

export interface Alternative {
  translation: string;
  note: string;
}

export interface Derivation {
  form: string;
  gloss: string;
}

export interface TermView {
  term: string;
  translation: string;
  explanation: string;
  source: Source[];
  status: TermStatusKey;
  alternatives: Alternative[];
  derivations: Derivation[];
}