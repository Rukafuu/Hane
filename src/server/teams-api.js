import { randomUUID } from 'node:crypto';
import { assertId, assertObject, TeamError } from '../teams/domain.js';
// Mounted after the unconditional browser guard; all reads and writes require a local session when protected.
export function createTeamsApi({ agentStore, teamStore, readJsonBody, respondJson }) {
  return async function handle({ request, response, isAuthorized }) {
    const pathname = new URL(request.url,'http://127.0.0.1').pathname;
    const match = pathname.match(/^\/api\/(agents|teams)(?:\/([^/]+))?(?:\/(members|leader|executions|archive)(?:\/([^/]+))?)?$/);
    if (!match) return false;
    const reply = (status,payload) => { respondJson(response,status,payload); return true; };
    if (!isAuthorized()) return reply(401,{error:'Seu Hane está bloqueado.'});
    if (!agentStore || !teamStore) return reply(503,{error:'Teams storage is unavailable.'});
    const [,kind,id,action,memberId] = match, method=request.method, store=kind==='agents'?agentStore:teamStore;
    try {
      if (id) assertId(id);
      if (memberId) assertId(memberId,'member');
      if (!id && method==='GET') {
        const items=store.list();
        return reply(200,{[kind]:kind==='agents'?items.map(({instructions,...metadata})=>metadata):items});
      }
      if (!id && method==='POST') {
        const body=await readJsonBody(request); assertObject(body);
        if (!isAuthorized()) return reply(401,{error:'Seu Hane está bloqueado.'});
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
          if (!isAuthorized()) return reply(401,{error:'Seu Hane está bloqueado.'});
          return reply(200,teamStore.setLeader(id,body.leaderAgentId));
        }
        return reply(405,{error:'Method not allowed.'});
      }
      if (method==='GET') return reply(200,existing);
      if (method==='DELETE') { store.remove(id); return reply(200,{removed:true}); }
      if (method==='PUT') {
        const body=await readJsonBody(request); assertObject(body);
        if (!Object.keys(body).length) throw new TeamError(400,'An update must contain fields.');
        if (!isAuthorized()) return reply(401,{error:'Seu Hane está bloqueado.'});
        const candidate={...existing,...body,id};
        return reply(200,kind==='agents'?store.upsert(candidate):store.save(candidate));
      }
      return reply(405,{error:'Method not allowed.'});
    } catch (error) {
      if (error instanceof TeamError) return reply(error.status,{error:error.message});
      if (error instanceof SyntaxError || error.message?.startsWith('Request body')) return reply(400,{error:error.message});
      throw error;
    }
  };
}
