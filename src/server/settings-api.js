import { randomUUID } from 'node:crypto';
import { SqliteSettingsStore } from '../storage/sqlite-settings-store.js';
import { assertProviderConfig } from '../providers/provider-config.js';
import { connectMcp } from '../integrations/mcp-http.js';
export function createSettingsApi({database,repository,providerConfigStore,credentialManager,readJsonBody,respondJson,fetchImpl=fetch}) {
 const store=database?new SqliteSettingsStore(database):null;
 if(store)database.prepare("UPDATE settings_mcp_calls SET status='interrupted',finished_at=? WHERE status='running'").run(new Date().toISOString());
 const pending=new Set();
 const reply=(r,status,data)=>{respondJson(r,status,data);return true;};
 return async ({request,response,isAuthorized})=>{
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  if(!path.startsWith('/api/settings/'))return false;
  if(!isAuthorized())return reply(response,401,{error:'Desbloqueie o Hane.'});
  if(!store)return reply(response,503,{error:'Armazenamento indisponível.'});
  const method=request.method;
  try {
   const body=['POST','PUT','DELETE'].includes(method)?await readJsonBody(request):{};
   if(!isAuthorized())return reply(response,401,{error:'Sessão encerrada.'});
   if(path==='/api/settings/providers'&&method==='PUT') {
    const previous=providerConfigStore.findByLabel(body.label);
    const config=assertProviderConfig({label:body.label,baseUrl:body.baseUrl,model:body.model,maxTokens:body.maxTokens,credentialReference:previous?.credentialReference||'local-agent-orchestrator/'+body.label});
    const url=new URL(config.baseUrl);if(url.username||url.password||url.search||url.hash)throw TypeError('URL não pode conter credenciais ou parâmetros.');
    if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw TypeError('Provedores remotos exigem HTTPS.');
    providerConfigStore.upsert(config);return reply(response,200,{providers:providerConfigStore.list()});
   }
   const provider=path.match(/^\/api\/settings\/providers\/([^/]+)(?:\/(secret|test))?$/);
   if(provider) {
    const config=providerConfigStore.findByLabel(decodeURIComponent(provider[1]));if(!config)return reply(response,404,{error:'Provedor não encontrado.'});
    if(!provider[2]&&method==='DELETE'){providerConfigStore.remove(config.label);return reply(response,200,{providers:providerConfigStore.list()});}
    if(provider[2]==='secret'&&method==='POST'){if(typeof body.secret!=='string'||!body.secret.trim()||body.secret.length>8000)throw TypeError('Chave inválida.');await credentialManager.set(config.credentialReference,body.secret);return reply(response,200,{saved:true});}
    if(provider[2]==='test'&&method==='POST') {
     if(pending.has(config.label))return reply(response,409,{error:'Teste em andamento.'});pending.add(config.label);
     try {
      const secret=await credentialManager.get(config.credentialReference);if(!secret)return reply(response,409,{error:'Salve uma chave no cofre primeiro.'});
      const remote=await fetchImpl(config.baseUrl+'/models',{redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+secret}});
      if(!remote.ok){await remote.body?.cancel();return reply(response,502,{error:'O endpoint de modelos retornou HTTP '+remote.status+'.'});}
      const content=await readBounded(remote);const data=JSON.parse(content);
      if(!Array.isArray(data.data))throw TypeError('O provedor não retornou um catálogo de modelos.');
      return reply(response,200,{connected:true,modelAvailable:data.data.some(m=>m.id===config.model),modelCount:data.data.length,checkedAt:new Date().toISOString()});
     }finally{pending.delete(config.label);}
    }
   }
   if(path==='/api/settings/memory') {
    if(method==='GET')return reply(response,200,{memories:store.listMemory()});
    if(method==='PUT')return reply(response,200,{memories:store.saveMemory(body)});
    if(method==='DELETE'){if(typeof body.id!=='string')throw TypeError('Memória inválida.');store.removeMemory(body.id);return reply(response,200,{memories:store.listMemory()});}
   }
   if(path==='/api/settings/mcp') {
    if(method==='GET')return reply(response,200,{servers:store.listMcp()});
    if(method==='PUT'){return reply(response,200,{server:store.saveMcp(body)});}
    if(method==='DELETE'){store.removeMcp(body.id);return reply(response,200,{servers:store.listMcp()});}
   }
   if(path==='/api/settings/mcp-audit'&&method==='GET')return reply(response,200,{calls:database.prepare('SELECT id,server_name AS serverName,tool,status,started_at AS startedAt,finished_at AS finishedAt FROM settings_mcp_calls ORDER BY started_at DESC LIMIT 100').all()});
   const mcp=path.match(/^\/api\/settings\/mcp\/([-\w]+)\/(discover|call|secret)$/);
   if(mcp&&method==='POST') {
    const config=store.listMcp().find(s=>s.id===mcp[1]);if(!config)return reply(response,404,{error:'Servidor não encontrado.'});
    const reference='local-agent-orchestrator/mcp-'+config.id;
    if(mcp[2]==='secret'){if(typeof body.secret!=='string'||!body.secret.trim()||body.secret.length>8000)throw TypeError('Token inválido.');await credentialManager.set(reference,body.secret);return reply(response,200,{saved:true});}
    if(mcp[2]==='call'&&body.approved!==true)return reply(response,403,{error:'Aprove explicitamente esta chamada.'});
    if(pending.has('mcp:'+config.id))return reply(response,409,{error:'Uma operação deste servidor já está em andamento.'});
    pending.add('mcp:'+config.id);let client;let callId=null;let output;
    try {
     client=await connectMcp(config,{fetchImpl,secret:await credentialManager.get(reference)});
     if(!isAuthorized())return reply(response,401,{error:'Sessão encerrada.'});
     if(mcp[2]==='discover')output={tools:client.tools,checkedAt:new Date().toISOString()};
     else {
      if(!body.arguments||typeof body.arguments!=='object'||Array.isArray(body.arguments))throw TypeError('Argumentos devem ser um objeto JSON.');
      if(typeof body.name!=='string'||!client.tools.some(tool=>tool.name===body.name))throw TypeError('Ferramenta não encontrada no catálogo atual.');
      callId=randomUUID();database.prepare('INSERT INTO settings_mcp_calls VALUES (?,?,?,?,?,?,NULL)').run(callId,config.id,config.name,body.name,'running',new Date().toISOString());
      const result=await client.call(body.name,body.arguments);
      database.prepare('UPDATE settings_mcp_calls SET status=?,finished_at=? WHERE id=?').run(result?.isError?'failed':'completed',new Date().toISOString(),callId);
      output={result,callId};
     }
    }catch(error){if(callId)database.prepare('UPDATE settings_mcp_calls SET status=?,finished_at=? WHERE id=?').run('failed',new Date().toISOString(),callId);throw error;}
    finally{await client?.close();pending.delete('mcp:'+config.id);}
    if(!isAuthorized())return reply(response,401,{error:'Sessão encerrada. A chamada permanece no histórico.'});
    return reply(response,200,output);
   }
   if(path==='/api/settings/system'&&method==='GET') {
    const counts={};for(const table of ['agents','teams','task_runs','conversation_messages','settings_memory','settings_mcp'])counts[table]=database.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
    const pages=database.prepare('PRAGMA page_count').get().page_count;const size=database.prepare('PRAGMA page_size').get().page_size;
    return reply(response,200,{version:'0.1.0',node:process.version,platform:process.platform,uptimeSeconds:Math.floor(process.uptime()),databaseBytes:pages*size,counts,integrity:database.prepare('PRAGMA quick_check').get().quick_check,checkedAt:new Date().toISOString()});
   }
   if(path==='/api/settings/export'&&method==='GET') {
    // Consistent read snapshot; never serialize profile verifiers or credential references.
    database.exec('BEGIN');try {
     const conversations=database.prepare('SELECT id,agent_id AS agentId,team_id AS teamId,title,created_at AS createdAt FROM conversations').all().map(c=>({...c,messages:database.prepare('SELECT agent_id AS agentId,author_name AS authorName,content,created_at AS createdAt FROM conversation_messages WHERE conversation_id=? ORDER BY ordinal').all(c.id)}));
     const missions=repository.list().map(m=>repository.findById(m.id));
     return reply(response,200,{format:'hane-history',version:1,exportedAt:new Date().toISOString(),missions,conversations,memories:store.listMemory(),servers:store.listMcp(),mcpCalls:database.prepare('SELECT server_name AS serverName,tool,status,started_at AS startedAt,finished_at AS finishedAt FROM settings_mcp_calls ORDER BY started_at').all(),providers:providerConfigStore.list().map(({credentialReference,...p})=>p)});
    }finally{database.exec('COMMIT');}
   }
   return reply(response,404,{error:'Configuração não encontrada.'});
  }catch(error){return reply(response,error instanceof TypeError||error instanceof SyntaxError?400:502,{error:error instanceof SyntaxError?'Resposta JSON inválida.':error instanceof TypeError?error.message:'Não foi possível concluir a operação. Verifique a conexão e a disponibilidade do serviço.'});}
 };
}
async function readBounded(response) {const reader=response.body.getReader();const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw TypeError('Catálogo excede 1 MB.');chunks.push(value);}return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});}}
