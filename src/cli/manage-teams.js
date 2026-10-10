import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defaultDatabasePath } from '../storage/sqlite-database.js';
import { SqliteAgentStore } from '../storage/sqlite-agent-store.js';
import { SqliteTeamStore } from '../storage/sqlite-team-store.js';
import { assertId, TeamError } from '../teams/domain.js';
export async function manageTeamsCommand({kind,args,stdout,dependencies}) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    db:{type:'string'},json:{type:'boolean'},name:{type:'string'},description:{type:'string'},
    instructions:{type:'string'},provider:{type:'string'},exclusive:{type:'boolean'},member:{type:'string',multiple:true},
  }});
  const filename=values.db??defaultDatabasePath();
  if(values.db)mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  const database=dependencies.openDatabase(filename);
  try {
    const agents=new SqliteAgentStore({database}),teams=new SqliteTeamStore({database}),store=kind==='agent'?agents:teams;
    const [action,idOrAction,memberOrId,extra]=positionals;
    let result;
    if(action==='list') result=kind==='agent'?store.list().map(({instructions,...metadata})=>metadata):store.list();
    else if(action==='add') {
      const candidate={id:randomUUID(),name:values.name,description:values.description??''};
      result=kind==='agent'?agents.upsert({...candidate,instructions:values.instructions??'',providerLabel:values.provider??null,exclusive:values.exclusive??false}):teams.save({...candidate,members:values.member??[]});
    } else if(action==='member'&&kind==='team') {
      if(!['add','remove'].includes(idOrAction))throw new TeamError(400,'Use team member add|remove <team-id> <agent-id>.');
      result=teams.setMember(assertId(memberOrId),assertId(extra),idOrAction==='add');
    } else if(action==='leader'&&kind==='team') {
      if(idOrAction!=='set')throw new TeamError(400,'Use team leader set <team-id> <agent-id|none>.');
      result=teams.setLeader(assertId(memberOrId),extra==='none'?null:assertId(extra));
    } else {
      const id=assertId(idOrAction);
      if(!store.get(id))throw new TeamError(404,'Unknown '+kind+'.');
      if(action==='show')result=store.get(id);
      else if(action==='remove')result={removed:store.remove(id)};
      else if(action==='archive'&&kind==='team')result=teams.archive(id);
      else throw new TeamError(400,'Unknown '+kind+' command.');
    }
    stdout.write(JSON.stringify(result,null,values.json?0:2)+'\n');return 0;
  } finally { database.close(); }
}
