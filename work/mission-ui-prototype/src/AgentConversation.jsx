import { useEffect, useRef, useState } from 'react';
import { Plus, PaperPlaneRight, GearSix } from '@phosphor-icons/react';
import { HaneAvatar } from './HaneAvatar.jsx';
import { libraryRequest } from './library-api.js';
export default function AgentConversation({agent,group,library,providers,onEditAgent,onEditGroup,personalProfile,serverWorkspace}) {
 const participants=group?library.agents.filter(a=>group.members.includes(a.id)):[agent];
 const [conversations,setConversations]=useState([]),[selected,setSelected]=useState(null),[conversation,setConversation]=useState(null);
 const [draft,setDraft]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false),[recipient,setRecipient]=useState('');
 const [provider,setProvider]=useState(''),[grants,setGrants]=useState([]),[sandbox,setSandbox]=useState('workspace'),[maxCalls,setMaxCalls]=useState('');
 const messagesRef=useRef(null),busy=conversation?.turns.some(t=>t.status==='running');
 const title=group?.name||agent?.name||'Conversa';
 useEffect(()=>{let alive=true;libraryRequest('conversations').then(data=>{if(!alive)return;const items=data.conversations.filter(c=>group?c.teamId===group.id:c.agentId===agent.id);setConversations(items);setSelected(items[0]?.id||null);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[group?.id,agent?.id]);
 useEffect(()=>{
  if(!selected){setConversation(null);return;}
  let alive=true,timer;
  const poll=()=>libraryRequest('conversations/'+selected).then(data=>{if(alive){setConversation(data);if(data.turns.some(t=>t.status==='running'))timer=setTimeout(poll,750);}}).catch(e=>{if(alive)setError(e.message);});
  poll();return()=>{alive=false;clearTimeout(timer);};
 },[selected,sending]);
 useEffect(()=>{messagesRef.current?.scrollTo({top:messagesRef.current.scrollHeight,behavior:'auto'});},[conversation?.messages.length]);
 async function send(e){
  e.preventDefault();if(sending||busy||!draft.trim())return;setSending(true);setError('');
  try {
   let id=selected;
   if(!id){const created=await libraryRequest('conversations','POST',{...(group?{teamId:group.id}:{agentId:agent.id}),title:draft.trim().slice(0,120)});id=created.id;setSelected(id);setConversations(items=>[created,...items]);}
   await libraryRequest('conversations/'+id+'/messages','POST',{content:draft,recipientId:recipient||null,providerLabel:provider||null,capabilities:grants,sandbox,...(maxCalls?{maxProviderCalls:maxCalls}:{})});
   setDraft('');setGrants([]);setConversation(await libraryRequest('conversations/'+id));
  }catch(e){setError(e.message);}finally{setSending(false);}
 }
 function grant(name,enabled){setGrants(items=>enabled?[...items,{name,scope:name==='process.run'?'python':'.'}]:items.filter(g=>g.name!==name));}
 const available=['workspace.read',...(sandbox==='box'?['workspace.write','process.run']:[])].filter(name=>participants.some(a=>a.capabilities?.includes(name)));
 const lastTurn=conversation?.turns.at(-1);
 return <section className="conversation-view agent-conversation">
  <header className="conversation-header">{agent&&<HaneAvatar agentId={agent.id} name={agent.name} color={agent.color} shape={agent.shape} image={agent.image} size={38} interactive onClick={()=>onEditAgent(agent.id)}/>}
   <span className="conversation-title"><strong>{title}</strong><small>{group?participants.length+' integrantes · '+(group.leader?'liderança explícita':'coordenação entre participantes'):'Conversa individual'}</small></span>
   <button className="icon-button" aria-label="Configurar conversa" onClick={()=>group?onEditGroup():onEditAgent(agent.id)}><GearSix/></button>
   <button className="icon-button" aria-label="Nova conversa" disabled={busy||sending} onClick={()=>{setSelected(null);setConversation(null);setError('');}}><Plus/></button>
  </header>
  {conversations.length>0&&<label className="chat-history-picker">Histórico <select aria-label="Selecionar conversa" disabled={busy||sending} value={selected||''} onChange={e=>{setSelected(e.target.value||null);setError('');}}><option value="">Nova conversa</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
  <div className="messages" ref={messagesRef}>
   {group&&<div className="group-context">{participants.map(a=><button key={a.id} type="button" onClick={()=>onEditAgent(a.id)}><HaneAvatar agentId={a.id} name={a.name} color={a.color} shape={a.shape} image={a.image} size={28}/>{a.name}{group.leader===a.id?' · líder':''}</button>)}<small>Sem destinatário, todos respondem e coordenam a mensagem entre si.</small></div>}
   {!conversation?.messages.length&&<div className="empty-stage"><strong>{group?'Converse com seu grupo':'Converse com '+title}</strong><p>As mensagens ficam nesta conversa, no SQLite local.</p></div>}
   {conversation?.messages.map(msg=>{
    const author=library.agents.find(a=>a.id===msg.agentId);
    return msg.agentId?<article className="message" key={msg.id}><HaneAvatar agentId={msg.agentId} name={author?.name||msg.authorName} color={author?.color} shape={author?.shape} image={author?.image} size={38} interactive onClick={()=>onEditAgent(msg.agentId)}/><div className="message-content"><header><strong>{author?.name||msg.authorName}</strong><small>{new Date(msg.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></header><p className="output-text">{msg.content}</p></div></article>:<div className="user-message" key={msg.id}><small>{personalProfile?.displayName||'Você'}</small><p>{msg.content}</p></div>;
   })}
   {busy&&<p role="status">Os participantes estão respondendo… {lastTurn?.providerCalls||0}/{lastTurn?.maxProviderCalls} chamadas <button type="button" onClick={()=>libraryRequest('conversations/'+selected+'/cancel','POST',{}).catch(e=>setError(e.message))}>Cancelar</button></p>}
   {conversation?.turns.filter(t=>t.status!=='completed'&&t.status!=='running').map(t=><p className="composer-error" role="alert" key={t.id}>{t.error||t.status} · {t.providerCalls} chamadas registradas</p>)}
   {lastTurn&&<details className="chat-audit"><summary>Auditoria desta rodada · {lastTurn.providerCalls} chamadas · {lastTurn.toolCalls} ferramentas</summary>{lastTurn.audit.map((entry,i)=><p key={i}>{entry.type} · {library.agents.find(a=>a.id===entry.detail.agentId)?.name||''} {entry.detail.tool||''} {entry.detail.path||''} {entry.detail.reason||''}</p>)}</details>}
   {error&&<p className="composer-error" role="alert">{error}</p>}
  </div>
  <form className="composer-form" onSubmit={send}>
   <div className="chat-controls">{group&&<label>Destinatário <select aria-label="Destinatário da mensagem" value={recipient} disabled={busy||sending} onChange={e=>setRecipient(e.target.value)}><option value="">Todos os integrantes</option>{participants.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    <label>Provedor <select value={provider} disabled={busy||sending} onChange={e=>setProvider(e.target.value)}><option value="">Padrão do agente/servidor</option>{providers.map(p=><option key={p.label} value={p.label}>{p.label}</option>)}</select></label>
    <label>Orçamento de chamadas <input type="number" min={recipient||!group?1:participants.length} max={64} value={maxCalls} disabled={busy||sending} onChange={e=>setMaxCalls(e.target.value===''?'':Number(e.target.value))} placeholder="Opcional · padrão do servidor"/><small>Opcional; em branco o servidor aplica seu default e teto.</small></label>
   </div>
   <details className="chat-permissions"><summary>Permissões deste envio · {grants.length} autorizadas</summary><p>As instruções não habilitam ferramentas. Cada operação respeita as capacidades do agente e os escopos abaixo.</p>
    <label>Ambiente <select value={sandbox} disabled={busy||sending} onChange={e=>{setSandbox(e.target.value);setGrants([]);}}><option value="workspace">Pasta autorizada do servidor · somente leitura</option><option value="box">Caixa Linux Hane · usuário haneagent</option></select></label>
    {sandbox==='workspace'&&!serverWorkspace.available&&<p>Nenhuma pasta foi autorizada no servidor.</p>}
    {available.map(name=><label key={name}><input type="checkbox" disabled={busy||sending||(sandbox==='workspace'&&!serverWorkspace.available)} checked={grants.some(g=>g.name===name)} onChange={e=>grant(name,e.target.checked)}/>{name}{grants.some(g=>g.name===name)&&<input aria-label={'Escopo de '+name} value={grants.find(g=>g.name===name).scope} disabled={busy||sending} onChange={e=>setGrants(items=>items.map(g=>g.name===name?{...g,scope:e.target.value}:g))}/>}</label>)}
    <p>A caixa precisa estar instalada. Falhas de ferramentas são registradas; acesso à rede ainda não está disponível.</p>
   </details>
   <div className="composer"><textarea aria-label="Mensagem" value={draft} disabled={sending} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form.requestSubmit();}}} maxLength={12000} placeholder={group?'Envie uma mensagem ao grupo…':'Mensagem para '+title+'…'}/><div><small>{busy?'Aguarde a rodada atual':'Ctrl + Enter para enviar'}</small><button className="send-button" aria-label="Enviar mensagem" disabled={sending||busy||!draft.trim()||group?.archivedAt}><PaperPlaneRight weight="fill"/></button></div></div>
  </form>
 </section>;
}
