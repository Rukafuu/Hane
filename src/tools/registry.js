import { CAPABILITY } from '../capabilities.js';

/**
 * A tool is three things said in one place: the name a model may ask for, the
 * capability it may not run without, and the sandbox verb that carries it out.
 * Keeping them together is what makes "this call asked for a read" and "this
 * mission was granted a read" the same check instead of two that drift.
 *
 * The schema is what the gateway sees; the description is the only contract the
 * model can read, so it says what comes back rather than what we hope for.
 */
export const TOOLS = Object.freeze([
  Object.freeze({
    name: 'read_file',
    capability: CAPABILITY.WORKSPACE_READ,
    verb: 'read',
    description: 'Read one UTF-8 text file inside the workspace this mission was granted. Returns the content, its byte count, and whether it was truncated at the size cap.',
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        path: Object.freeze({ type: 'string', description: 'Path relative to the granted workspace root, like "src/app.js". Use "." for the root itself.' }),
      }),
      required: Object.freeze(['path']),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'list_dir',
    capability: CAPABILITY.WORKSPACE_READ,
    verb: 'list',
    description: 'List the entries of a granted directory. Directories end with "/" and links end with "@". Nothing is read from the files it names.',
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        path: Object.freeze({ type: 'string', description: 'Directory relative to the granted workspace root, like "src". Use "." for the root itself.' }),
      }),
      required: Object.freeze(['path']),
      additionalProperties: false,
    }),
  }),
  // Offered only by a backend that can carry the verb out. The directory on this
  // disk is not one, so a mission reading the user's files never sees these two:
  // an offer the machine would refuse is a wasted call and a false promise.
  Object.freeze({
    name: 'write_file',
    capability: CAPABILITY.WORKSPACE_WRITE,
    verb: 'write',
    description: 'Create or replace one UTF-8 text file inside the mission box working directory. Paths are relative to that root, and the box mounts no Windows drive, so nothing this writes can land on the user\'s disk.',
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        path: Object.freeze({ type: 'string', description: 'File relative to the box working directory, like "notes/plan.md". Parent directories are created.' }),
        content: Object.freeze({ type: 'string', description: 'The whole file content as text. This replaces the file; it does not append and does not patch.' }),
      }),
      required: Object.freeze(['path', 'content']),
      additionalProperties: false,
    }),
  }),
  Object.freeze({
    name: 'run_command',
    capability: CAPABILITY.PROCESS_RUN,
    verb: 'run',
    description: 'Run a program inside the mission box as an argument vector. argv[0] is a bare program name and no shell parses the rest, so pipes, redirects and `&&` are arguments here, not syntax. A non-zero exit is an answer: the output comes back with the code.',
    parameters: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        argv: Object.freeze({
          type: 'array',
          description: 'The program and its arguments, already split, like ["git", "status", "--short"].',
          items: Object.freeze({ type: 'string' }),
          minItems: 1,
          maxItems: 64,
        }),
      }),
      required: Object.freeze(['argv']),
      additionalProperties: false,
    }),
  }),
]);

const BY_NAME = Object.freeze(new Map(TOOLS.map((tool) => [tool.name, tool])));

export function toolFor(name) {
  return BY_NAME.get(name) ?? null;
}

/**
 * The tools this mission's grants cover, in declaration order. A grant the user
 * never wrote leaves the tool invisible: the model is not offered a verb it
 * would only be refused for.
 */
export function availableToolNames(grants = []) {
  const granted = new Set(grants.map((grant) => grant?.name));
  return TOOLS.filter((tool) => granted.has(tool.capability)).map((tool) => tool.name);
}

/** The `tools` array a gateway is asked with, in the shape OpenAI-compatible APIs document. */
export function toolSchemas(names = []) {
  return Object.freeze(names
    .map((name) => BY_NAME.get(name))
    .filter((tool) => tool !== undefined)
    .map((tool) => Object.freeze({
      type: 'function',
      function: Object.freeze({ name: tool.name, description: tool.description, parameters: tool.parameters }),
    })));
}
