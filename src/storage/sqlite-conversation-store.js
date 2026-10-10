import { randomUUID } from 'node:crypto';
import { assertId, text, TeamError } from '../teams/domain.js';
export class SqliteConversationStore {
 constructor({database,agentStore,teamStore}) { this.database=database;this.agentStore=agentStore;this.teamStore=teamStore; }
 recover() { this.database.prepare("UPDATE conversation_turns SET status='interrupted',error='Server stopped before this turn finished.' WHERE status='running'").run(); }
 create({agentId=null,teamId=null,title='Nova conversa'}) {
  if(Boolean(agentId)===Boolean(teamId))throw new TeamError(400,'Choose one agent or one group.');
  if(agentId){assertId(agentId,'agentId');if(!this.agentStore.get(agentId))throw new TeamError(404,'Unknown agent.');}
  if(teamId){assertId(teamId,'teamId');this.teamStore.requireActive(teamId);}
  const id=randomUUID();this.database.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)').run(id,agentId,teamId,text(title,'title',120,1),new Date().toISOString());return this.get(id);
 }
 list() {return this.database.prepare('SELECT id,agent_id AS agentId,team_id AS teamId,title,created_at AS createdAt FROM conversations ORDER BY created_at DESC,id DESC').all();}
 get(id) {
  assertId(id);const row=this.list().find(c=>c.id===id);if(!row)throw new TeamError(404,'Unknown conversation.');
  return {...row,messages:this.database.prepare('SELECT id,turn_id AS turnId,agent_id AS agentId,author_name AS authorName,content,created_at AS createdAt FROM conversation_messages WHERE conversation_id=? ORDER BY ordinal').all(id),turns:this.database.prepare('SELECT id,recipient_id AS recipientId,status,error,provider_calls AS providerCalls,tool_calls AS toolCalls,max_provider_calls AS maxProviderCalls,max_tool_calls AS maxToolCalls,audit_json,created_at AS createdAt FROM conversation_turns WHERE conversation_id=? ORDER BY created_at,rowid').all(id).map(({audit_json,...t})=>({...t,audit:JSON.parse(audit_json)}))};
 }
 addMessage(conversationId,turnId,agent,content) {
  this.database.prepare('INSERT INTO conversation_messages(id,conversation_id,turn_id,agent_id,author_name,content,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),conversationId,turnId,agent?.id||null,agent?.name||'Você',text(content,'message',64000,1),new Date().toISOString());
 }
 begin(conversationId,{recipientId=null,content,maxProviderCalls,maxToolCalls}) {
  const id=randomUUID();text(content,'message',12000,1);
  if(this.get(conversationId).turns.some(t=>t.status==='running'))throw new TeamError(409,'Wait for the current turn or cancel it.');
  this.database.exec('BEGIN IMMEDIATE');
  try {
   this.database.prepare("INSERT INTO conversation_turns(id,conversation_id,recipient_id,status,max_provider_calls,max_tool_calls,created_at) VALUES (?,?,?,'running',?,?,?)").run(id,conversationId,recipientId,maxProviderCalls,maxToolCalls,new Date().toISOString());
   this.addMessage(conversationId,id,null,content);this.database.exec('COMMIT');
  }catch(e){this.database.exec('ROLLBACK');throw e;}
  return id;
 }
 update(id,{status,providerCalls,toolCalls,audit,error=null}) {this.database.prepare('UPDATE conversation_turns SET status=?,provider_calls=?,tool_calls=?,audit_json=?,error=? WHERE id=?').run(status,providerCalls,toolCalls,JSON.stringify(audit),error,id);}
}
