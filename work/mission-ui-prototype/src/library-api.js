import { json } from './api.js';
import { readPreference, writePreference, validateLibrary } from './preferences.js';
const endpoint = id => encodeURIComponent(id);
export async function libraryRequest(path, method = 'GET', body) {
  return fetch('/api/'+path, {method, ...(method === 'GET' ? {} : {headers:{'content-type':'application/json','x-hane-request':'1'},body:JSON.stringify(body || {})})}).then(json);
}
const visuals = () => readPreference('hane-library-visuals',{agents:{},groups:{}});
const reasonOf = (error) => String(error?.message ?? error ?? 'falha desconhecida').slice(0,120);
function agentView(agent, groups, visual = {}) {
  return {...visual,...agent,provider:agent.providerLabel || '',shape:agent.visual?.shape || visual.shape || 'pebble',color:agent.visual?.color || visual.color || '#ed799a',image:agent.visual && Object.hasOwn(agent.visual,'image') ? agent.visual.image : visual.image ?? null,groupId:agent.exclusive ? groups.find(g=>g.members.includes(agent.id))?.id || '' : ''};
}
function groupView(group, visual = {}, runs = []) {
  return {...visual,...group,color:visual.color || '#ed799a',leader:group.leaderAgentId || '',runs};
}
export async function fetchLibrary() {
  const [agentData,teamData] = await Promise.all([libraryRequest('agents'),libraryRequest('teams')]);
  if (!Array.isArray(agentData.agents) || !Array.isArray(teamData.teams)) throw new Error('Resposta de biblioteca inválida.');
  // Lists intentionally omit instructions. Never turn an absent prompt into an
  // empty prompt on edit, duplication or export.
  // One unreadable row is that row's problem: it is reported and left out instead
  // of blanking every agent and every group in the sidebar.
  const details = await Promise.allSettled(agentData.agents.map(a=>libraryRequest('agents/'+endpoint(a.id))));
  const histories = await Promise.allSettled(teamData.teams.map(t=>libraryRequest('teams/'+endpoint(t.id)+'/executions')));
  const unavailable = [];
  const agents = [];
  agentData.agents.forEach((row,i)=>{
    if (details[i].status === 'fulfilled') agents.push(details[i].value);
    else unavailable.push({ kind:'o agente', name:row.name || row.id, reason:reasonOf(details[i].reason) });
  });
  const visual = visuals();
  const groups = teamData.teams.map((g,i)=>{
    if (histories[i].status !== 'fulfilled') unavailable.push({ kind:'o histórico do grupo', name:g.name || g.id, reason:reasonOf(histories[i].reason) });
    return groupView(g,visual.groups?.[g.id],histories[i].status === 'fulfilled' ? histories[i].value.executions.map(run=>run.id) : []);
  });
  return {agents:agents.map(a=>agentView(a,groups,visual.agents?.[a.id])),groups,unavailable};
}
export function unavailableNotice(items = []) {
  if (!items.length) return '';
  return `Não foi possível ler do servidor: ${items.map(i=>`${i.kind} “${i.name}” (${i.reason})`).join(', ')}. O restante da biblioteca está carregado.`;
}
export async function changeLibrary(current, next) {
  const changes=[];
  for (const key of ['agents','groups']) {
    for (const item of next[key]) if (JSON.stringify(item)!==JSON.stringify(current[key].find(a=>a.id===item.id))) changes.push({key,item,old:current[key].find(a=>a.id===item.id)});
    for (const item of current[key]) if (!next[key].some(a=>a.id===item.id)) changes.push({key,item,remove:true});
  }
  if (changes.length !== 1) throw new Error('Altere um agente ou grupo por vez. Para backups, use a importação.');
  const {key,item,old,remove}=changes[0], agent=key==='agents', route=agent?'agents':'teams';
  if (!agent && old?.archivedAt) throw new Error('Este grupo está arquivado.');
  let saved;
  if (remove) saved=await libraryRequest(route+'/'+endpoint(item.id)+(agent?'':'/archive'),agent?'DELETE':'POST');
  else {
    const body=agent ? {name:item.name,description:item.description,instructions:item.instructions,providerLabel:item.provider || null,exclusive:Boolean(item.exclusive),capabilities:item.capabilities||[],instructionFiles:item.instructionFiles||[],visual:{color:item.color,shape:item.shape,image:item.image}} : {name:item.name,description:item.description,members:item.members,leaderAgentId:item.leader || null};
    saved=await libraryRequest(route+(old?'/'+endpoint(item.id):''),old?'PUT':'POST',body);
  }
  const visual=visuals(); visual.agents ||= {}; visual.groups ||= {};
  if (!remove) visual[key][saved.id]=agent?{color:item.color,shape:item.shape,image:item.image}:{color:item.color};
  const visualSaved=writePreference('hane-library-visuals',visual);
  const result={agents:[...current.agents],groups:[...current.groups]};
  if (agent && remove) result.agents=result.agents.filter(a=>a.id!==item.id);
  else {
    const view=agent?agentView(saved,result.groups,visual.agents[saved.id]):groupView(saved,visual.groups[saved.id],current.groups.find(g=>g.id===item.id)?.runs || []);
    result[key]=old || remove ? result[key].map(a=>a.id===item.id?view:a) : [...result[key],view];
  }
  // Membership edits can move an exclusive agent's assignment.
  result.agents=result.agents.map(a=>({...a,groupId:a.exclusive?result.groups.find(g=>g.members.includes(a.id))?.id || '':''}));
  return {library:result,visualSaved};
}
export function legacyLibrary() {
  const stored=readPreference('hane-library',null);
  const fallback={agents:readPreference('hane-custom-hanes',[]).map(a=>({...a,description:a.job || 'Hane personalizado',groupId:''})),groups:[]};
  return validateLibrary(stored || fallback);
}
export function importPayload(library) {
  const data=validateLibrary(library);
  for (const agent of data.agents) if (agent.groupId && !data.groups.find(g=>g.id===agent.groupId)?.members.includes(agent.id)) throw new Error('O agente '+agent.name+' está reservado para um grupo, mas não é integrante dele. Revise essa associação no backup antes de importar; o original foi preservado.');
  return {agents:data.agents.map(a=>({id:a.id,name:a.name,description:a.description,instructions:a.instructions,instructionFiles:a.instructionFiles||[],capabilities:a.capabilities||[],visual:{color:a.color,shape:a.shape,image:a.image},providerLabel:a.provider || null,exclusive:library.agents.find(source=>source.id===a.id)?.exclusive === true || Boolean(a.groupId)})),teams:data.groups.filter(g=>g.members.length).map(g=>({id:g.id,name:g.name,description:g.description,members:g.members,leaderAgentId:g.leader || null,archived:Boolean(g.archivedAt)}))};
}
export async function importBrowserLibrary(library) {
  const payload=importPayload(library), source=JSON.stringify(payload);
  if (new TextEncoder().encode(source).length > 4*1024*1024-100) throw new Error('A biblioteca excede o limite de importação de 4 MB. O original foi preservado.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const stored=readPreference('hane-library-imports',[]);
  const pending=Array.isArray(stored)?stored:[];
  let journal=pending.find(entry=>entry.fingerprint===fingerprint);
  if (!journal) {
    journal={fingerprint,id:crypto.randomUUID()};
    if (!writePreference('hane-library-imports',[...pending,journal])) throw new Error('Não foi possível guardar o identificador da importação. Nenhum dado foi enviado.');
  }
  const receipt=await libraryRequest('library/import','POST',{importId:journal.id,...payload});
  const visual=visuals(); visual.agents ||= {}; visual.groups ||= {};
  for (const a of library.agents) if(receipt.agentIds[a.id] && !visual.agents[receipt.agentIds[a.id]]) visual.agents[receipt.agentIds[a.id]]={color:a.color,shape:a.shape,image:a.image};
  for (const g of library.groups) if(receipt.teamIds[g.id] && !visual.groups[receipt.teamIds[g.id]]) visual.groups[receipt.teamIds[g.id]]={color:g.color};
  const visualSaved=writePreference('hane-library-visuals',visual);
  // Never overwrite or delete hane-library: empty drafts and historical browser
  // references remain available in the legacy archive for export and inspection.
  return {receipt,visualSaved};
}
