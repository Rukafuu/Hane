const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const MAX_INSTRUCTIONS_LENGTH = 24_000;

/**
 * Validates the deliberately data-only local skill format. A skill can guide
 * a model, but it cannot carry executable code, tools, credentials, or grants.
 */
export function assertSkillManifest(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('skill manifest must be an object.');
  const allowed = new Set(['schemaVersion', 'id', 'version', 'name', 'description', 'instructions', 'tags']);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) throw new TypeError(`skill manifest field "${key}" is not allowed.`);
  }
  if (candidate.schemaVersion !== 1) throw new TypeError('skill manifest schemaVersion must be 1.');
  if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id)) throw new TypeError('skill id must be lowercase and use letters, digits, dots, or hyphens.');
  if (typeof candidate.version !== 'string' || !VERSION_PATTERN.test(candidate.version)) throw new TypeError('skill version must be a semantic version.');
  if (typeof candidate.name !== 'string' || candidate.name.trim().length < 2 || candidate.name.length > 80) throw new TypeError('skill name must contain 2 to 80 characters.');
  if (typeof candidate.description !== 'string' || candidate.description.trim().length < 8 || candidate.description.length > 280) throw new TypeError('skill description must contain 8 to 280 characters.');
  if (typeof candidate.instructions !== 'string' || candidate.instructions.trim().length < 16 || candidate.instructions.length > MAX_INSTRUCTIONS_LENGTH) throw new TypeError(`skill instructions must contain 16 to ${MAX_INSTRUCTIONS_LENGTH} characters.`);
  if (!Array.isArray(candidate.tags) || candidate.tags.length > 8 || !candidate.tags.every((tag) => typeof tag === 'string' && /^[a-z0-9-]{1,32}$/.test(tag))) throw new TypeError('skill tags must be an array of up to 8 lowercase tags.');
  return Object.freeze({
    schemaVersion: 1,
    id: candidate.id,
    version: candidate.version,
    name: candidate.name.trim(),
    description: candidate.description.trim(),
    instructions: candidate.instructions.trim(),
    tags: Object.freeze([...candidate.tags]),
  });
}
