import {reduceMotion} from './motion.js';
import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Check, UploadSimple, FileText, X, Sparkle, ShieldCheck, Plugs, Plus} from '@phosphor-icons/react';
import {HaneAvatar} from './HaneAvatar.jsx';
import {libraryRequest} from './library-api.js';

const COLORS = [['#ed799a','Rosa'],['#a99add','Lilás'],['#83b6dd','Azul'],['#8dbc9e','Verde'],['#e6bf78','Mel'],['#e3987c','Pêssego']];
const SHAPES = [['pebble','Seixo'],['cloud','Nuvem'],['diamond','Cristal'],['triangle','Triângulo']];
const STARTERS = [
 {name:'Organizar',description:'Transformar ideias soltas em próximos passos.',instructions:'Ajude a organizar ideias, prioridades e próximos passos. Faça perguntas quando faltar contexto, proponha caminhos simples e mantenha as decisões com o usuário.'},
 {name:'Criar',description:'Explorar possibilidades e dar forma a ideias.',instructions:'Ajude a explorar e desenvolver ideias com curiosidade. Ofereça alternativas concretas, preserve a voz do usuário e refine a proposta a partir do seu feedback.'},
 {name:'Investigar',description:'Entender problemas e conectar evidências.',instructions:'Ajude a entender problemas com clareza. Separe fatos de hipóteses, explique o raciocínio e diga quando faltar evidência. Sugira formas de verificar as conclusões.'},
];
const CAPABILITIES = [
 ['workspace.read','Ler arquivos','Consultar arquivos que você anexar ou autorizar.'],
 ['workspace.write','Escrever arquivos','Alterar arquivos dentro da caixa Linux autorizada.'],
 ['process.run','Executar código','Rodar comandos dentro da caixa Linux autorizada.'],
];
function readDataUrl(file) {
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler esse arquivo. Tente novamente.'));reader.onabort=()=>reject(new Error('Leitura cancelada.'));reader.readAsDataURL(file);});
}

