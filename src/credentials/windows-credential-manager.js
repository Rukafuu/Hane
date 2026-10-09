import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_REFERENCE_PATTERN } from '../contracts.js';

/**
 * Thin, Windows-only transport for the Credential Manager bridge. Its JSON
 * payload is written over stdin; credentials never appear in process arguments
 * or task/audit records.
 */
export class WindowsCredentialManager {
  constructor({
    runner = runPowerShell,
    scriptPath = new URL('../../scripts/windows-credential-manager.ps1', import.meta.url),
    platform = process.platform,
  } = {}) {
    this.runner = runner;
    this.scriptPath = scriptPath;
    this.platform = platform;
  }

  async set(reference, secret) {
    this.#requireWindows('store a credential');
    validateReference(reference);
    if (typeof secret !== 'string' || secret.length === 0) throw new TypeError('secret is required.');
    await this.runner(this.scriptPath, { operation: 'set', reference, secret });
  }

  async get(reference) {
    this.#requireWindows('read a credential');
    validateReference(reference);
    const result = await this.runner(this.scriptPath, { operation: 'get', reference });
    return result.found ? result.secret : null;
  }

  async delete(reference) {
    this.#requireWindows('delete a credential');
    validateReference(reference);
    await this.runner(this.scriptPath, { operation: 'delete', reference });
  }

  #requireWindows(action) {
    if (this.platform === 'win32') return;
    throw new UnsupportedPlatformError(`Hane needs the Windows Credential Manager to ${action}, and platform "${this.platform}" has no such bridge.`);
  }
}

export class UnsupportedPlatformError extends Error {}

function validateReference(reference) {
  if (typeof reference !== 'string' || !CREDENTIAL_REFERENCE_PATTERN.test(reference)) {
    throw new TypeError('reference must be namespaced as local-agent-orchestrator/<provider>.');
  }
}

function runPowerShell(scriptPath, payload) {
  return new Promise((resolve, reject) => {
    const filePath = scriptPath instanceof URL ? fileURLToPath(scriptPath) : scriptPath;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`Credential Manager bridge failed (${code}): ${stderr.trim()}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Credential Manager bridge returned invalid JSON.')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
