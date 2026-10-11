// Explicit HTTP MCP 2025-11-25 transport. No process execution or implicit grants.
export async function connectMcp(config,{fetchImpl=fetch,secret=null}={}) {
 let session=null;let version='2025-11-25';let nextId=0;
 async function rpc(method,params,notify=false) {
  const id=notify?undefined:++nextId;
  const response=await fetchImpl(config.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',accept:'application/json, text/event-stream','MCP-Protocol-Version':version,...(session?{'Mcp-Session-Id':session}:{}),...(secret?{authorization:'Bearer '+secret}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notify?{}:{id}),method,...(params?{params}:{})})});
  if(!response.ok)throw new Error('MCP HTTP '+response.status);
  session=response.headers.get('mcp-session-id')||session;
  if(notify){await response.body?.cancel();return null;}
  const reader=response.body.getReader();const decoder=new TextDecoder();let input='';let bytes=0;
  try {while(true){const {done,value}=await reader.read();if(value){bytes+=value.length;if(bytes>1024*1024)throw Error('Resposta MCP excede 1 MB.');input+=decoder.decode(value,{stream:true});}
   if(response.headers.get('content-type')?.includes('text/event-stream')) {
    const frames=input.split(/\r?\n\r?\n/);input=frames.pop();
    for(const frame of frames){const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;const msg=JSON.parse(data);if(msg.id===id){if(msg.error)throw Error('MCP recusou a solicitação.');return msg.result;}}
   } else if(done){const msg=JSON.parse(input);if(msg.id!==id||msg.error)throw Error('Resposta MCP inválida ou recusada.');return msg.result;}
   if(done)throw Error('MCP encerrou sem resposta.');
  }} finally {await reader.cancel().catch(()=>{});}
 }
 const close=async()=>{if(session)await fetchImpl(config.url,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(3000),headers:{'Mcp-Session-Id':session,'MCP-Protocol-Version':version,...(secret?{authorization:'Bearer '+secret}:{})}}).catch(()=>{});};
 try {
 const init=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'Hane',version:'0.1.0'}});
 if(!['2025-03-26','2025-06-18','2025-11-25'].includes(init?.protocolVersion))throw Error('Versão MCP incompatível. Este conector usa o protocolo 2025.');
 version=init.protocolVersion;await rpc('notifications/initialized',null,true);
 if(!init.capabilities?.tools)throw Error('Este servidor não oferece ferramentas.');
 const tools=[];let cursor;
 for(let page=0;page<10;page++){const result=await rpc('tools/list',cursor?{cursor}:{});if(!Array.isArray(result?.tools))throw Error('Catálogo MCP inválido.');if(result.tools.some(t=>!t||typeof t.name!=='string'||!t.name||t.name.length>128||t.description!=null&&typeof t.description!=='string'||!t.inputSchema||t.inputSchema.type!=='object'))throw Error('Catálogo MCP contém uma ferramenta inválida.');tools.push(...result.tools);if(tools.length>200)throw Error('Limite de 200 ferramentas MCP.');cursor=result.nextCursor;if(!cursor)break;if(page===9)throw Error('Catálogo MCP excede o limite de páginas.');}
 return {tools,call:async(name,args)=>{if(!tools.some(t=>t.name===name))throw Error('Ferramenta desconhecida.');return rpc('tools/call',{name,arguments:args});},close};
 }catch(error){await close();throw error;}
}
