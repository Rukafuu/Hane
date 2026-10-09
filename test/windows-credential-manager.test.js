import assert from 'node:assert/strict';
import test from 'node:test';
import { UnsupportedPlatformError, WindowsCredentialManager } from '../src/credentials/windows-credential-manager.js';

function managerWith(runner, platform = 'win32') {
  return new WindowsCredentialManager({ runner, platform });
}

test('sends a namespaced credential request to the bridge without using arguments', async () => {
  const calls = [];
  const manager = managerWith(async (path, payload) => { calls.push({ path, payload }); return { found: true, secret: 'hidden' }; });
  await manager.set('local-agent-orchestrator/openrouter', 'secret-value');
  assert.deepEqual(calls[0].payload, { operation: 'set', reference: 'local-agent-orchestrator/openrouter', secret: 'secret-value' });
  assert.equal(await manager.get('local-agent-orchestrator/openrouter'), 'hidden');
});

test('rejects an un-namespaced credential reference', async () => {
  const manager = managerWith(async () => ({ found: false }));
  await assert.rejects(() => manager.get('openrouter'), /namespaced/);
});

test('refuses every credential operation off Windows without spawning the bridge', async () => {
  for (const platform of ['linux', 'darwin']) {
    let spawned = 0;
    const manager = managerWith(async () => { spawned += 1; return { found: true, secret: 'hidden' }; }, platform);

    for (const attempt of [
      () => manager.set('local-agent-orchestrator/openrouter', 'secret-value'),
      () => manager.get('local-agent-orchestrator/openrouter'),
      () => manager.delete('local-agent-orchestrator/openrouter'),
    ]) {
      await assert.rejects(attempt, UnsupportedPlatformError);
    }
    assert.equal(spawned, 0);
    await assert.rejects(() => manager.get('local-agent-orchestrator/openrouter'), new RegExp(platform));
  }
});
