import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadLocalSkillManifest } from '../src/skills/local-skill-loader.js';
import { assertSkillManifest } from '../src/skills/skill-manifest.js';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteSkillStore } from '../src/storage/sqlite-skill-store.js';

const manifest = {
  schemaVersion: 1,
  id: 'review.release-notes',
  version: '1.0.0',
  name: 'Release-note reviewer',
  description: 'Produces a concise, evidence-first release-note review.',
  instructions: 'Focus on user-visible changes. State missing evidence explicitly.',
  tags: ['review', 'release'],
};

test('local skill manifest is data-only and rejects executable extension fields', () => {
  assert.deepEqual(assertSkillManifest(manifest), manifest);
  assert.throws(() => assertSkillManifest({ ...manifest, entrypoint: 'index.js' }), /not allowed/);
  assert.throws(() => assertSkillManifest({ ...manifest, id: 'Release Notes' }), /lowercase/);
});

test('loader snapshots a JSON manifest with its source hash', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hane-skill-'));
  writeFileSync(path.join(directory, 'skill.json'), JSON.stringify(manifest));
  const loaded = await loadLocalSkillManifest(directory);
  assert.deepEqual(loaded.manifest, manifest);
  assert.match(loaded.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(loaded.sourcePath.endsWith('skill.json'), true);
});

test('skill store returns catalog metadata but keeps full instructions for the local runtime only', () => {
  const database = openHaneDatabase(':memory:');
  const store = new SqliteSkillStore({ database });
  store.install({ manifest, sourcePath: 'C:/skills/release/skill.json', contentHash: 'a'.repeat(64), installedAt: '2026-10-10T12:00:00.000Z' });
  assert.deepEqual(store.list(), [{
    id: 'review.release-notes', version: '1.0.0', name: 'Release-note reviewer',
    description: 'Produces a concise, evidence-first release-note review.', tags: ['review', 'release'],
    contentHash: 'a'.repeat(64), installedAt: '2026-10-10T12:00:00.000Z',
  }]);
  assert.equal(store.findById('review.release-notes').instructions, manifest.instructions);
  database.close();
});
