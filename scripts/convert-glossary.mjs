/**
 * Deprecated.
 *
 * This converter regenerated term markdown from the legacy
 * `src/data/glossary.json`. That dataset uses `recommended` where the
 * content schema uses `translation`, and it is stale compared with the
 * richer hand-edited files under `src/content/terms/`. Running it would
 * blank translations and drop fields such as `isComplete`.
 *
 * `src/content/terms/*.md` is now the single source of truth. Manage
 * relation drift with `scripts/sync-relations.mjs` instead.
 */

console.error(
  'terms:generate مُهمَل — src/content/terms/*.md هو المصدر الوحيد للحقيقة؛ أدر العلاقات عبر scripts/sync-relations.mjs.'
);
console.error(
  'terms:generate is deprecated — src/content/terms/*.md is now the single source of truth; manage relations with scripts/sync-relations.mjs.'
);
process.exit(1);
