import { processAvatar } from '../profile/avatar.js';
import { decodeAvatarDataUrl } from '../image-data-url.js';
import { ProfileError } from '../profile/local-auth.js';
import { importLibrary } from '../teams/import-library.js';
import { createHash, randomUUID } from 'node:crypto';
import { assertId, assertObject, TeamError } from '../teams/domain.js';
// Mounted after the unconditional browser guard; all reads and writes require a local session when protected.
export function createTeamsApi({ agentStore, teamStore, readJsonBody, respondJson }) {
  return async function handle({ request, response, isAuthorized }) {
    const pathname = new URL(request.url,'http://127.0.0.1').pathname;
    const match = pathname.match(/^\/api\/(agents|teams)(?:\/([^/]+))?(?:\/(members|leader|executions|archive)(?:\/([^/]+))?)?$/);
    const importing = pathname === '/api/library/import';
    if (!match && !importing) return false;
    const reply = (status,payload) => { respondJson(response,status,payload); return true; };
    if (!isAuthorized()) return reply(401,{error:'Local session is locked.'});
    if (!agentStore || !teamStore) return reply(503,{error:'Teams storage is unavailable.'});
    const [,kind,id,action,memberId] = match || [], method=request.method, store=kind==='agents'?agentStore:teamStore;
    async function prepareAgent(body,existing=null) {
      if(body.visual?.image && body.visual.image!==existing?.visual?.image) {
        const source=decodeAvatarDataUrl(body.visual.image);
        if(!source)throw new TeamError(400,'Invalid avatar image.');
        const output=await processAvatar(source);
        body.visual={...body.visual,image:'data:image/webp;base64,'+output.toString('base64')};
      }
      if(!isAuthorized())throw new TeamError(401,'Local session is locked.');
      return {...body,isInitial:existing?.isInitial||false};
    }
    try {
      if (importing) {
        if (method !== 'POST') return reply(405,{error:'Method not allowed.'});
        const body = await readJsonBody(request, 4 * 1024 * 1024);assertObject(body);
        const digest=createHash('sha256').update(JSON.stringify({agents:body.agents,teams:body.teams})).digest('hex');
        if(Array.isArray(body.agents)){for(let i=0;i<body.agents.length;i++)if(body.agents[i]?.visual?.image)body.agents[i]=await prepareAgent(body.agents[i]);}
        if (!isAuthorized()) return reply(401,{error:'Local session is locked.'});
        return reply(200,importLibrary(teamStore.database,body,{digest}));
      }
      if (id) assertId(id);
      if (memberId) assertId(memberId,'member');
      if (!id && method==='GET') {
        const items=store.list();
        return reply(200,{[kind]:kind==='agents'?items.map(({instructions,...metadata})=>metadata):items});
      }
      if (!id && method==='POST') {
        let body=await readJsonBody(request,kind==='agents'?7*1024*1024:65536); assertObject(body);
        if(kind==='agents')body=await prepareAgent(body);
        if (!isAuthorized()) return reply(401,{error:'Local session is locked.'});
        const candidate={...body,id:randomUUID()};
        return reply(201,kind==='agents'?store.upsert(candidate):store.save(candidate));
      }
      if (!id) return reply(405,{error:'Method not allowed.'});
      const existing=store.get(id);
      if (!existing) return reply(404,{error:'Unknown '+kind.slice(0,-1)+'.'});
      if (action) {
        if (kind!=='teams') return reply(404,{error:'Unknown route.'});
        if (action==='executions' && method==='GET' && !memberId) return reply(200,{executions:teamStore.executions(id)});
        if (action==='archive' && method==='POST' && !memberId) return reply(200,teamStore.archive(id));
        if (action==='members' && memberId && method==='DELETE') return reply(200,teamStore.setMember(id,memberId,false));
        if (action==='members' && memberId && method==='PUT') return reply(200,teamStore.setMember(id,memberId,true));
        if (action==='leader' && !memberId && method==='PUT') {
          const body=await readJsonBody(request); assertObject(body);
          if (!Object.hasOwn(body,'leaderAgentId')) throw new TeamError(400,'leaderAgentId is required; null clears leadership.');
          if (!isAuthorized()) return reply(401,{error:'Local session is locked.'});
          return reply(200,teamStore.setLeader(id,body.leaderAgentId));
        }
        return reply(405,{error:'Method not allowed.'});
      }
      if (method==='GET') return reply(200,existing);
      if (method==='DELETE') { store.remove(id); return reply(200,{removed:true}); }
      if (method==='PUT') {
        const body=await readJsonBody(request,kind==='agents'?7*1024*1024:65536); assertObject(body);
        if (!Object.keys(body).length) throw new TeamError(400,'An update must contain fields.');
        if (!isAuthorized()) return reply(401,{error:'Local session is locked.'});
        const candidate=kind==='agents'?{...existing,...await prepareAgent(body,existing),id}:{...existing,...body,id};
        return reply(200,kind==='agents'?store.upsert(candidate):store.save(candidate));
      }
      return reply(405,{error:'Method not allowed.'});
    } catch (error) {
      if (error instanceof ProfileError || error instanceof TeamError) return reply(error.status,{error:error.message});
      if (error instanceof SyntaxError || error.message?.startsWith('Request body')) return reply(400,{error:error.message});
      throw error;
    }
  };
}
