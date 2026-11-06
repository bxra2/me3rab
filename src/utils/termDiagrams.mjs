const INVISIBLE_BIDI = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/;
const DIAGRAM_ACCENTS = new Set(['accent', 'secondary', 'ink']);
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectStrings(value, path, errors, visited) {
  if (typeof value === 'string') {
    if (value !== value.normalize('NFC')) {
      errors.push(`${path}: must be NFC-normalized`);
    }
    if (INVISIBLE_BIDI.test(value)) {
      errors.push(`${path}: must not contain invisible bidi/control characters`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectStrings(item, `${path}[${index}]`, errors, visited);
    });
    return;
  }

  if (value && typeof value === 'object') {
    if (visited.has(value)) return;
    visited.add(value);

    for (const [key, item] of Object.entries(value)) {
      if (key !== key.normalize('NFC')) {
        errors.push(`${path}: key "${key}" must be NFC-normalized`);
      }
      if (INVISIBLE_BIDI.test(key)) {
        errors.push(`${path}: key must not contain invisible bidi/control characters`);
      }
      collectStrings(item, path ? `${path}.${key}` : key, errors, visited);
    }
  }
}

/**
 * Collect every term id referenced by a diagram.
 * @param {object} diagram
 * @returns {string[]}
 */
export function walkDiagramTerms(diagram) {
  const terms = [];

  if (!diagram || typeof diagram !== 'object') return terms;

  const push = (value) => {
    if (isNonEmptyString(value)) terms.push(value);
  };

  if (diagram.root) push(diagram.root.term);

  for (const group of asArray(diagram.groups)) {
    if (!group || typeof group !== 'object') continue;
    push(group.term);

    for (const branch of asArray(group.branches)) {
      if (!branch || typeof branch !== 'object') continue;
      push(branch.term);

      for (const term of asArray(branch.terms)) push(term);

      for (const column of asArray(branch.columns)) {
        if (!column || typeof column !== 'object') continue;
        push(column.term);

        for (const term of asArray(column.terms)) push(term);
      }
    }
  }

  return terms;
}

/**
 * @param {object} data
 * @returns {string[]}
 */
export function collectTermIds(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    !data.terms ||
    typeof data.terms !== 'object' ||
    Array.isArray(data.terms)
  ) {
    return [];
  }
  return Object.keys(data.terms);
}

function isSafeHref(value) {
  if (!isNonEmptyString(value)) return false;

  if (value.startsWith('/')) {
    return !value.startsWith('//') && !/[\s\\]/.test(value);
  }

  if (!/^https?:\/\//i.test(value)) return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function checkHref(value, path, errors) {
  if (!isSafeHref(value)) {
    errors.push(`${path}.href must be an http(s) or site-relative URL`);
  }
}

function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toLowerCase() : '';
}

function primarySubtag(code) {
  return normalizeCode(code).split('-')[0];
}

function primaryCodes(values) {
  return new Set(asArray(values).map(primarySubtag).filter(Boolean));
}

function checkLanguageEntry(item, itemPath, errors, options) {
  if (!item || !isNonEmptyString(item.language)) {
    errors.push(`${itemPath}.language must be a non-empty string`);
  }

  if (!item || !isNonEmptyString(item.term)) {
    errors.push(`${itemPath}.term must be a non-empty string`);
  }

  if (item && Object.prototype.hasOwnProperty.call(item, 'href')) {
    checkHref(item.href, itemPath, errors);
  }

  if (!options.requireLanguageCode || !item) {
    return null;
  }

  const rawCode = typeof item.code === 'string' ? item.code.trim() : '';
  if (!isNonEmptyString(rawCode)) {
    errors.push(`${itemPath}.code must be a non-empty string`);
  } else if (!LANGUAGE_CODE_PATTERN.test(rawCode)) {
    errors.push(`${itemPath}.code must be a valid BCP-47 language code`);
  } else {
    if (
      options.requireLanguageSource &&
      !isNonEmptyString(item.source)
    ) {
      errors.push(`${itemPath}.source must be a non-empty string`);
    }

    return primarySubtag(rawCode);
  }

  if (
    options.requireLanguageSource &&
    !isNonEmptyString(item.source)
  ) {
    errors.push(`${itemPath}.source must be a non-empty string`);
  }

  return null;
}

/**
 * Validate a term-diagram glossary data shape and content.
 *
 * Name-based language requirements stay available for the nutrient data set,
 * while code-based language rules only run when `requireLanguageCode` is true.
 *
 * @param {object} data
 * @param {object} [options]
 * @returns {{ errors: string[] }}
 */
