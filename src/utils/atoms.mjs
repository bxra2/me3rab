import { validateTermDiagrams } from './termDiagrams.mjs';

export { walkDiagramTerms, collectTermIds } from './termDiagrams.mjs';

/**
 * Validate the atom terminology glossary data shape and content.
 * @param {object} data
 * @returns {{ errors: string[] }}
 */
export function validateAtoms(data) {
  return validateTermDiagrams(data, {
    // requiredLanguageCodes: ['de'],
    minLanguages: 4,
    forbiddenLanguageCodes: ['fr', 'es', 'it', 'pt'],
    nontypicalCodes: ['is', 'fi', 'hu', 'tr', 'zh', 'ja', 'ko'],
    // minNontypicalLanguages: 3,
    requireLanguageCode: true,
    requireLanguageSource: true,
  });
}
