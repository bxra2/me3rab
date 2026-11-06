import { validateTermDiagrams } from './termDiagrams.mjs';

export { walkDiagramTerms, collectTermIds } from './termDiagrams.mjs';

/**
 * Validate the nutrient glossary data shape and content.
 * @param {object} data
 * @returns {{ errors: string[] }}
 */
export function validateNutrients(data) {
  return validateTermDiagrams(data, {
    requiredLanguages: ['الفرنسية', 'الألمانية', 'الإسبانية'],
    requireLanguageCode: false,
  });
}
