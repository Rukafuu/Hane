import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertSkillManifest } from './skill-manifest.js';

/** Reads exactly one local, data-only skill manifest. Nothing is imported or executed. */
export async function loadLocalSkillManifest(directory) {
  if (typeof directory !== 'string' || directory.trim() === '') throw new TypeError('a skill directory is required.');
  const sourcePath = await realpath(path.join(directory, 'skill.json'));
  let parsed;
  const raw = await readFile(sourcePath, 'utf8');
  try { parsed = JSON.parse(raw); } catch { throw new TypeError(`skill manifest at "${sourcePath}" is not valid JSON.`); }
  return Object.freeze({ manifest: assertSkillManifest(parsed), sourcePath, contentHash: createHash('sha256').update(raw, 'utf8').digest('hex') });
}
