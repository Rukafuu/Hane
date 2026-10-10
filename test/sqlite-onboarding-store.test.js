import assert from 'node:assert/strict';
import test from 'node:test';
import { openHaneDatabase } from '../src/storage/sqlite-database.js';
import { SqliteOnboardingStore } from '../src/storage/sqlite-onboarding-store.js';

test('onboarding store persists only GitHub connection metadata', () => {
  const database = openHaneDatabase(':memory:');
  const store = new SqliteOnboardingStore({ database });
  assert.equal(store.getGitHub(), null);

  const saved = store.saveGitHub({
    accountLabel: 'hane-user',
    scopes: ['read:user', 'repo:status'],
    connectedAt: '2026-10-09T12:00:00.000Z',
  });

  assert.deepEqual(saved, {
    accountLabel: 'hane-user',
    scopes: ['read:user', 'repo:status'],
    connectedAt: '2026-10-09T12:00:00.000Z',
  });
  assert.equal(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'onboarding_connections'").get().sql.includes('token'), false);
  database.close();
});
