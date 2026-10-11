import { randomUUID } from 'node:crypto';
export class SqliteSettingsStore {
 constructor(database) { this.database=database; }
 listMemory() { return this.database.prepare('SELECT id,scope,target_id AS targetId,content,updated_at AS updatedAt FROM settings_memory ORDER BY updated_at DESC,id').all(); }
 saveMemory({id=randomUUID(),scope='shared',targetId=null,content}) {
  if(!['shared','agent','team'].includes(scope)||typeof content!=='string'||!content.trim()||content.length>4000)throw new TypeError('Memória inválida: escreva até 4000 caracteres.');
  if(this.listMemory().length>=100&&!this.listMemory().some(m=>m.id===id))throw new TypeError('Limite de 100 memórias.');
  if(scope!=='shared') {
   const table=scope==='agent'?'agents':'teams';
   if(typeof targetId!=='string'||!this.database.prepare('SELECT id FROM '+table+' WHERE id=?').get(targetId))throw new TypeError('Escolha um agente ou grupo existente.');
  } else targetId=null;
  if(typeof id!=='string'||id.length>80)throw new TypeError('Identificador inválido.');
  this.database.prepare('INSERT INTO settings_memory VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,target_id=excluded.target_id,content=excluded.content,updated_at=excluded.updated_at').run(id,scope,targetId,content.trim(),new Date().toISOString());
  return this.listMemory();
 }
 context(agentId,teamId) {return this.listMemory().filter(m=>m.scope==='shared'||m.scope==='agent'&&m.targetId===agentId||m.scope==='team'&&m.targetId===teamId).slice(0,12).map(({scope,content})=>({scope,content}));}
 removeMemory(id) {this.database.prepare('DELETE FROM settings_memory WHERE id=?').run(id);}
 listMcp() {return this.database.prepare('SELECT id,name,url FROM settings_mcp ORDER BY name').all();}
 saveMcp({id=randomUUID(),name,url}) {
  if(typeof name!=='string'||!name.trim()||name.length>80)throw new TypeError('Nome inválido.');
  const parsed=new URL(url);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash||parsed.search)throw new TypeError('Use um endpoint HTTP sem credenciais ou parâmetros.');
  if(parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw new TypeError('Endpoints remotos exigem HTTPS.');
  if(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id))throw new TypeError('Identificador inválido.');
  if(this.listMcp().length>=20&&!this.listMcp().some(m=>m.id===id))throw new TypeError('Limite de 20 servidores.');
  this.database.prepare('INSERT INTO settings_mcp VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url').run(id,name.trim(),parsed.href);
  return this.listMcp().find(m=>m.id===id);
 }
 removeMcp(id) {this.database.prepare('DELETE FROM settings_mcp WHERE id=?').run(id);}
}
