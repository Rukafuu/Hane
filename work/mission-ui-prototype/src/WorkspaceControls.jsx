import {useEffect,useRef,useState} from 'react';
import {Check,FolderOpen,GearSix,Plugs,Plus,X} from '@phosphor-icons/react';
import {HaneAvatar} from './HaneAvatar.jsx';
import {reduceMotion} from './motion.js';
function useDialog(close) {
 const root=useRef(null);
 useEffect(()=>{const previous=document.activeElement;root.current?.querySelector('input,button')?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
 function keys(e){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const items=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}}
 return {ref:root,onKeyDown:keys};
}
export function TeamEditor({team,library,busy,onSave,onClose,onChoose}) {
 const [name,setName]=useState(team?.name||''),[members,setMembers]=useState(team?.members||[]),[error,setError]=useState(''),[creating,setCreating]=useState(Boolean(team));
 const dialog=useDialog(()=>{if(!busy)onClose();});
 const existing=team?.members||[];
 const candidates=library.agents.filter(a=>existing.includes(a.id)||!a.exclusive||!a.groupId||a.groupId===team?.id);
 const unchanged=team&&name.trim()===team.name&&members.length===existing.length;
 async function save(e){e.preventDefault();if(busy||!members.length||members.length>8)return;setError('');try{await onSave({...team,id:team?.id||crypto.randomUUID(),name:name.trim(),description:team?.description||'',color:team?.color||'#ed799a',leader:team?.leader||'',runs:team?.runs||[],members});onClose();}catch(e){setError(e.message);}}
 return <div className="workspace-dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}><section {...dialog} className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="team-dialog-title">
 <header><span><small>QUEM PENSA JUNTO COM VOCÊ</small><h2 id="team-dialog-title">{team?'Seu Team, do seu jeito.':creating?'Vamos reunir um Team.':'Escolha seu Team.'}</h2></span><button type="button" aria-label="Fechar editor de Team" disabled={busy} onClick={onClose}><X/></button></header>
 {!creating?<><div className="team-choices">{library.groups.filter(g=>!g.archivedAt).map(g=><button key={g.id} type="button" onClick={()=>onChoose(g.id)}><span className="group-dot" style={{background:g.color}}/><span><strong>{g.name}</strong><small>{g.members.length}/8 integrantes</small></span></button>)}</div><button type="button" className="team-create-action" onClick={()=>setCreating(true)}><Plus/> Criar um Team</button></>:<form onSubmit={save}>
 <label className="team-name">Nome do Team<input required minLength={2} maxLength={80} value={name} disabled={busy||Boolean(team?.archivedAt)} onChange={e=>setName(e.target.value)} placeholder="Um nome para as suas próximas ideias"/></label>
 <div className="team-member-heading"><strong>Integrantes</strong><span>{members.length}/8</span></div><p>{team?'Os integrantes atuais ficam. Você pode convidar mais agentes até completar oito.':'Escolha de um a oito agentes que já existem no seu Hane.'}</p>
 <div className="team-member-list">{candidates.map(a=><label key={a.id}><input type="checkbox" aria-label={'Incluir '+a.name+' no Team'} checked={members.includes(a.id)} disabled={busy||Boolean(team?.archivedAt)||existing.includes(a.id)||(!members.includes(a.id)&&members.length>=8)} onChange={e=>setMembers(v=>e.target.checked?[...v,a.id]:v.filter(id=>id!==a.id))}/><HaneAvatar name={a.name} shape={a.shape} color={a.color} image={a.image} size={36} decorative reducedMotion={reduceMotion()}/><span><strong>{a.name}</strong><small>{existing.includes(a.id)?'Já faz parte deste Team':a.description||'Pronto para pensar junto'}</small></span>{members.includes(a.id)&&<Check/>}</label>)}</div>
 {!candidates.length&&<p>Crie um agente na biblioteca para começar seu Team.</p>}{team?.archivedAt&&<p>Este Team está arquivado.</p>}{error&&<p role="alert" className="composer-error">{error}</p>}
 <footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={busy||Boolean(team?.archivedAt)||name.trim().length<2||!members.length||Boolean(unchanged)}>{busy?'Salvando…':team?'Salvar Team':'Criar Team'}</button></footer></form>}
 </section></div>;
}
export function ProviderPicker({providers,selected,onChoose,onManage,onClose}) {
 const dialog=useDialog(onClose);
 return <div className="workspace-dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section {...dialog} className="workspace-dialog provider-picker" role="dialog" aria-modal="true" aria-labelledby="provider-picker-title"><header><span><small>INTELIGÊNCIA PARA PENSAR JUNTO</small><h2 id="provider-picker-title">Escolha um provedor.</h2></span><button type="button" aria-label="Fechar escolha de provedor" onClick={onClose}><X/></button></header><p>A escolha vale para os próximos envios. Cada agente mantém sua conexão própria quando você usa o padrão.</p>
 <div className="provider-options"><button type="button" aria-pressed={!selected} onClick={()=>onChoose(null)}><Plugs/><span><strong>Usar o padrão</strong><small>Conexão do agente ou do servidor</small></span>{!selected&&<Check/>}</button>{providers.map(p=><button type="button" key={p.label} aria-pressed={selected===p.label} onClick={()=>onChoose(p.label)}><Plugs/><span><strong>{p.label}</strong><small>{p.model}</small></span>{selected===p.label&&<Check/>}</button>)}</div>
 {!providers.length&&<p>Seu Hane ainda não tem uma conexão de IA. Adicione a primeira para começar a conversar.</p>}<button type="button" className="provider-manage" onClick={onManage}><GearSix/> Adicionar ou gerenciar provedores</button></section></div>;
}
export function WorkspaceFolder({workspace,attachments,onChoose,onManage,busy}) {
 const root=workspace.root;const name=root?.split(/[\\/]/).filter(Boolean).at(-1)||root;
 return <section className="workspace-folder" aria-label="Pasta da próxima execução"><FolderOpen/><span><strong>{root?name:'Escolha uma pasta para o Team'}</strong><small title={root||undefined}>{root||'Um lugar para os arquivos da próxima execução.'}</small>{root&&<small>{attachments.filter(a=>a.path).length} anexos de disco · acesso somente com permissões de envio</small>}</span><button type="button" disabled={busy} onClick={onChoose}>{root?'Anexar':'Escolher pasta'}</button>{root&&<button type="button" aria-label="Configurar pasta do workspace" title="Configurar pasta do workspace" disabled={busy} onClick={onManage}><GearSix/></button>}</section>;
}