export function validateTermDiagrams(data, options = {}) {
  const {
    requiredLanguages = [],
    requiredLanguageCodes = [],
    forbiddenLanguages = [],
    forbiddenLanguageCodes = [],
    minLanguages = 0,
    minNontypicalLanguages = 0,
    nontypicalCodes = [],
    requireLanguageCode = false,
    requireLanguageSource = false,
  } = options;

  const errors = [];

  if (!data || typeof data !== 'object') {
    return { errors: ['data must be an object'] };
  }

  collectStrings(data, 'data', errors, new Set());

  const diagrams = Array.isArray(data.diagrams) ? data.diagrams : [];
  const terms =
    data.terms && typeof data.terms === 'object' && !Array.isArray(data.terms)
      ? data.terms
      : {};

  if (diagrams.length === 0) {
    errors.push('diagrams must be a non-empty array');
  }

  const diagramIds = new Set();
  const referenced = [];

  for (const [index, diagram] of diagrams.entries()) {
    if (!diagram || typeof diagram !== 'object') {
      errors.push(`diagrams[${index}] must be an object`);
      continue;
    }

    if (!isNonEmptyString(diagram.id)) {
      errors.push(`diagrams[${index}].id must be a non-empty string`);
    } else if (diagramIds.has(diagram.id)) {
      errors.push(`diagrams[${index}].id "${diagram.id}" is duplicated`);
    } else {
      diagramIds.add(diagram.id);
    }

    for (const field of ['title', 'titleEn', 'intro', 'footer']) {
      if (!isNonEmptyString(diagram[field])) {
        errors.push(`diagrams[${index}].${field} must be a non-empty string`);
      }
    }

    if (
      !diagram.root ||
      typeof diagram.root !== 'object' ||
      Array.isArray(diagram.root)
    ) {
      errors.push(`diagrams[${index}].root must be an object`);
    } else if (!isNonEmptyString(diagram.root.term)) {
      errors.push(`diagrams[${index}].root.term must be a non-empty string`);
    }

    if (!Array.isArray(diagram.groups) || diagram.groups.length === 0) {
      errors.push(`diagrams[${index}].groups must be a non-empty array`);
    }

    for (const term of walkDiagramTerms(diagram)) {
      referenced.push(term);
      if (!Object.prototype.hasOwnProperty.call(terms, term)) {
        errors.push(`diagrams[${index}] references undefined term "${term}"`);
      }
    }

    for (const [groupIndex, group] of asArray(diagram.groups).entries()) {
      const groupPath = `diagrams[${index}].groups[${groupIndex}]`;

      if (!group || typeof group !== 'object') {
        errors.push(`${groupPath} must be an object`);
        continue;
      }

      if (!isNonEmptyString(group.term)) {
        errors.push(`${groupPath}.term must be a non-empty string`);
      }

      if (!Array.isArray(group.branches) || group.branches.length === 0) {
        errors.push(`${groupPath}.branches must be a non-empty array`);
      }

      if (!DIAGRAM_ACCENTS.has(group.accent)) {
        errors.push(`${groupPath}.accent must be one of accent/secondary/ink`);
      }

      if (group.roles !== undefined) {
        if (!Array.isArray(group.roles)) {
          errors.push(`${groupPath}.roles must be an array`);
        } else {
          group.roles.forEach((role, roleIndex) => {
            if (!isNonEmptyString(role)) {
              errors.push(
                `${groupPath}.roles[${roleIndex}] must be a non-empty string`
              );
            }
          });
        }
      }

      for (const [branchIndex, branch] of asArray(group.branches).entries()) {
        const branchPath = `${groupPath}.branches[${branchIndex}]`;

        if (!branch || typeof branch !== 'object') {
          errors.push(`${branchPath} must be an object`);
          continue;
        }

        if (!isNonEmptyString(branch.term) && !isNonEmptyString(branch.label)) {
          errors.push(`${branchPath} must have a term or label`);
        }

        for (const key of ['columns', 'items', 'terms']) {
          if (branch[key] !== undefined && !Array.isArray(branch[key])) {
            errors.push(`${branchPath}.${key} must be an array`);
          }
        }

        for (const [termIndex, term] of asArray(branch.terms).entries()) {
          if (!isNonEmptyString(term)) {
            errors.push(
              `${branchPath}.terms[${termIndex}] must be a non-empty string`
            );
          }
        }

        for (const [itemIndex, item] of asArray(branch.items).entries()) {
          if (!isNonEmptyString(item)) {
            errors.push(
              `${branchPath}.items[${itemIndex}] must be a non-empty string`
            );
          }
        }

        for (const [columnIndex, column] of asArray(branch.columns).entries()) {
          const columnPath = `${branchPath}.columns[${columnIndex}]`;

          if (!column || typeof column !== 'object') {
            errors.push(`${columnPath} must be an object`);
            continue;
          }

          if (!isNonEmptyString(column.term)) {
            errors.push(`${columnPath}.term must be a non-empty string`);
          }

          for (const key of ['items', 'terms']) {
            if (column[key] !== undefined && !Array.isArray(column[key])) {
              errors.push(`${columnPath}.${key} must be an array`);
            }
          }

          for (const [termIndex, term] of asArray(column.terms).entries()) {
            if (!isNonEmptyString(term)) {
              errors.push(
                `${columnPath}.terms[${termIndex}] must be a non-empty string`
              );
            }
          }

          for (const [itemIndex, item] of asArray(column.items).entries()) {
            if (!isNonEmptyString(item)) {
              errors.push(
                `${columnPath}.items[${itemIndex}] must be a non-empty string`
              );
            }
          }
        }
      }
    }
  }

  for (const [id, term] of Object.entries(terms)) {
    const path = `terms.${id}`;

    if (!term || typeof term !== 'object' || Array.isArray(term)) {
      errors.push(`${path} must be an object`);
      continue;
    }

    for (const field of [
      'ar',
      'en',
      'origin',
      'arabicMeaning',
      'description',
    ]) {
      if (!isNonEmptyString(term[field])) {
        errors.push(`${path}.${field} must be a non-empty string`);
      }
    }

    if (!Array.isArray(term.references) || term.references.length === 0) {
      errors.push(`${path}.references must be a non-empty array`);
    } else {
      term.references.forEach((reference, index) => {
        const referencePath = `${path}.references[${index}]`;

        if (!reference || !isNonEmptyString(reference.name)) {
          errors.push(`${referencePath}.name must be a non-empty string`);
        }
        if (
          reference &&
          Object.prototype.hasOwnProperty.call(reference, 'href')
        ) {
          checkHref(reference.href, referencePath, errors);
        }
      });
    }

    for (const key of ['translations', 'suggestions']) {
      if (!Array.isArray(term[key])) {
        errors.push(`${path}.${key} must be an array`);
        continue;
      }

      term[key].forEach((item, index) => {
        const itemPath = `${path}.${key}[${index}]`;

        if (!item || !isNonEmptyString(item.term)) {
          errors.push(`${itemPath}.term must be a non-empty string`);
        }
        if (!item || !isNonEmptyString(item.source)) {
          errors.push(`${itemPath}.source must be a non-empty string`);
        }
        if (item && Object.prototype.hasOwnProperty.call(item, 'href')) {
          checkHref(item.href, itemPath, errors);
        }
      });
    }

    const languageNames = new Set();
    const uniqueCodes = new Set();

    if (!Array.isArray(term.languages) || term.languages.length === 0) {
      errors.push(`${path}.languages must be a non-empty array`);
    } else {
      term.languages.forEach((item, index) => {
        const itemPath = `${path}.languages[${index}]`;
        const code = checkLanguageEntry(item, itemPath, errors, options);

        if (item && isNonEmptyString(item.language)) {
          languageNames.add(item.language);
        }
        if (code) uniqueCodes.add(code);
      });
    }


    if (requireLanguageCode) {
      const required = primaryCodes(requiredLanguageCodes);
      for (const code of required) {
        if (!uniqueCodes.has(code)) {
          errors.push(
            `${path}.languages must include language code "${code}"`
          );
        }
      }

      const forbidden = primaryCodes(forbiddenLanguageCodes);
      for (const code of forbidden) {
        if (uniqueCodes.has(code)) {
          errors.push(
            `${path}.languages must not include forbidden language code "${code}"`
          );
        }
      }

      if (minLanguages > 0 && uniqueCodes.size < minLanguages) {
        errors.push(
          `${path}.languages must include at least ${minLanguages} languages`
        );
      }

      if (minNontypicalLanguages > 0) {
        const nontypical = primaryCodes(nontypicalCodes);
        let count = 0;
        for (const code of uniqueCodes) {
          if (nontypical.has(code)) count++;
        }
        if (count < minNontypicalLanguages) {
          errors.push(
            `${path}.languages must include at least ${minNontypicalLanguages} non-typical languages`
          );
        }
      }
    }

    for (const forbidden of asArray(forbiddenLanguages)) {
      if (languageNames.has(forbidden)) {
        errors.push(`${path}.languages must not include ${forbidden}`);
      }
    }

    // for (const required of asArray(requiredLanguages)) {
    //   if (!languageNames.has(required)) {
    //     errors.push(`${path}.languages must include ${required}`);
    //   }
    // }
  }

  const referencedSet = new Set(referenced);
  for (const id of Object.keys(terms)) {
    if (!referencedSet.has(id)) {
      errors.push(`term "${id}" is defined but never referenced in a diagram`);
    }
  }

  return { errors };
}
