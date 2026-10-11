import { KNOWN_CAPABILITIES } from '../capabilities.js';
import { decodeAvatarDataUrl } from '../image-data-url.js';
import { assertId, assertObject, text, TeamError } from './domain.js';
export function assertAgent(candidate) {
  assertObject(candidate);
  const providerLabel = candidate.providerLabel ?? null;
  if (providerLabel !== null && (typeof providerLabel !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(providerLabel))) throw new TeamError(400, 'Invalid providerLabel.');
  if (candidate.exclusive !== undefined && typeof candidate.exclusive !== 'boolean') throw new TeamError(400, 'exclusive must be a boolean.');
  const instructionFiles=candidate.instructionFiles??[];
  if(!Array.isArray(instructionFiles)||instructionFiles.length>8)throw new TeamError(400,'At most eight instruction documents are allowed.');
  const documents=instructionFiles.map(file=>{assertObject(file);return {id:assertId(file.id,'documentId'),name:text(file.name,'document name',120,1),text:text(file.text,'document text',12000,1)};});
  if(new Set(documents.map(d=>d.id)).size!==documents.length || documents.reduce((n,d)=>n+d.text.length,0)>24000)throw new TeamError(400,'Instruction documents exceed their limit.');
  const capabilities = candidate.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.length > 5 || new Set(capabilities).size !== capabilities.length || capabilities.some(v=>!KNOWN_CAPABILITIES.has(v))) throw new TeamError(400,'Invalid agent capabilities.');
  const visual = candidate.visual ?? {};
  assertObject(visual);
  if (visual.color !== undefined && !/^#[a-f0-9]{6}$/i.test(visual.color)) throw new TeamError(400,'Invalid avatar color.');
  if (visual.shape !== undefined && !['pebble','diamond','triangle','cloud'].includes(visual.shape)) throw new TeamError(400,'Invalid avatar shape.');
  if (visual.image != null && !decodeAvatarDataUrl(visual.image)) throw new TeamError(400,'Invalid avatar image.');
  return Object.freeze({ instructionFiles:documents, capabilities: Object.freeze([...capabilities]), visual: {color:visual.color||'#ed799a',shape:visual.shape||'pebble',image:visual.image||null}, isInitial: candidate.isInitial === true, id: assertId(candidate.id), name: text(candidate.name,'name',80,2), description: text(candidate.description ?? '','description',1000), instructions: text(candidate.instructions ?? '','instructions',12000), providerLabel, exclusive: candidate.exclusive ?? false });
}
