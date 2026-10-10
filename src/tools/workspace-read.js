import { open, readdir } from 'node:fs/promises';

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
export const DEFAULT_MAX_ENTRIES = 200;
export const DEFAULT_MAX_PATHS = 12;

const PATHISH = /^[~.]?[A-Za-z0-9_.@+\-/\\:]+$/;

/**
 * Reads only up to the byte cap and never trusts the earlier resolver stat:
 * the file could be swapped between the check and the open.
 */
export async function readWorkspaceFile({ resolver, relPath, maxBytes = DEFAULT_MAX_FILE_BYTES }) {
  const checked = resolver.check(relPath);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, relPath: checked.relPath ?? relPath };
  }

  let handle;
  try {
    handle = await open(checked.absolutePath, 'r');
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, reason: 'not_a_file', relPath: checked.relPath };

    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    const window = buffer.subarray(0, bytesRead);
    if (window.includes(0x00)) return { ok: false, reason: 'binary_content', relPath: checked.relPath };

    const truncated = bytesRead > maxBytes || info.size > maxBytes;
    let content = window.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8');
    if (truncated) {
      const lastBreak = content.lastIndexOf('\n');
      if (lastBreak > maxBytes * 0.5) content = content.slice(0, lastBreak + 1);
    }
    return {
      ok: true,
      relPath: checked.relPath,
      content,
      truncated,
      bytes: Buffer.byteLength(content, 'utf8'),
      totalBytes: info.size,
    };
  } catch (error) {
    return { ok: false, reason: 'read_failed', relPath: checked.relPath, message: error instanceof Error ? error.message : String(error) };
  } finally {
    await handle?.close();
  }
}

export async function listWorkspaceDir({ resolver, relPath, maxEntries = DEFAULT_MAX_ENTRIES }) {
  const checked = resolver.checkDirectory(relPath);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, relPath: checked.relPath ?? relPath };
  }

  try {
    const entries = await readdir(checked.absolutePath, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !resolver.isSecret(`${checked.relPath}/${entry.name}`))
      .map((entry) => {
        const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
        return entry.isSymbolicLink() ? `${name}@` : name;
      })
      .sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      relPath: checked.relPath,
      entries: visible.slice(0, maxEntries),
      truncated: visible.length > maxEntries,
      total: visible.length,
    };
  } catch (error) {
    return { ok: false, reason: 'list_failed', relPath: checked.relPath, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Only a hint of what the planner wants to see; every token still goes through
 * the resolver, so a fabricated or absolute path becomes an audited denial
 * instead of being silently dropped here.
 */
export function parseRequestedPaths(text, { maxPaths = DEFAULT_MAX_PATHS } = {}) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const found = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/`/g, '');
    if (line.length > 512 || line.includes('://')) continue;
    for (const rawToken of line.split(/[\s,;]+/)) {
      const candidate = rawToken.replace(/^["'(]+/, '').replace(/["').,!?:;]+$/, '');
      if (candidate.length === 0 || candidate.length > 512) continue;
      if (!PATHISH.test(candidate)) continue;
      const looksLikePath = candidate.includes('/') || candidate.includes('\\') || /\.[A-Za-z0-9]{1,6}$/.test(candidate);
      if (!looksLikePath) continue;
      if (!found.includes(candidate)) found.push(candidate);
    }
  }
  return found.slice(0, maxPaths);
}
