import { createScopeResolver } from '../workspace-scope.js';
import { DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILE_BYTES, listWorkspaceDir, readWorkspaceFile } from '../tools/workspace-read.js';
import { defineSandbox } from './interface.js';

/**
 * The first backend: the directory a mission was granted *is* the box. It
 * executes exactly what the core executed on its own before the seam existed —
 * reads and listings under the containment resolver — and names the verbs it
 * has no executor for, so the orchestrator no longer has to know which of its
 * tools are real.
 *
 * A path grant says where a mission may look, never that it may change what it
 * finds: `write` stays unimplemented here until there is a machine behind it
 * that the user does not have to trust the model with.
 */
export function createWorkspaceDirSandbox({ root, grants = [], limits = {} }) {
  const resolver = createScopeResolver({ root, grants });
  return defineSandbox({
    id: 'workspace-dir',
    root,
    read: ({ path } = {}) => readWorkspaceFile({ resolver, relPath: path, maxBytes: limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES }),
    list: ({ path } = {}) => listWorkspaceDir({ resolver, relPath: path, maxEntries: limits.maxEntries ?? DEFAULT_MAX_ENTRIES }),
  });
}
