import type { TermStatusKey, TermSourceKey, TermMotivationKey, TermFormationKey } from '../data/termStatuses'

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

export interface TermLanguage {
  language: string;
  term: string;
  link: string;
}

export interface TermView {
  term: string;
  translation: string;
  explanation: string;
  source: Source[];
  status: TermStatusKey;
  termSource: TermSourceKey;
  termMotivation: TermMotivationKey;
  termFormation: TermFormationKey;
  alternatives: Alternative[];
  languages: TermLanguage[];
  derivations: Derivation[];
  isComplete: boolean;
}