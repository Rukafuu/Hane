import { open, readdir } from 'node:fs/promises';

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
export const DEFAULT_MAX_ENTRIES = 200;

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