export default function AgentEditor({draft, onChange, onSave, onCancel, existing, providers, busy, error, confirmDiscard}) {
 const studioRoot=useRef(null), nameInput=useRef(null), alive=useRef(true), initial=useRef(JSON.stringify(draft));
 const [fileBusy,setFileBusy]=useState(''),[fileError,setFileError]=useState('');
 useEffect(()=>{alive.current=true;studioRoot.current?.scrollIntoView({block:'start',behavior:'instant'});nameInput.current?.focus({preventScroll:true});return()=>{alive.current=false;};},[]);
 const patch=values=>onChange(current=>({...current,...values}));
 const dirty=JSON.stringify(draft)!==initial.current;
 const unavailableProvider=draft.provider && !providers.some(p=>p.label===draft.provider);
 function cancel() { if(confirmDiscard && dirty && !window.confirm('Descartar as mudanças deste agente?'))return;onCancel(); }
 async function avatar(file) {
  if(!file||fileBusy)return;setFileError('');setFileBusy('avatar');
  try {
   if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('Escolha PNG, JPEG, WebP ou GIF.');
   if(file.size>5*1024*1024)throw new Error('Escolha uma imagem de até 5 MB.');
   const image=await readDataUrl(file);if(alive.current)patch({image});
  } catch(e){if(alive.current)setFileError(e.message);}finally{if(alive.current)setFileBusy('');}
 }
 async function reference(file) {
  if(!file||fileBusy)return;setFileError('');setFileBusy('reference');
  try {
   if(file.size>5*1024*1024)throw new Error('Use um documento de até 5 MB.');
   const data=(await readDataUrl(file)).split(',')[1];
   const document=await libraryRequest('instructions/extract','POST',{name:file.name,data});
   if((draft.instructionFiles||[]).reduce((n,d)=>n+d.text.length,document.text.length)>24000)throw new Error('As referências juntas podem ter até 24.000 caracteres. Remova ou reduza um documento.');
   if(alive.current)onChange(current=>({...current,instructionFiles:[...(current.instructionFiles||[]),document]}));
  }catch(e){if(alive.current)setFileError(e.message);}finally{if(alive.current)setFileBusy('');}
 }
 return <form ref={studioRoot} className="agent-studio" onSubmit={e=>{e.preventDefault();if(fileBusy||busy)return;const docs=draft.instructionFiles||[];if(docs.some(d=>!d.text.trim())){setFileError('Uma referência está vazia. Preencha o texto ou remova o documento.');return;}if(docs.reduce((n,d)=>n+d.text.length,0)>24000){setFileError('As referências juntas podem ter até 24.000 caracteres.');return;}setFileError('');onSave();}} aria-label={existing?'Editar agente':'Criar agente'}>
  <button type="button" className="studio-back" disabled={busy||Boolean(fileBusy)} onClick={cancel}><ArrowLeft/> Voltar à biblioteca</button>
  <header className="studio-heading"><span>UM NOVO JEITO DE PENSAR JUNTO</span><h2>{existing?'Um pouco mais do seu jeito.':'Dê vida ao seu próximo agente.'}</h2><p>Um nome, um jeito próprio e espaço para crescer. Você pode ajustar tudo depois.</p></header>
  <fieldset className="studio-layout" disabled={busy||Boolean(fileBusy)}><legend className="sr-only">Personalizar agente</legend>
   <aside className="studio-persona" aria-label="Prévia do agente" style={{'--persona-color':draft.color}}>
    <div className="studio-avatar"><HaneAvatar reducedMotion={reduceMotion()} agentId={draft.id} name={draft.name||'Seu agente'} shape={draft.shape} color={draft.color} image={draft.image} size={110} interactive/></div>
    <strong>{draft.name.trim()||'Ainda sem nome'}</strong><p>{draft.description.trim()||'Um lugar para a sua próxima ideia.'}</p>
    <span className="studio-preview-note">A prévia muda com você.</span>
    <fieldset className="studio-shapes"><legend>Um formato seu</legend>{SHAPES.map(([shape,label])=><button type="button" key={shape} aria-label={'Formato '+label} aria-pressed={draft.shape===shape} onClick={()=>patch({shape,image:null})}><HaneAvatar reducedMotion={reduceMotion()} name={label} shape={shape} color={draft.color} size={30} decorative/><small>{label}</small></button>)}</fieldset>
    <fieldset className="studio-colors"><legend>Seu tom</legend><div>{COLORS.map(([color,label])=><button type="button" key={color} aria-label={'Avatar '+label} aria-pressed={draft.color===color} style={{background:color}} onClick={()=>patch({color})}>{draft.color===color&&<Check/>}</button>)}<label className="studio-custom-color" title="Escolher outra cor"><input type="color" aria-label="Cor personalizada do avatar" value={draft.color} onChange={e=>patch({color:e.target.value})}/><Plus/></label></div></fieldset>
    <label className="studio-upload"><UploadSimple/> {draft.image?'Trocar imagem ou GIF':'Usar imagem ou GIF'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Imagem ou GIF do agente" onChange={e=>{avatar(e.target.files?.[0]);e.target.value='';}}/></label><small>PNG, JPEG, WebP ou GIF · até 5 MB</small>
    {draft.image&&<button type="button" className="studio-quiet" onClick={()=>patch({image:null})}>Voltar ao avatar Hane</button>}
   </aside>
   <div className="studio-fields">
    <label className="studio-field">Como ele se chama?<input ref={nameInput} required minLength={2} maxLength={80} value={draft.name} placeholder="Por exemplo, Luma" onChange={e=>patch({name:e.target.value})}/><small>O único campo obrigatório. De 2 a 80 caracteres.</small></label>
    <label className="studio-field">Em que ele vai ajudar?<span className="studio-optional">opcional</span><textarea className="studio-purpose" maxLength={1000} value={draft.description} placeholder="Me ajudar a tirar ideias do papel, com calma e criatividade." onChange={e=>patch({description:e.target.value})}/></label>
    <label className="studio-field">Qual é o jeito dele?<span className="studio-optional">opcional</span><textarea aria-describedby="agent-behavior-hint" maxLength={12000} value={draft.instructions} placeholder="Como ele pensa, conversa e trabalha com você? Vale pedir curiosidade, respostas diretas ou atenção aos detalhes." onChange={e=>patch({instructions:e.target.value})}/><small id="agent-behavior-hint">Essas orientações acompanham as conversas individuais e em grupo.</small></label>
    {!draft.instructions && <div className="studio-starters"><span><Sparkle/> Quer um ponto de partida?</span><div>{STARTERS.map(starter=><button type="button" key={starter.name} title={starter.description} onClick={()=>patch({instructions:starter.instructions,...(!draft.description.trim()?{description:starter.description}:{})})}>{starter.name}<ArrowRight/></button>)}</div><small>São sugestões editáveis. O jeito final é seu.</small></div>}
    <details className="studio-extra"><summary><Plugs/><span>Modelo e referências<small>Escolha uma conexão ou acrescente material de apoio.</small></span></summary><div>
     <label className="studio-field">Provedor do agente<select value={draft.provider} onChange={e=>patch({provider:e.target.value})}><option value="">Usar o padrão do servidor</option>{unavailableProvider&&<option value={draft.provider}>{draft.provider} · indisponível</option>}{providers.map(p=><option key={p.label} value={p.label}>{p.label} · {p.model}</option>)}</select></label>
     {!providers.length&&<p>Você pode criar o agente agora e conectar um provedor em “Modelos e provedores” depois.</p>}{unavailableProvider&&<p role="status">A conexão anterior não está disponível. Escolha outra antes de salvar.</p>}
     <label className="studio-upload"><FileText/> Adicionar referência<input type="file" accept=".txt,.md,.pdf,.docx" aria-label="Adicionar referência ao agente" disabled={(draft.instructionFiles||[]).length>=8} onChange={e=>{reference(e.target.files?.[0]);e.target.value='';}}/></label><small>TXT, Markdown, PDF ou DOCX · até 5 MB · {(draft.instructionFiles||[]).length}/8 documentos</small>
     {(draft.instructionFiles||[]).map(document=><details className="studio-document" key={document.id}><summary><FileText/>{document.name}</summary><textarea aria-label={'Texto de '+document.name} maxLength={12000} value={document.text} onChange={e=>patch({instructionFiles:draft.instructionFiles.map(d=>d.id===document.id?{...d,text:e.target.value}:d)})}/><button type="button" onClick={()=>patch({instructionFiles:draft.instructionFiles.filter(d=>d.id!==document.id)})}><X/> Remover referência</button></details>)}
     <p>Documentos ajudam a dar contexto. Eles não liberam ferramentas nem substituem suas orientações.</p>
    </div></details>
    <details className="studio-extra"><summary><ShieldCheck/><span>Acessos e participação<small>Você decide o que esse agente poderá receber.</small></span></summary><div>
     {CAPABILITIES.map(([name,label,detail])=><label className="studio-capability" key={name}><input type="checkbox" checked={draft.capabilities?.includes(name)||false} onChange={e=>patch({capabilities:e.target.checked?[...(draft.capabilities||[]),name]:(draft.capabilities||[]).filter(v=>v!==name)})}/><span><strong>{label}</strong><small>{detail}</small></span></label>)}
     <p>Capacidades não liberam acesso sozinhas: cada execução precisa da sua autorização. Escrita e código dependem da caixa Linux. Rede não está disponível.</p>
     <label className="studio-capability"><input type="checkbox" checked={Boolean(draft.exclusive)} onChange={e=>patch({exclusive:e.target.checked})}/><span><strong>Participar de um único grupo</strong><small>Desmarcado, ele pode colaborar em diferentes grupos.</small></span></label>
    </div></details>
   </div>
  </fieldset>
  {(error||fileError)&&<p className="studio-error" role="alert">{fileError||error}</p>}{fileBusy&&<p role="status">{fileBusy==='avatar'?'Preparando a imagem…':'Lendo sua referência…'}</p>}
  <footer className="studio-footer"><small>Seu agente fica neste Hane.<br/>Você escolhe quando começar a conversar.</small><button type="button" disabled={busy||Boolean(fileBusy)} onClick={cancel}>Cancelar</button><button type="submit" className="primary" disabled={busy||Boolean(fileBusy)||draft.name.trim().length<2||Boolean(unavailableProvider)||(existing&&!dirty)}>{busy?'Salvando…':existing?'Salvar mudanças':'Criar meu agente'}<ArrowRight/></button></footer>
 </form>;
}
