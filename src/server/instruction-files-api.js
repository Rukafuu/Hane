import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { TeamError, assertObject, text } from '../teams/domain.js';
export function extractInstructionFile({name,data}) {
 name=text(name,'file name',120,1);
 if(typeof data!=='string'||data.length>7000000||!data.length||!/^[a-z0-9+/=]+$/i.test(data))throw new TeamError(400,'Document must be a base64 file up to 5 MB.');
 const bytes=Buffer.from(data,'base64');if(bytes.length>5*1024*1024)throw new TeamError(413,'Document exceeds 5 MB.');
 if(!/\.(txt|md|pdf|docx)$/i.test(name))throw new TeamError(400,'Use TXT, Markdown, PDF or DOCX.');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../teams/instruction-parser-worker.js',import.meta.url),{workerData:{name,data},resourceLimits:{maxOldGenerationSizeMb:128}});
  let done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();error?reject(new TeamError(400,error)):resolve({id:randomUUID(),name,text:result});};
  const timer=setTimeout(()=>finish('Document processing timed out.'),10000);
  worker.once('message',r=>finish(r.error,r.text));worker.once('error',()=>finish('Document could not be processed.'));worker.once('exit',code=>{if(!done)finish('Document parser stopped.');});
 });
}
export async function handleInstructionFile({request,response,isAuthorized,readJsonBody,respondJson}) {
 if(new URL(request.url,'http://127.0.0.1').pathname!=='/api/instructions/extract')return false;
 const reply=(status,data)=>{respondJson(response,status,data);return true;};
 if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
 if(!isAuthorized())return reply(401,{error:'Local session is locked.'});
 try{const body=await readJsonBody(request,7*1024*1024);assertObject(body);const result=await extractInstructionFile(body);if(!isAuthorized())return reply(401,{error:'Local session is locked.'});return reply(200,result);}
 catch(e){return reply(e.status||400,{error:e.message});}
}
