import { attachmentText, attachmentGrants } from './workspace-attachments.js';
import AgentConversation from './AgentConversation.jsx';
import { fetchLibrary, changeLibrary, importBrowserLibrary, legacyLibrary, unavailableNotice } from './library-api.js';
import { ProfileMenu, ProfileSettings, PersonalAvatar } from "./PersonalProfile.jsx";
import SettingsCenter, { SettingsSection } from "./SettingsCenter.jsx";
import { readPreference, writePreference, normalizeAppearance, normalizeGeneral, validateLibrary, appearanceStyle } from "./preferences.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise, ArrowSquareOut, At, BracketsCurly, CaretLeft, CaretRight, Check, CircleNotch, Clock, Code,
  CopySimple, FileText, FolderOpen, MagnifyingGlass, PaperPlaneRight, Paperclip, Plugs, Plus, Sparkle,
  GearSix, ShieldCheck, UsersThree, Warning, X,
} from "@phosphor-icons/react";
import {
  approvePop, entrance, flash, growBar, pop, pulseLoop, reduceMotion, rise, spinLoop, spinOnce, staggerIn, toastOut,
} from "./motion.js";
import { approveMission, cancelMission, createMission, fetchMission, fetchMissions, fetchOnboarding, fetchProviders, fetchWorkspace, selectWorkspaceItem, openMissionEvents, pollGitHubAuthorization, retryMission, startGitHubAuthorization } from "./api.js";
import { HaneAvatar } from "./HaneAvatar.jsx";
import { avatarStateFromMission } from "./avatar-runtime.js";
import { loadLocalWorkspace, requestLocalWorkspace } from "./local-workspace.js";
import { CAPABILITY_OPTIONS, GATED_CAPABILITIES_NOTE, WORKSPACE_DISABLED_HINT, WORKSPACE_ROW_HINT, capabilityPayload, evidenceRows, grantDisplay, isCapabilityEnabled, toolUsageLabel, workspaceRootLabel } from "./workspace-evidence.js";

// The mission roles deliberately retain the real planner → executor → reviewer
// contract.  `face` only changes their presentation to the Figma Make avatar
// language; it must not be used as an identity or permission signal.
const roles = {
  planner: { name: "Planejador", job: "Planejamento", tone: "lilac", shape: "hexagon", color: "#b9a4d9", Icon: UsersThree },
  executor: { name: "Executor", job: "Execução", tone: "blue", shape: "capsule", color: "#8aa9c9", Icon: Code },
  reviewer: { name: "Revisor", job: "Revisão", tone: "mint", shape: "cloud", color: "#9bbfae", Icon: ShieldCheck },
};
const onboardingAgent = { name: "Hane", job: "Guia de início", tone: "pink", shape: "pebble", color: "#e66f98", Icon: Sparkle };
const ROLE_ORDER = ["planner", "executor", "reviewer"];
// GitHub is rendered from live /api/onboarding state; the rest of the catalog
// has no runtime behind it yet, so it stays explicitly "not integrated".
const CONNECTOR_CATALOG = Object.freeze([
  { id: "github", name: "GitHub", detail: "Repositórios, issues e pull requests", mode: "API / OAuth" },
  { id: "figma", name: "Figma", detail: "Arquivos, frames e variáveis", mode: "API / MCP", status: "Ainda não integrado" },
  { id: "supabase", name: "Supabase", detail: "Schema, consultas e migrations", mode: "API", status: "Ainda não integrado" },
  { id: "mcp", name: "Servidores MCP", detail: "Ferramentas declaradas por servidor", mode: "MCP", status: "Ainda não integrado" },
]);





const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.userAgent ?? "");
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
const MAX_CONTEXT_CHARS = 4000;
const MAX_OBJECTIVE_CHARS = 24000;
// Capability scopes live in `workspace-evidence.js` so the payload the composer
// sends is the exact value the tests assert on: workspace grants carry the
// plain relative scope `.`, never a glob, because the core rejects globs and
// needs a server-owned root.

const statusInfo = (status) => ({
  queued: ["Na fila", "queued"],
  draft: ["Rascunho", "queued"],
  planned: ["Planejando", "running"],
  executing: ["Executando", "running"],
  reviewing: ["Revisando", "running"],
  awaiting_approval: ["Aguardando aprovação", "running"],
  completed: ["Concluída", "done"],
  cancelled: ["Cancelada", "attention"],
  needs_attention: ["Atenção necessária", "attention"],
  failed: ["Falhou", "attention"],
}[status] ?? [status, "queued"]);

const isActive = (status) => ["planned", "executing", "reviewing"].includes(status);

const clock = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const dateLabel = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

function toSummary(task) {
  return {
    id: task.id,
    ...(task.teamId ? { teamId: task.teamId } : {}),
    ...(task.executionPlan ? {executionPlan:{...task.executionPlan,roles:Object.fromEntries(Object.entries(task.executionPlan.roles).map(([role,{agentId,name,providerLabel,model}])=>[role,{agentId,name,providerLabel,model}]))}} : {}),
    objective: task.objective,
    status: task.status,
    maxProviderCalls: task.maxProviderCalls,
    providerCalls: task.providerCalls ?? 0,
    updatedAt: task.updatedAt ?? task.audit?.at(-1)?.at ?? null,
  };
}

function composeObjective(text, attachments) {
  if (attachments.length === 0) return text;
  const blocks = attachments.map(attachmentText).join("\n\n");
  return `${text ? `${text}\n\n` : ""}Contexto anexado:\n\n${blocks}`.trim();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Avatar({ person, size = "md", state = "idle", interactive = false, onClick }) {
  const Icon = person.Icon;
  const dimensions = { xs: 24, sm: 34, md: 44 };
  if (!person.shape) return <span className={`avatar ${person.tone} ${size}`} aria-label={person.name}><Icon weight="bold" /></span>;
  return <HaneAvatar agentId={person.name} name={person.name} shape={person.shape} color={person.color} image={person.image} state={state} size={dimensions[size] ?? 44} interactive={interactive} decorative={!interactive} onClick={onClick} />;
}

function missionPerson(mission,role) {
  const binding=mission?.executionPlan?.roles?.[role];
  return binding ? {...roles[role],name:binding.name,job:roles[role].job+' · '+binding.providerLabel+' / '+binding.model} : roles[role];
}

function Stack({ mission, currentRole }) {
  return <span className="agent-stack">{ROLE_ORDER.map((role) => <Avatar key={role} person={missionPerson(mission,role)} size="xs" state={avatarStateFromMission({ mission, role, currentRole })} />)}</span>;
}

function Status({ kind, children }) {
  return <span className={`status ${kind}`}>{kind === "done" && <Check weight="bold" />}{children}</span>;
}

function Artifact({ type, title, meta, onOpen }) {
  return <button className="artifact" onClick={onOpen}>
    <span className={`artifact-icon ${type}`}>{type === "json" ? <BracketsCurly /> : type === "secure" ? <ShieldCheck /> : <FileText />}</span>
    <span><strong>{title}</strong><small>{meta}</small></span>
    <ArrowSquareOut />
  </button>;
}

function CmdLine({ command, onCopy }) {
  return <code className="cmd">{command}<button type="button" aria-label={`Copiar: ${command}`} onClick={() => onCopy(command)}><CopySimple /></button></code>;
}

function EmptyMini({ Icon, title, children, action }) {
  return <div className="empty-mini">
    <Icon />
    <span><strong>{title}</strong><small>{children}</small></span>
    {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
  </div>;
}

function EmptyStage({ Icon, title, children, commands = [], action, onCopy }) {
  return <div className="empty-stage">
    <span className="empty-badge"><Icon weight="fill" /></span>
    <strong>{title}</strong>
    <p>{children}</p>
    {commands.length > 0 && <span className="empty-commands">{commands.map((command) => <CmdLine key={command} command={command} onCopy={onCopy} />)}</span>}
    {action && <button type="button" className="empty-action" onClick={action.onClick}>{action.label}<CaretRight weight="bold" /></button>}
  </div>;
}

function OnboardingMessage({ step, hasProvider, github, githubAvailable, githubDevice, workspace, busy, onOpenProviders, onCopy, onRequestWorkspace, onConnectGitHub, onCheckGitHub, onAdvance, onCreateMission, onCreateAnother, profile, onProfileChange, onCreateProfile }) {
  const next = (label = "Continuar") => <span className="onboarding-choice"><button type="button" className="onboarding-action primary" onClick={onAdvance}>{label} <CaretRight /></button></span>;
  return <article className="message onboarding-message">
    <Avatar person={onboardingAgent} state="thinking" />
    <div className="message-content">
      <header><strong>Hane</strong><small>Guia de início</small><Status kind="queued">Sua escolha</Status></header>
      <div className="onboarding-progress" aria-label={`Etapa ${step + 1} de 5`}><span>Etapa {step + 1} de 5</span><i><b style={{ width: `${((step + 1) / 5) * 100}%` }} /></i></div>
      {step === 0 && <><p>Bem-vindo. Antes de qualquer execução, quer conectar um provedor de IA? Você pode configurar agora ou seguir e decidir depois.</p>{hasProvider ? <><span className="onboarding-granted"><Check weight="bold" /> Provedor disponível</span>{next()}</> : <><div className="onboarding-commands"><CmdLine command="node bin/hane.js provider add --label <nome> --base-url <url> --model <id>" onCopy={onCopy} /><CmdLine command="node bin/hane.js provider set-secret <nome>" onCopy={onCopy} /></div><button type="button" className="onboarding-action" onClick={onOpenProviders}>Ver configuração <CaretRight /></button>{next("Configuro depois")}</>}</>}
      {step === 1 && <><p>Quer permitir uma pasta local? Hane só poderá lê-la quando uma execução receber explicitamente <code>workspace.read</code>.</p>{workspace.granted ? <><span className="onboarding-granted"><Check weight="bold" /> “{workspace.name}” autorizada</span>{next()}</> : workspace.supported ? <><button type="button" className="onboarding-action" disabled={busy === "workspace"} onClick={onRequestWorkspace}>{busy === "workspace" ? "Escolhendo…" : "Escolher pasta"} <CaretRight /></button>{next("Pular por enquanto")}</> : <><span className="onboarding-note">Use Chrome ou Edge para escolher uma pasta local.</span>{next("Continuar")}</>}</>}
      {step === 2 && <><p>Quer conectar o GitHub? A autorização é oficial e você decide depois, por execução, quando um repositório pode ser lido.</p>{github ? <><span className="onboarding-granted"><Check weight="bold" /> Conectado como @{github.accountLabel}</span>{next()}</> : githubDevice ? <div className="github-device"><span>Abra <a href={githubDevice.verificationUri} target="_blank" rel="noreferrer">github.com/login/device</a> e informe:</span><strong>{githubDevice.userCode}</strong><button type="button" className="onboarding-action primary" disabled={busy === "github"} onClick={onCheckGitHub}>{busy === "github" ? "Verificando…" : "Já autorizei"}</button></div> : githubAvailable ? <><button type="button" className="onboarding-action" disabled={busy === "github"} onClick={onConnectGitHub}>Conectar GitHub <CaretRight /></button>{next("Pular por enquanto")}</> : <><span className="onboarding-note">GitHub pode ser conectado quando o servidor tiver um Client ID.</span>{next("Continuar")}</>}</>}
      {step === 3 && <><p>Assim funciona: você descreve a execução, o runtime planeja, executa e revisa. Ações importantes continuam exigindo sua aprovação.</p>{next("Entendi")}</>}
      {step === 4 && <div className="agent-creator"><p>Agora crie o primeiro Hane do seu jeito. Isso define um perfil visual local; os papéis técnicos continuam visíveis e auditáveis.</p><label>Nome<input value={profile.name} maxLength="32" onChange={(event) => onProfileChange({ ...profile, name: event.target.value })} placeholder="Nome do Hane" /></label><label>Cor<input type="color" value={profile.color} onChange={(event) => onProfileChange({ ...profile, color: event.target.value })} /></label><label>Forma<select value={profile.shape} onChange={(event) => onProfileChange({ ...profile, shape: event.target.value })}><option value="pebble">Pedra</option><option value="petal">Pétala</option><option value="drop">Gota</option><option value="cloud">Nuvem</option></select></label><label>Imagem ou GIF<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (!file || file.size > 2_000_000) return; const reader = new FileReader(); reader.onload = () => onProfileChange({ ...profile, image: reader.result }); reader.readAsDataURL(file); }} /></label><Avatar person={{ ...onboardingAgent, ...profile }} size="md" state="idle" /> <button type="button" className="onboarding-action primary" disabled={!profile.name.trim()} onClick={onCreateProfile}>Criar Hane <CaretRight /></button></div>}
      {step >= 5 && <div className="onboarding-complete"><span><Check weight="bold" /></span><div><strong>Seu Hane está pronto.</strong><p>O perfil foi salvo neste navegador e já aparece na lista de agentes. Você pode criar quantos quiser.</p></div><button type="button" className="onboarding-action primary" onClick={onCreateMission}>Criar primeira execução <CaretRight /></button><button type="button" className="onboarding-action" onClick={onCreateAnother}>Criar outro Hane <CaretRight /></button></div>}
    </div>
  </article>;
}

function PanelEmpty({ children }) {
  return <p className="panel-empty">{children}</p>;
}

function auditSummary(entry) {
  const role = entry.detail?.role ? `${entry.detail.agentName ?? roles[entry.detail.role]?.name ?? entry.detail.role} · ` : "";
  if (entry.type === "task_created") return "Execução registrada no armazenamento local.";
  if (entry.type === "state_changed") return `${role}estado: ${entry.detail?.nextStatus ?? "atualizado"}.`;
  if (entry.type === "provider_call_reserved") return `${role}chamada ${entry.detail?.providerCall ?? ""} reservada.`;
  if (entry.type === "agent_handoff") return `${role}recebeu a saída de ${entry.detail.fromAgentName ?? entry.detail.fromRole}.`;
  if (entry.type === "agent_output_recorded") return `${role}saída persistida (${entry.detail?.characters ?? 0} caracteres).`;
  if (entry.type === "provider_retry") return `${role}nova tentativa: ${entry.detail?.reason ?? "transporte"}.`;
  if (entry.type === "provider_call_failed") return `${role}falha: ${entry.detail?.message ?? "provedor indisponível"}`;
  if (entry.type === "mission_cancelled") return "Cancelamento confirmado e persistido.";
  return `${role}${entry.type.replaceAll("_", " ")}.`;
}

function RiseIn({ className, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const animation = rise(ref.current);
    return () => animation?.revert();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

function Spinner() {
  const ref = useRef(null);
  useEffect(() => {
    const animation = spinLoop(ref.current);
    return () => animation?.revert();
  }, []);
  return <CircleNotch ref={ref} className="spin-inline" />;
}

function GitHubConnector({ connector, github, device, available, busy, onConnect, onCheck }) {
  if (github) {
    return <div className="settings-row">
      <span className="setting-icon ok"><Plugs weight="fill" /></span>
      <span><strong>{connector.name}</strong><small>{connector.detail} · @{github.accountLabel} · escopos: {github.scopes.join(", ") || "nenhum"}</small></span>
      <em className="settings-ok">Autorizado em {dateLabel(github.connectedAt)}</em>
    </div>;
  }
  if (device) {
    return <div className="settings-row">
      <span className="setting-icon pending"><Plugs weight="bold" /></span>
      <span><strong>{connector.name}</strong><small>Autorização pendente · informe <b>{device.userCode}</b> em <a href={device.verificationUri} target="_blank" rel="noreferrer">github.com/login/device</a></small></span>
      <button type="button" className="settings-action" disabled={busy === "github"} onClick={onCheck}>{busy === "github" ? "Verificando…" : "Já autorizei"}</button>
    </div>;
  }
  return <div>
    <div className="settings-row">
      <span className="setting-icon"><Plugs weight="bold" /></span>
      <span><strong>{connector.name}</strong><small>{connector.detail} · {connector.mode}</small></span>
      {available
        ? <button type="button" className="settings-action" disabled={busy === "github"} onClick={onConnect}>{busy === "github" ? "Preparando…" : "Conectar"}</button>
        : <em className="settings-off">Não conectado</em>}
    </div>
    {!available && <p className="settings-note">O device flow do GitHub só aparece quando <code>hane serve</code> é iniciado com <code>--github-client-id</code>.</p>}
  </div>;
}

export function HaneApp({personalProfile,onPersonalProfileChange,onLockProfile,profileLimits,onRecoveryCode}) {
  const [missions, setMissions] = useState(null);
  const [providers, setProviders] = useState([]);
  const [offline, setOffline] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [mission, setMission] = useState(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const [chosenProvider, setChosenProvider] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [popover, setPopover] = useState(null);
  const [contextDraft, setContextDraft] = useState("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const pickerPending = useRef(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [composerWorkspaceRoot, setComposerWorkspaceRoot] = useState(null);
  const [capabilityGrants, setCapabilityGrants] = useState([]);
  const [onboarding, setOnboarding] = useState({ github: null, githubAvailable: false });
  const [appearance, setAppearance] = useState(() => {
    return normalizeAppearance(readPreference("hane-appearance", {}));
  });
  const [general, setGeneral] = useState(() => normalizeGeneral(readPreference("hane-general", {})));
  const [libraryState, setLibraryState] = useState({agents:[],groups:[]});
  const library = useMemo(() => !missions || offline ? libraryState : {...libraryState,groups:libraryState.groups.map(g=>({...g,runs:missions.filter(run=>run.teamId===g.id).map(run=>run.id)}))}, [libraryState,missions,offline]);
  const [legacy] = useState(() => { try { return legacyLibrary(); } catch { return readPreference('hane-library',{agents:[],groups:[]}); } });
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryBusy, setLibraryBusy] = useState(false);
  const libraryWriting = useRef(false);
  const [activeAgentId,setActiveAgentId] = useState(null);
  const [editingAgentId,setEditingAgentId] = useState(null);
  const activeAgent=library.agents.find(a=>a.id===activeAgentId);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [executionMode,setExecutionMode]=useState('standard');
  const [roleAssignments,setRoleAssignments]=useState({planner:'',executor:'',reviewer:''});
  useEffect(()=>{setExecutionMode('standard');setRoleAssignments({planner:'',executor:'',reviewer:''});},[activeGroupId]);
  const activeGroup = library.groups.find(group => group.id === activeGroupId);
  // Conversa and Missão are two entries, not one derived state: opening an agent
  // must not hide the composer, and choosing Missão keeps the group as the
  // execution link (ADR-0010).
  const [viewMode, setViewMode] = useState('missao');
  const showConversation = viewMode === 'conversa' && Boolean(activeAgent || activeGroup);
  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [runsExpanded, setRunsExpanded] = useState(true);
  const [persistenceError, setPersistenceError] = useState("");
  const [workspace, setWorkspace] = useState({ supported: false, name: null, granted: false });
  // Root owned by the server itself (GET /api/workspace). Unknown until fetched,
  // and a missing route stays "unavailable" rather than optimistic.
  const [serverWorkspace, setServerWorkspace] = useState({ available: false, root: null, loaded: false });
  const composerWorkspace = { ...serverWorkspace, root:composerWorkspaceRoot ?? serverWorkspace.root, available:Boolean(composerWorkspaceRoot || serverWorkspace.available) };
  const [createError, setCreateError] = useState("");
  const [githubDevice, setGitHubDevice] = useState(null);
  const [onboardingBusy, setOnboardingBusy] = useState(null);
  const [onboardingStep, setOnboardingStep] = useState(() => Number(localStorage.getItem("hane-onboarding-step") ?? 0));
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => localStorage.getItem("hane-onboarding-dismissed") === "true");
  const [profileDraft, setProfileDraft] = useState({ name: "", color: "#e66f98", shape: "pebble", image: null });
  const [showSettings, setShowSettings] = useState(() => window.location.hash.startsWith("#settings"));
  const [panelOpen, setPanelOpen] = useState(() => {
    // A compact desktop window needs the conversation first; its audit panel
    // remains one explicit click away instead of covering the composer.
    if (window.matchMedia?.("(max-width: 980px)").matches) return false;
    return localStorage.getItem("hane-panel-open") !== "false";
  });
  async function setLibrary(value) {
    if (!libraryReady) throw new Error('Aguarde a biblioteca do servidor.');
    if (libraryWriting.current) throw new Error('Uma alteração já está sendo salva.');
    libraryWriting.current=true; setLibraryBusy(true);
    try {
      const result=await changeLibrary(library,typeof value==='function'?value(library):value);
      setLibraryState(result.library);
      if (!result.visualSaved) setPersistenceError('Agentes e grupos salvos no servidor. Não foi possível salvar as cores e avatares neste navegador.');
    } finally { libraryWriting.current=false; setLibraryBusy(false); }
  }
  async function importLibrary(source) {
    if (libraryWriting.current) throw new Error('Uma alteração já está sendo salva.');
    libraryWriting.current=true; setLibraryBusy(true);
    try {
      const result=await importBrowserLibrary(source);
      if (!result.visualSaved) setPersistenceError('Importação salva no servidor; as cores e avatares não puderam ser salvos neste navegador.');
      try { const data = await fetchLibrary(); setLibraryState(data); setLibraryReady(true); setLibraryError(unavailableNotice(data.unavailable)); }
      catch (error) { setLibraryReady(false); setLibraryError('Importação salva. Recarregue a biblioteca: '+error.message); }
      return result;
    } finally { libraryWriting.current=false; setLibraryBusy(false); }
  }
  const rootRef = useRef(null);
  const barRef = useRef(null);
  const toastRef = useRef(null);
  const sendRef = useRef(null);
  const composerRef = useRef(null);
  const approvalRef = useRef(null);
  const selectedRef = useRef(null);
  const searchRef = useRef(null);
  const messagesRef = useRef(null);
  const contextRef = useRef(null);
  const attachChoiceRef = useRef(null);
  const gearRef = useRef(null);
  const formRef = useRef(null);
  const panelTriggerRef = useRef(null);
  const rowIdsRef = useRef("");
  selectedRef.current = selectedId;

  const visible = useMemo(() => (missions ?? []).filter(item => !activeGroup || item.teamId === activeGroup.id).filter((item) => `${item.objective} ${item.id}`.toLowerCase().includes(query.toLowerCase())), [missions, query, activeGroup]);
  const [selectedLabel, selectedChip] = statusInfo(mission?.status ?? (selectedId ? "queued" : "draft"));
  const currentRole = mission ? ROLE_ORDER.find((role) => mission.outputs?.[role] === undefined) : null;
  const progressPct = mission && mission.maxProviderCalls > 0 ? Math.min(100, Math.round((mission.providerCalls / mission.maxProviderCalls) * 100)) : 0;
  const outputs = mission ? ROLE_ORDER.filter((role) => mission.outputs?.[role] !== undefined) : [];
  const verdictEntry = useMemo(() => mission?.audit?.filter((entry) => entry.type === "verdict_parsed" || entry.type === "verdict_unparsed").at(-1) ?? null, [mission]);
  const retryable = mission && (mission.status === "failed" || (mission.status === "needs_attention" && ROLE_ORDER.some((role) => mission.outputs?.[role] === undefined)));
  const cancellable = mission && isActive(mission.status);
  const loaded = missions !== null && !offline;
  const noProviders = providers.length === 0;
  const noMissions = (missions ?? []).length === 0;
  const showOnboarding = !personalProfile && loaded && noMissions && !activeGroup && !onboardingDismissed;
  const observedRole = currentRole ?? outputs.at(-1) ?? "planner";
  const sessionEvents = mission?.audit?.slice(-4).map((entry) => `${clock(entry.at)}  ${auditSummary(entry)}`) ?? [];
  const evidence = useMemo(() => evidenceRows(mission), [mission]);
  const toolUsage = toolUsageLabel(mission);

  useEffect(() => {
    const runs = entrance(rootRef.current);
    return () => runs.forEach((animation) => animation.revert());
  }, []);

  useEffect(() => { localStorage.setItem("hane-onboarding-step", String(onboardingStep)); }, [onboardingStep]);
  useEffect(() => { localStorage.setItem("hane-onboarding-dismissed", String(onboardingDismissed)); }, [onboardingDismissed]);
  useEffect(() => { localStorage.setItem("hane-panel-open", String(panelOpen)); }, [panelOpen]);
  useEffect(() => { if (!writePreference("hane-appearance", appearance)) setPersistenceError("Não foi possível salvar a aparência neste navegador."); }, [appearance]);
  useEffect(() => { if (!writePreference("hane-general", general)) setPersistenceError("Não foi possível salvar as preferências neste navegador."); }, [general]);
  useEffect(() => {
    let alive=true; setLibraryReady(false); setLibraryError('');
    fetchLibrary().then(data=>{if(alive){setLibraryState(data);setLibraryReady(true);setLibraryError(unavailableNotice(data.unavailable));if(!activeAgentId&&!activeGroupId)setActiveAgentId(data.agents.find(a=>a.isInitial)?.id||null);}}).catch(error=>{if(alive)setLibraryError('Não foi possível carregar a biblioteca do servidor: '+error.message);});
    return ()=>{alive=false;};
  }, [retryTick]);

  useEffect(() => { document.documentElement.dataset.haneMotion = appearance.motion; }, [appearance.motion]);
  useEffect(() => { const onHash = () => setShowSettings(window.location.hash.startsWith("#settings")); window.addEventListener("hashchange", onHash); return () => window.removeEventListener("hashchange", onHash); }, []);
  useEffect(() => {
    document.documentElement.dataset.haneTheme = appearance.theme;
    document.body.dataset.haneTheme = appearance.theme;
    document.getElementById("root")?.setAttribute("data-hane-theme", appearance.theme);
  }, [appearance.theme]);

  useEffect(() => {
    let alive = true;
    fetchWorkspace().then((data) => { if (alive) setServerWorkspace({ ...data, loaded: true }); });
    Promise.all([fetchMissions(), fetchProviders()])
      .then(([missionData, providerData]) => {
        if (!alive) return;
        setOffline(false);
        setMissions(missionData.missions);
        setProviders(providerData.providers);
        setSelectedId((current) => current ?? (general.startup === "latest" ? missionData.missions[0]?.id : null) ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setOffline(true);
        setMissions([]);
        setProviders([]);
      });
    return () => { alive = false; };
  }, [retryTick]);

  useEffect(() => {
    let alive = true;
    fetchOnboarding().then((data) => { if (alive) setOnboarding(data); }).catch(() => { if (alive) setOnboarding({ github: null, githubAvailable: false }); });
    loadLocalWorkspace().then((data) => { if (alive) setWorkspace(data); }).catch(() => { if (alive) setWorkspace({ supported: false, name: null, granted: false }); });
    return () => { alive = false; };
  }, []);

  function openSettings() {
    window.location.hash = "settings/general";
    setShowSettings(true);
    fetchOnboarding().then(setOnboarding).catch(() => {});
  }

  function closeContextPanel({ restoreFocus = true } = {}) {
    setPanelOpen(false);
    if (restoreFocus) requestAnimationFrame(() => panelTriggerRef.current?.focus());
  }

  useEffect(() => {
    const close = openMissionEvents((event) => {
      if (event.type === "server_error") {
        notify(`Erro no servidor: ${event.message}`);
        return;
      }
      if (!event.task) return;
      setOffline(false);
      const summary = toSummary(event.task);
      setMissions((items) => [summary, ...(items ?? []).filter((item) => item.id !== summary.id)]);
      if (event.missionId === selectedRef.current) setMission(event.task);
    });
    return close;
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMission(null);
      return undefined;
    }
    let alive = true;
    fetchMission(selectedId).then((data) => { if (alive) setMission(data); }).catch(() => { if (alive) setMission(null); });
    return () => { alive = false; };
  }, [selectedId, retryTick]);

  useEffect(() => {
    if (!selectedId) return;
    // Each mission is a new reading context: keep the shell fixed and start
    // its own scrollable transcript at the beginning.
    messagesRef.current?.scrollTo({ top: 0, behavior: "auto" });
    document.scrollingElement?.scrollTo({ top: 0, behavior: "auto" });
  }, [selectedId, mission?.id]);

  useEffect(() => {
    if (chosenProvider && !providers.some((item) => item.label === chosenProvider)) setChosenProvider(null);
  }, [providers, chosenProvider]);

  // A grant whose scope the server cannot enforce is dropped rather than sent:
  // the chips say "unavailable", so the payload has to agree with them.
  useEffect(() => {
    if (!serverWorkspace.loaded || serverWorkspace.available) return;
    setCapabilityGrants((current) => current.filter((grant) => !CAPABILITY_OPTIONS.find((option) => option.name === grant.name)?.requiresServerRoot));
  }, [serverWorkspace]);

  useEffect(() => {
    const onKeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        if (panelOpen) closeContextPanel({ restoreFocus: false });
        else setPanelOpen(true);
        return;
      }
      if (event.key !== "Escape") return;
      if (popover) setPopover(null);
      else if (panelOpen) closeContextPanel();
      else if (document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [panelOpen, popover]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const live = root.querySelector(".live i");
    const runs = [
      pulseLoop(live ? [live] : []),
      pulseLoop(root.querySelectorAll(".active-agent > i")),
    ].filter(Boolean);
    return () => runs.forEach((animation) => animation.revert());
  }, [selectedId, providers.length]);

  useEffect(() => {
    const ids = visible.map((item) => item.id).join(",");
    if (rowIdsRef.current === ids) return undefined;
    rowIdsRef.current = ids;
    const animation = staggerIn(rootRef.current?.querySelectorAll(".conversation-row"), { y: 8, step: 22, duration: 260 });
    return () => animation?.revert();
  }, [visible]);

  useEffect(() => {
    const root = rootRef.current;
    const scope = root?.querySelector(".messages");
    if (!scope) return undefined;
    const targets = [root.querySelector(".conversation-header"), ...scope.children].filter(Boolean);
    const animation = staggerIn(targets, { y: 8, step: 28, duration: 300 });
    return () => animation?.revert();
  }, [selectedId, offline, missions === null]);

  useEffect(() => {
    const animation = growBar(barRef.current, `${progressPct}%`);
    return () => animation?.revert();
  }, [progressPct]);

  useEffect(() => {
    if (!toast) return undefined;
    const animation = rise(toastRef.current, { y: 8, duration: 240 });
    return () => animation?.revert();
  }, [toast]);

  useEffect(() => {
    if (popover === "attach") attachChoiceRef.current?.focus();
    if (popover === "mention") composerRef.current?.focus();
  }, [popover]);

  function notify(message) {
    if (!general.notifications && !/falha|erro|bloque|inválid|não|descreva/i.test(message)) return;
    setToast(message);
    window.clearTimeout(window.__haneToast);
    window.__haneToast = window.setTimeout(() => {
      const el = toastRef.current;
      if (el && !reduceMotion()) toastOut(el).then(() => setToast(""));
      else setToast("");
    }, 2400);
  }

  function copyNotice(command) {
    copyText(command).then((ok) => notify(ok ? `Copiado: ${command}` : "O navegador bloqueou a área de transferência."));
  }

  function reload() {
    spinOnce(gearRef.current);
    setPopover(null);
    setRetryTick((tick) => tick + 1);
    notify("Recarregando execuções e agentes");
  }

  function focusComposer() {
    setViewMode('missao');
    setSelectedId(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function beginFirstMission() {
    setOnboardingDismissed(true);
    setSelectedId(null);
    setViewMode('missao');
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function requestWorkspacePermission() {
    setOnboardingBusy("workspace");
    try {
      setWorkspace(await requestLocalWorkspace());
      notify("Pasta local autorizada para leitura por execução.");
    } catch (error) {
      if (error?.name !== "AbortError") notify(error instanceof Error ? error.message : "Não foi possível autorizar a pasta.");
    } finally {
      setOnboardingBusy(null);
    }
  }

  async function connectGitHub() {
    setOnboardingBusy("github");
    try {
      setGitHubDevice(await startGitHubAuthorization());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível iniciar a autorização do GitHub.");
    } finally {
      setOnboardingBusy(null);
    }
  }

  async function checkGitHubAuthorization() {
    if (!githubDevice) return;
    setOnboardingBusy("github");
    try {
      const result = await pollGitHubAuthorization(githubDevice.id);
      if (result.status === "pending") return notify("Aguardando a autorização no GitHub.");
      setOnboarding((current) => ({ ...current, github: result.github }));
      setGitHubDevice(null);
      notify(`GitHub conectado como @${result.github.accountLabel}.`);
    } catch (error) {
      setGitHubDevice(null);
      notify(error instanceof Error ? error.message : "Não foi possível concluir a autorização do GitHub.");
    } finally {
      setOnboardingBusy(null);
    }
  }

  function advanceOnboarding() {
    setOnboardingStep((current) => Math.min(4, current + 1));
    window.requestAnimationFrame(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" }));
  }

  async function createCustomHane() {
    const name = profileDraft.name.trim();
    if (!name) return;
    try { await setLibrary(current => ({ ...current, agents: [...current.agents, { ...profileDraft, name, id: crypto.randomUUID(), description: "Hane personalizado", instructions:"",provider:"",exclusive:false,groupId: "" }] }));
    setProfileDraft({ name: "", color: "#e66f98", shape: "pebble", image: null });
    setOnboardingStep(5);
    notify(`${name} foi salvo no SQLite local.`);
    } catch(error) { setCreateError(error.message); }
  }

  function togglePopover(kind) {
    setContextDraft("");
    setAttachmentError("");
    setPopover((current) => (current === kind ? null : kind));
  }

  function addContext() {
    const text = contextDraft.trim();
    if (text.length < 3) return;
    setAttachments((items) => [...items, { id: `${Date.now()}-${items.length}`, text: text.slice(0, MAX_CONTEXT_CHARS) }]);
    setContextDraft("");
    setPopover(null);
    notify("Contexto anexado · viaja junto com o objetivo");
  }

  async function attachWorkspace(kind) {
    if (pickerPending.current || sending) return;
    pickerPending.current = true;
    setPickerBusy(true);
    setAttachmentError('');
    try {
      const {selection} = await selectWorkspaceItem(kind, composerWorkspace.root);
      if (!selection) return;
      const hasWorkspaceItems = attachments.some(item => item.scope) || capabilityGrants.some(grant => grant.name.startsWith('workspace.'));
      if (hasWorkspaceItems && selection.root !== composerWorkspace.root) throw new Error('Escolha um item da mesma raiz ou remova os anexos e permissões de workspace antes de trocar de pasta.');
      const item = {...selection, id:crypto.randomUUID()};
      const next = attachments.some(existing => existing.root === item.root && existing.scope === item.scope) ? attachments : [...attachments,item];
      attachmentGrants(next, capabilityGrants);
      setComposerWorkspaceRoot(selection.root);
      setAttachments(next);
      setPopover(null);
      notify(selection.kind === 'directory' ? 'Pasta anexada · leitura restrita à pasta escolhida' : 'Arquivo anexado · leitura restrita ao arquivo escolhido');
    } catch(error) { setAttachmentError(error.message || 'Não foi possível selecionar este item.'); }
    finally { pickerPending.current = false; setPickerBusy(false); }
  }

  function removeAttachment(id) {
    setAttachments((items) => items.filter((item) => item.id !== id));
  }

  function pickProvider(label) {
    const next = chosenProvider === label ? null : label;
    setChosenProvider(next);
    setPopover(null);
    notify(next ? `Próxima execução usa ${next}` : "Provedor liberado · a API usa o padrão");
  }

  function toggleCapability(option) {
    if (!isCapabilityEnabled(option, composerWorkspace)) return;
    setCapabilityGrants((current) => current.some((grant) => grant.name === option.name && grant.scope === option.scope)
      ? current.filter((grant) => grant.name !== option.name || grant.scope !== option.scope)
      : [...current, { name: option.name, scope: option.scope }]);
  }

  function insertMention(name) {
    const el = composerRef.current;
    const token = `@${name}`;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    const next = `${draft.slice(0, start)}${token} ${draft.slice(end)}`;
    setDraft(next);
    setPopover(null);
    window.requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const position = start + token.length + 1;
      el.setSelectionRange(position, position);
    });
  }

  function focusOutput(role) {
    const el = messagesRef.current?.querySelector(`[data-output="${role}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
    flash(el);
  }

  async function send(event) {
    event.preventDefault();
    if (sending) return;
    if (pickerPending.current) return;
    if (activeGroup?.archivedAt) { setCreateError("Este grupo está arquivado. Abra outro grupo para criar uma execução."); return; }
    const objective = composeObjective(draft.trim(), attachments);
    if (objective.length < 3) {
      notify("Descreva a execução em pelo menos três caracteres.");
      composerRef.current?.focus();
      return;
    }
    if (objective.length > MAX_OBJECTIVE_CHARS) {
      notify("Contexto grande demais · remova anexos antes de enviar.");
      return;
    }
    if (executionMode==='team-preset' && (!activeGroup || new Set(Object.values(roleAssignments)).size!==3 || Object.values(roleAssignments).some(id=>!activeGroup.members.includes(id)))) { setCreateError('Escolha três integrantes diferentes para este preset.'); return; }
    setSending(true);
    setCreateError("");
    try {
      const created = await createMission(objective, chosenProvider || general.defaultProvider, attachmentGrants(attachments, capabilityPayload(capabilityGrants)), { workspaceRoot:composerWorkspaceRoot, maxProviderCalls: general.maxProviderCalls, maxToolCalls: general.maxToolCalls, teamId: activeGroup?.id, ...(executionMode==='team-preset' ? {roleAssignments} : {}) });

      setDraft("");
      setAttachments([]);
      setComposerWorkspaceRoot(null);
      setCapabilityGrants([]);
      setPopover(null);
      setOffline(false);
      setSelectedId(created.id);
      setMission(null);
      setMissions((items) => {
        // SSE may already have delivered completed outputs before the 202 resolves.
        const existing=items?.find(item=>item.id===created.id);
        return [existing ?? toSummary({ ...created, providerCalls: 0, updatedAt: new Date().toISOString() }), ...(items ?? []).filter(item=>item.id!==created.id)];
      });
      pop(sendRef.current);
      notify("Execução criada · a equipe assumiu o trabalho");
    } catch (error) {
      // Shown inline, not only as a toast: a rejected mission has to stay on
      // screen with the wording the API actually returned.
      const detail = error instanceof Error && error.message ? error.message : "A API não respondeu.";
      setCreateError(detail);
      notify(`Falha ao criar a execução: ${detail}`);
    } finally {
      setSending(false);
    }
  }

  async function act(kind) {
    if (!mission || actionBusy) return;
    setActionBusy(true);
    try {
      if (kind === "approve") {
        approvePop(approvalRef.current);
        await approveMission(mission.id);
        notify("Aprovada · executor e revisor vão refazer a etapa");
      } else if (kind === "cancel") {
        await cancelMission(mission.id);
        notify("Cancelamento solicitado · aguardando confirmação do runtime");
      } else {
        const missing = ROLE_ORDER.filter((role) => mission.outputs?.[role] === undefined).length;
        const maxProviderCalls = Math.max(mission.maxProviderCalls, mission.providerCalls + missing);
        await retryMission(mission.id, maxProviderCalls > mission.maxProviderCalls ? { maxProviderCalls } : {});
        notify("Execução retomada");
      }
    } catch (error) {
      notify(`Falha: ${error.message}`);
    } finally {
      setActionBusy(false);
    }
  }

  const appearanceProps = {
    "data-hane-theme": appearance.theme,
    "data-text-size": appearance.textSize,
    "data-density": appearance.density,
    style: appearanceStyle(appearance),
  };

  function backToWorkspace() { window.location.hash = "workspace"; setShowSettings(false); requestAnimationFrame(() => gearRef.current?.focus()); }
  function openSection(section) { window.location.hash = "settings/" + section; setShowSettings(true); }
  function openGroup(id) { setActiveAgentId(null); setActiveGroupId(id); setSelectedId(null); setViewMode('conversa'); setOnboardingDismissed(true); backToWorkspace(); }
  function editAgent(id) { setEditingAgentId(id); openSection('agents'); }
  function openAgent(id) { setActiveGroupId(null);setActiveAgentId(id);setSelectedId(null);setViewMode('conversa');backToWorkspace(); }
  if (showSettings) return <SettingsCenter editingAgentId={editingAgentId} onOpenAgent={openAgent} renderProfile={() => <ProfileSettings profile={personalProfile} onProfileChange={onPersonalProfileChange} onLock={onLockProfile} limits={profileLimits} onRecoveryCode={onRecoveryCode}/>} appearance={appearance} general={general} onAppearanceChange={setAppearance} onGeneralChange={setGeneral} providers={providers} library={library} onLibraryChange={setLibrary} libraryReady={libraryReady} libraryBusy={libraryBusy} libraryError={libraryError} legacyLibrary={legacy} onImportLibrary={importLibrary} onReloadLibrary={() => setRetryTick(v=>v+1)} panelOpen={panelOpen} onPanelChange={setPanelOpen} onBack={backToWorkspace} onOpenGroup={openGroup} onOpenRun={id => { setActiveAgentId(null);setActiveGroupId(null); setSelectedId(id); setViewMode('missao'); backToWorkspace(); }} missions={missions ?? []} offline={offline} workspace={workspace} serverWorkspace={serverWorkspace} busy={onboardingBusy} onRequestWorkspace={requestWorkspacePermission} persistenceError={persistenceError} renderConnectors={() => <SettingsSection title="Conectores" note="Estado consultado no servidor; ferramentas só podem atuar com escopo e aprovação apropriados.">{CONNECTOR_CATALOG.filter(c => c.id !== "mcp").map(connector => connector.id === "github" ? <GitHubConnector key={connector.id} connector={connector} github={onboarding.github} device={githubDevice} available={onboarding.githubAvailable} busy={onboardingBusy} onConnect={connectGitHub} onCheck={checkGitHubAuthorization} /> : <div className="settings-row" key={connector.id}><span><strong>{connector.name}</strong><small>{connector.detail}</small></span><em>{connector.status}</em></div>)}</SettingsSection>} />;


  return <main className={`app-shell ${panelOpen && !showConversation ? "" : "panel-collapsed"}`} ref={rootRef} {...appearanceProps}>
    <aside className="left-sidebar" aria-label="Navegação do Hane">
      <div className="brand-row"><img src="/brand/hane-logo.png" alt="Hane" /><button ref={gearRef} className="icon-button" aria-label="Abrir configurações do Hane" onClick={openSettings}><GearSix /></button></div>
      <label className="search-box"><MagnifyingGlass /><input ref={searchRef} aria-label="Pesquisar execuções" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar execuções" /><kbd>{MOD_KEY} K</kbd></label>
      <button className="new-chat" aria-label="Criar grupo" onClick={() => openSection("agents")}><span><Plus weight="bold" /></span>Criar grupo<CaretRight /></button>

      <nav className="sidebar-scroll" aria-label="Agentes e execuções">
        <header className="section-head"><span>AGENTES</span><button aria-label="Recarregar dados dos agentes" onClick={reload}><ArrowsClockwise /></button></header>
        {library.agents.map(person => <div className="agent-nav custom-hane" key={person.id}><HaneAvatar agentId={person.id} name={person.name} color={person.color} shape={person.shape} image={person.image} size={34} interactive onClick={()=>editAgent(person.id)}/><button className="agent-chat-link" aria-label={'Conversar com '+person.name} onClick={()=>openAgent(person.id)}><strong>{person.name}</strong><small>{person.isInitial?'Seu Hane':'Agente personalizado'}</small></button></div>)}
        {loaded && noProviders && <EmptyMini Icon={Plugs} title="Nenhum provedor" action={{ label: "Detalhes", onClick: () => setPopover("providers") }}>
          Hane pode orientar você; conecte um provedor para executar execuções.
        </EmptyMini>}
        <header className="section-head conversation-head"><button aria-expanded={groupsExpanded} onClick={() => setGroupsExpanded(!groupsExpanded)}>GRUPOS</button><button aria-label="Biblioteca de agentes" onClick={() => openSection("agents")}><UsersThree /></button></header>
        {groupsExpanded && library.groups.filter(g => !g.archivedAt && g.name.toLowerCase().includes(query.toLowerCase())).map(group => <button className={"conversation-row " + (activeGroupId === group.id ? "selected" : "")} key={group.id} onClick={() => openGroup(group.id)}><span className="group-dot" style={{background:group.color}}/><span className="conversation-copy"><strong>{group.name}</strong><small>{group.members.length} integrantes · {group.runs.length} execuções</small></span></button>)}
        <header className="section-head conversation-head"><button aria-label="Todas as execuções" onClick={() => { setActiveAgentId(null);setActiveGroupId(null); setSelectedId(null); setViewMode('missao'); }}>Todas</button><button aria-expanded={runsExpanded} onClick={() => setRunsExpanded(!runsExpanded)}>EXECUÇÕES</button><button aria-label="Nova execução" onClick={focusComposer}><Plus /></button></header>
        {missions === null && <small className="panel-note">Carregando…</small>}
        {offline && <EmptyMini Icon={Plugs} title="API do Hane offline" action={{ label: "Tentar", onClick: reload }}>Inicie com <code>hane serve</code> na porta 7788.</EmptyMini>}
        {loaded && !noMissions && visible.length === 0 && <EmptyMini Icon={MagnifyingGlass} title="Nada encontrado" action={{ label: "Limpar", onClick: () => { setQuery(""); searchRef.current?.focus(); } }}>Nenhuma execução combina com “{query}”.</EmptyMini>}
        {loaded && noMissions && <EmptyMini Icon={Sparkle} title="Nenhuma execução" action={{ label: "Criar", onClick: focusComposer }}>Escreva um objetivo no campo abaixo.</EmptyMini>}
        {runsExpanded && visible.map((item) => {
          const [label, chip] = statusInfo(item.status);
          return <button className={`conversation-row ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => {setActiveAgentId(null);setActiveGroupId(null);setSelectedId(item.id);setViewMode('missao');}} title={item.objective}>
            <Stack mission={item.id === mission?.id ? mission : null} currentRole={item.id === mission?.id ? currentRole : null} /><span className="conversation-copy"><strong>{item.objective}</strong><small>{label} · {item.providerCalls}/{item.maxProviderCalls} chamadas</small></span><time>{clock(item.updatedAt)}</time>
          </button>;
        })}
      </nav>

      <footer className="sidebar-footer"><button onClick={() => openSection("agents")} aria-label="Biblioteca de agentes"><UsersThree/><span><strong>Biblioteca de agentes</strong><small>{library.agents.length} perfis locais</small></span></button><button onClick={() => openSection("monitor")} aria-label="Monitor de execução"><Clock/><span><strong>Monitor de execução</strong><small>Histórico real do runtime</small></span></button>
        <button aria-label={`Provedores: ${providers.length} configurado${providers.length === 1 ? "" : "s"}${chosenProvider ? `, ${chosenProvider} ativo` : ""}`} onClick={() => setPopover("providers")}><Clock /><span><strong>Provedores</strong><small>{providers.length} configurado{providers.length === 1 ? "" : "s"}{chosenProvider ? ` · ${chosenProvider} ativo` : ""}</small></span><CaretRight /></button>
      {personalProfile && <ProfileMenu profile={personalProfile} onSection={openSection} onLock={onLockProfile}/>}</footer>
    </aside>

    {showConversation ? <AgentConversation key={activeGroup?.id||activeAgent?.id} agent={activeAgent} group={activeGroup} library={library} providers={providers} personalProfile={personalProfile} onEditAgent={editAgent} onEditGroup={()=>openSection("agents")} serverWorkspace={serverWorkspace} onStartExecution={focusComposer}/> : <section className="conversation-view">
      <header className="conversation-header">{showOnboarding ? <Avatar person={onboardingAgent} size="sm" state="thinking" /> : <Stack mission={mission} currentRole={currentRole} />}<span className="conversation-title"><strong>{activeGroup?.name ?? mission?.objective ?? (showOnboarding ? "Hane" : missions?.length ? "Selecione uma execução" : "Descreva uma execução abaixo")}</strong><small><i /> {mission ? `${selectedLabel} · ${mission.providerCalls}/${mission.maxProviderCalls} chamadas` : showOnboarding ? "guia para configurar e usar o Hane" : "equipe: planejador, executor, revisor"}</small></span>{mission && <Status kind={selectedChip}>{selectedLabel}</Status>}{activeGroup && <button type="button" onClick={()=>setViewMode('conversa')}>Conversar</button>}{activeGroup && <button className="icon-button" aria-label="Configurar grupo" onClick={() => openSection("agents")}><GearSix/></button>}</header>
      <div className="messages" ref={messagesRef}>{libraryError && <p className="composer-error" role="alert">{libraryError} <button onClick={()=>setRetryTick(v=>v+1)}>Tentar novamente</button></p>}{(legacy?.agents?.length>0 || legacy?.groups?.length>0) && <p className="settings-description">Há uma biblioteca antiga neste navegador. <button onClick={()=>openSection('agents')}>Revisar importação</button></p>}{persistenceError && <p className="composer-error" role="alert">{persistenceError}</p>}{activeGroup && <div className="group-context"><strong>{activeGroup.description || "Grupo local"}</strong><div>{library.agents.filter(a => activeGroup.members.includes(a.id)).map(a => <span key={a.id}><HaneAvatar agentId={a.id} name={a.name} color={a.color} shape={a.shape} image={a.image} size={28}/>{a.name}{activeGroup.leader===a.id?" · líder":""}</span>)}</div><small>Escolha abaixo um preset de execução. Nas conversas, cada integrante responde com sua identidade. A liderança não atribui etapas automaticamente.</small></div>}
        {loaded && !mission && !selectedId && !showOnboarding && <EmptyStage Icon={Sparkle} title={activeGroup ? activeGroup.name : personalProfile ? `Bem-vindo, ${personalProfile.displayName}.` : "Seu espaço para colaborar"} action={{ label: activeGroup ? "Escrever objetivo" : "Criar grupo", onClick: activeGroup ? focusComposer : () => openSection("agents") }}>Organize agentes em grupos, configure um provedor e descreva o próximo objetivo. Você decide quando começar.</EmptyStage>}
        {missions === null && <EmptyStage Icon={CircleNotch} title="Consultando o Hane…">Lendo o arquivo de execuções local para montar a trilha.</EmptyStage>}
        {offline && <EmptyStage Icon={Plugs} title="API do Hane indisponível" commands={["hane serve --port 7788"]} action={{ label: "Tentar de novo", onClick: reload }} onCopy={copyNotice}>
          A interface fala apenas com o servidor local. Inicie o <code>hane serve</code> e reconecte para ver as execuções reais.
        </EmptyStage>}
        {loaded && mission && <>
          <div className="day-divider"><span>Hoje</span></div>
          <RiseIn className="user-message" key={`objective-${mission.id}`}><small>{personalProfile && <PersonalAvatar profile={personalProfile}/>} {personalProfile?.displayName || "Você"} · {clock(mission.audit?.at(-1)?.at)}{mission.providerLabel ? ` · ${mission.executionPlan ? "preset do grupo" : "provedor "+mission.providerLabel}` : ""}</small><p>{mission.objective}</p></RiseIn>
          {ROLE_ORDER.map((role) => {
            const person = missionPerson(mission,role);
            const output = mission.outputs?.[role];
            const failed = mission.audit?.find((entry) => entry.type === "provider_call_failed" && entry.detail?.role === role);
            const avatarState = avatarStateFromMission({ mission, role, currentRole });
            if (failed) return <article className="message" data-output={role} key={`${mission.id}-${role}`}><Avatar person={person} state={avatarState} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="attention">Falhou</Status></header><p>{failed.detail.message}</p></div></article>;
            if (output !== undefined) return <article className="message" data-output={role} key={`${mission.id}-${role}`}><Avatar person={person} state={avatarState} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="done">Concluído</Status></header><p className="output-text">{output}</p></div></article>;
            if (isActive(mission.status) && role === currentRole) return <article className="message" data-output={role} key={`${mission.id}-${role}`}><Avatar person={person} state={avatarState} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="running">Trabalhando</Status></header><p><Spinner /> Gerando a saída de {person.job.toLowerCase()}…</p></div></article>;
            return null;
          })}
          {["completed", "needs_attention", "failed", "awaiting_approval"].includes(mission.status) && <div className="handoff-card"><span><Avatar person={missionPerson(mission,"reviewer")} size="xs" /><CaretRight /><Avatar person={{ name: "Você", job: "", tone: "pink", Icon: Check }} size="xs" /></span><span><strong>{selectedLabel}</strong><small>{verdictEntry ? `Veredito do revisor: ${verdictEntry.detail.verdict}` : mission.status === "needs_attention" ? "Orçamento esgotado ou revisão pendente de atenção." : "Acompanhe os artefatos no painel direito."}</small></span><Status kind={selectedChip}>{selectedLabel}</Status></div>}
        </>}
        {loaded && !mission && selectedId && <EmptyStage Icon={Warning} title="Esta execução não está no arquivo" commands={[`hane mission ${selectedId}`]} action={{ label: "Recarregar", onClick: reload }} onCopy={copyNotice}>
          Pode ter sido removida do SQLite local. Recarregue para sincronizar a lista.
        </EmptyStage>}
        {showOnboarding && !mission && !selectedId && <OnboardingMessage step={onboardingStep} hasProvider={!noProviders} github={onboarding.github} githubAvailable={onboarding.githubAvailable} githubDevice={githubDevice} workspace={workspace} busy={onboardingBusy} onOpenProviders={() => setPopover("providers")} onCopy={copyNotice} onRequestWorkspace={requestWorkspacePermission} onConnectGitHub={connectGitHub} onCheckGitHub={checkGitHubAuthorization} onAdvance={advanceOnboarding} onCreateMission={beginFirstMission} onCreateAnother={() => setOnboardingStep(4)} profile={profileDraft} onProfileChange={setProfileDraft} onCreateProfile={createCustomHane} />}
      </div>

      {popover && <div className="pop-backdrop" onClick={() => setPopover(null)} />}
      {popover === "attach" && <div className="pop" role="dialog" aria-label="Anexar contexto">
        <header><strong>Anexar ao workspace</strong><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        <p>Escolha um arquivo ou pasta no seu computador. O item ficará disponível para leitura nesta execução.</p>
        <button ref={attachChoiceRef} type="button" className="pop-row" disabled={pickerBusy || sending || offline} onClick={() => attachWorkspace('file')}><span className="setting-icon"><FileText /></span><span><strong>Escolher arquivo</strong><small>Ler somente o arquivo selecionado</small></span><CaretRight /></button>
        <button type="button" className="pop-row" disabled={pickerBusy || sending || offline} onClick={() => attachWorkspace('directory')}><span className="setting-icon"><FolderOpen /></span><span><strong>Escolher pasta</strong><small>Ler a pasta e seus arquivos</small></span><CaretRight /></button>
        {pickerBusy && <p role="status">Aguardando o seletor do sistema… cancele na janela para voltar.</p>}
        {attachmentError && <p className="attachment-error" role="alert">{attachmentError}</p>}
        {offline && <p role="status">Conecte ao servidor local para escolher arquivos.</p>}
        {composerWorkspace.root && <p className="pop-root"><FolderOpen /> Raiz da execução: <code title={composerWorkspace.root}>{composerWorkspace.root}</code></p>}
        <p className="pop-note">Anexar autoriza leitura ao enviar. Arquivos sensíveis continuam protegidos. No preset de equipe, o executor também precisa da capacidade de leitura.</p>
        <details className="attachment-text"><summary>Colar texto como contexto</summary>
        <textarea ref={contextRef} value={contextDraft} maxLength={MAX_CONTEXT_CHARS} placeholder="Cole aqui o contexto…" onChange={(event) => setContextDraft(event.target.value)} />
        <footer><small>{contextDraft.length} / {MAX_CONTEXT_CHARS}</small><button type="button" className="pop-primary" disabled={pickerBusy || contextDraft.trim().length < 3} onClick={addContext}><Plus weight="bold" /> Anexar à execução</button></footer></details>
      </div>}
      {popover === "mention" && <div className="pop" role="dialog" aria-label="Mencionar">
        <header><strong>Mencionar</strong><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        <span className="pop-label">Papéis da equipe · insere no texto</span>
        {ROLE_ORDER.map((role) => <button type="button" className="pop-row" key={role} onClick={() => insertMention(roles[role].name)}>
          <Avatar person={roles[role]} size="xs" /><span><strong>{roles[role].name}</strong><small>{roles[role].job}</small></span><CaretRight />
        </button>)}
        <span className="pop-label">Agente desta execução · define o provedor</span>
        {noProviders && <PanelEmpty>Nenhum provedor configurado · rode <code>hane provider add</code>.</PanelEmpty>}
        {providers.map((item) => <button type="button" className={`pop-row ${chosenProvider === item.label ? "on" : ""}`} key={item.label} onClick={() => pickProvider(item.label)}>
          <Avatar person={{ name: item.label, job: item.model, tone: "peach", Icon: At }} size="xs" /><span><strong>{item.label}</strong><small>{item.model}</small></span>
          {chosenProvider === item.label ? <Check weight="bold" /> : <CaretRight />}
        </button>)}
      </div>}
      {popover === "capabilities" && <div className="pop pop-wide" role="dialog" aria-label="Perexecuções da execução">
        <header><strong>Perexecuções da execução</strong><span className="pop-count">{capabilityGrants.length}</span><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        <p>Você está definindo o teto de acesso desta execução. A leitura de arquivos é aplicada pelo runtime dentro da raiz concedida; escrita, comandos e acesso externo não são executados.</p>
        <p className="pop-scope">O escopo <code>.</code> permite ler toda a raiz indicada abaixo. Anexar um arquivo ou pasta concede apenas o escopo escolhido.</p>
        {composerWorkspace.available && composerWorkspace.root && <p className="pop-root"><FolderOpen weight="fill" /> Raiz da execução: <code>{composerWorkspace.root}</code></p>}
        {CAPABILITY_OPTIONS.map((option) => {
          const selectable = isCapabilityEnabled(option, serverWorkspace);
          const enabled = capabilityGrants.some((grant) => grant.name === option.name && grant.scope === option.scope);
          return <button type="button" className={`pop-row ${enabled ? "on" : ""} ${selectable ? "" : "is-off"}`} key={option.name} disabled={!selectable} aria-disabled={!selectable} title={selectable ? undefined : WORKSPACE_DISABLED_HINT} onClick={() => toggleCapability(option)}>
            <span className="setting-icon"><ShieldCheck weight={enabled ? "fill" : "regular"} /></span><span><strong>{option.label}</strong><small>{selectable ? option.detail : WORKSPACE_ROW_HINT}</small></span>{enabled ? <Check weight="bold" /> : <CaretRight />}
          </button>;
        })}
        {!composerWorkspace.available && <p className="pop-note">{serverWorkspace.loaded ? WORKSPACE_DISABLED_HINT : "Consultando /api/workspace… enquanto o servidor não confirma uma raiz, leitura e escrita ficam desativadas."}</p>}
      </div>}
      {popover === "providers" && <div className="pop pop-wide" role="dialog" aria-label="Provedores configurados">
        <header><strong>Provedores</strong><span className="pop-count">{providers.length}</span><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        {noProviders && <PanelEmpty>Nada no arquivo local. Adicione um provedor para a equipe poder executar execuções.</PanelEmpty>}
        {providers.map((item) => <div className="provider-detail" key={item.label}>
          <strong>{item.label}</strong>
          <dl>
            <div><dt>Modelo</dt><dd>{item.model}</dd></div>
            <div><dt>Base URL</dt><dd>{item.baseUrl}</dd></div>
            <div><dt>Credencial</dt><dd>{item.credentialReference}</dd></div>
            {item.maxTokens ? <div><dt>max_tokens</dt><dd>{item.maxTokens}</dd></div> : null}
          </dl>
          <button type="button" className="pop-mini" onClick={() => pickProvider(item.label)}>{chosenProvider === item.label ? "Remover da próxima execução" : "Usar na próxima execução"}</button>
        </div>)}
        <footer className="pop-commands">
          <CmdLine command="hane provider add --label <nome> --base-url <url> --model <id>" onCopy={copyNotice} />
          <CmdLine command="hane provider set-secret <nome>" onCopy={copyNotice} />
          <button type="button" className="pop-mini" onClick={reload}><ArrowsClockwise /> Recarregar</button>
        </footer>
      </div>}

      <form className="composer-wrap" ref={formRef} onSubmit={send}>
        {loaded && noProviders && <div className="composer-warning"><Warning /> Nenhum agente · as execuções ficam sem executor até <code>hane provider add</code> <button type="button" className="link-action" onClick={() => setPopover("providers")}>ver detalhes</button></div>}
        {(attachments.length > 0 || chosenProvider || capabilityGrants.length > 0) && <div className="chip-row">
          {chosenProvider && <span className="chip"><At weight="bold" />{chosenProvider}<button type="button" aria-label="Liberar provedor" onClick={() => setChosenProvider(null)}><X /></button></span>}
          {attachments.map((item, index) => <span className="chip" key={item.id} title={item.path || undefined}>{item.scope ? item.kind === "directory" ? <FolderOpen /> : <FileText /> : <Paperclip />}{item.scope ? <><span className="attachment-name">{item.name}</span> · leitura</> : <>Contexto {index + 1} · {item.text.length} car.</>}<button type="button" aria-label={item.scope ? `Remover ${item.name}` : "Remover contexto"} onClick={() => removeAttachment(item.id)}><X /></button></span>)}
          {capabilityGrants.map((grant) => <span className="chip" key={`${grant.name}-${grant.scope}`}><ShieldCheck weight="bold" />{CAPABILITY_OPTIONS.find((item) => item.name === grant.name)?.label ?? grant.name}<button type="button" aria-label={`Remover ${grant.name}`} onClick={() => setCapabilityGrants((current) => current.filter((item) => item.name !== grant.name || item.scope !== grant.scope))}><X /></button></span>)}
        </div>}
        {createError && <div className="composer-error" role="alert"><Warning /><span><strong>Execução não enviada</strong><small>{createError}</small></span><button type="button" className="link-action" onClick={() => setCreateError("")}>dispensar</button></div>}
        {activeGroup && <details className="execution-preset-wrap" open={!mission}><summary>Configurar próxima execução</summary><fieldset className="execution-preset" disabled={sending || Boolean(activeGroup.archivedAt)}>
          <legend>Preset da próxima execução</legend>
          <label>Modo<select aria-label="Modo de execução" value={executionMode} onChange={e=>setExecutionMode(e.target.value)}><option value="standard">Etapas padrão</option><option value="team-preset" disabled={activeGroup.members.length<3}>Integrantes do grupo · três etapas</option></select></label>
          {executionMode==='team-preset' && <>{ROLE_ORDER.map(role=><label key={role}>{roles[role].job}<select aria-label={roles[role].job+' do preset'} value={roleAssignments[role]} onChange={e=>setRoleAssignments(v=>({...v,[role]:e.target.value}))}><option value="">Escolher integrante</option>{library.agents.filter(a=>activeGroup.members.includes(a.id)).map(a=><option key={a.id} value={a.id} disabled={ROLE_ORDER.some(r=>r!==role && roleAssignments[r]===a.id)}>{a.name} · {a.providerLabel || chosenProvider || general.defaultProvider || 'provedor da execução'}</option>)}</select></label>)}<p>Somente os três escolhidos executam: planejamento → execução → revisão. Instruções e provedores ficam registrados; apenas o executor pode ler arquivos, com capacidade e permissão explícitas.</p></>}
          {activeGroup.members.length<3 && <p>Este preset precisa de três integrantes diferentes. A conversa individual ou de grupo continua disponível.</p>}
        </fieldset></details>}
        <div className="composer"><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); formRef.current?.requestSubmit(); } }} placeholder="Descreva uma execução para a equipe Hane..." /><div><span className="composer-tools"><button type="button" className={popover === "attach" ? "on" : ""} aria-label="Anexar contexto" aria-expanded={popover === "attach"} onClick={() => togglePopover("attach")}><Paperclip /></button><button type="button" className={popover === "mention" ? "on" : ""} aria-label="Mencionar papel ou agente" aria-expanded={popover === "mention"} onClick={() => togglePopover("mention")}><At /></button><button type="button" className={popover === "capabilities" ? "on" : ""} aria-label="Definir permissões da execução" aria-expanded={popover === "capabilities"} onClick={() => togglePopover("capabilities")}><ShieldCheck /></button></span><small>{sending ? "enviando…" : `${MOD_KEY} Enter`}</small><button ref={sendRef} className="send-button" aria-label="Criar execução" disabled={sending || pickerBusy || Boolean(activeGroup?.archivedAt)}><PaperPlaneRight weight="fill" /></button></div></div>
        <small>{activeGroup?.archivedAt ? "Grupo arquivado. O histórico permanece disponível; novas execuções estão bloqueadas." : <>Cada envio inicia o preset escolhido: planejamento, execução e revisão{activeGroup ? " vinculada a este grupo." : "."}</>}</small>
      </form>
      <button ref={panelTriggerRef} type="button" className={`panel-reopen ${panelOpen ? "" : "visible"}`} aria-controls="hane-mission-context" aria-label="Mostrar painel de contexto" aria-expanded={panelOpen} title="Mostrar painel (Ctrl + \)" tabIndex={panelOpen ? -1 : 0} onClick={() => setPanelOpen(true)}><CaretLeft /></button>
    </section>}

    <aside id="hane-mission-context" className="right-panel" aria-label="Contexto da execução" aria-hidden={!panelOpen} inert={panelOpen ? undefined : ""}><header><span><strong>Contexto da execução</strong><small>{mission ? clock(mission.audit?.at(-1)?.at) || "agora" : "sem execução ativa"}</small></span><button type="button" aria-controls="hane-mission-context" aria-label="Ocultar painel de contexto" aria-expanded={panelOpen} title="Ocultar painel (Ctrl + \)" onClick={closeContextPanel}><CaretRight /></button></header><div className="panel-scroll">
      <section className="panel-section live-computer"><div className="panel-title"><strong>Computador ao vivo</strong><span>{GATED_CAPABILITIES_NOTE}</span></div>
        <div className="computer-preview" aria-label="Eventos auditáveis da sessão da execução">
          <div className="window-bar"><span /><span /><span /><small>{mission ? "eventos persistidos da execução" : "sem sessão ativa"}</small></div>
          <div className="window-body"><div><i /><i /><i /></div><pre>{sessionEvents.length ? sessionEvents.map((line, index) => <span key={`${line}-${index}`}>{line}{"\n"}</span>) : <span>Nenhuma sessão de ferramentas disponível.\nOs próximos eventos auditáveis aparecem aqui.</span>}</pre></div>
          <div className="evidence-list">
            <header><strong>Evidências de ferramentas</strong><span>{evidence.length} registro{evidence.length === 1 ? "" : "s"}</span></header>
            {evidence.length ? evidence.map((row) => {
              const roleName = row.role ? missionPerson(mission,row.role)?.name ?? row.role : null;
              return <div className={`evidence-row ${row.kind}`} key={row.id}>
                <span className="evidence-icon">{row.kind === "denied" ? <X weight="bold" /> : row.kind === "read" ? <FileText /> : row.kind === "listing" ? <FolderOpen /> : <Warning />}</span>
                <span className="evidence-copy"><strong>{row.label}</strong>{row.path && <code title={row.path}>{row.path}</code>}{row.meta && <span className="evidence-meta">{row.meta}</span>}{row.marker && <em className="evidence-flag">{row.marker}</em>}{roleName && <em className="evidence-role">{roleName}</em>}</span>
                <time>{row.at ? clock(row.at) : ""}</time>
              </div>;
            }) : <p className="evidence-empty">{mission ? "Nenhum acesso a ferramentas registrado nesta execução até agora." : "As leituras reais de arquivos aparecem aqui quando a execução recebe workspace.read."}</p>}
          </div>
          <div className="preview-caption"><span>A leitura de arquivos funciona sob grant explícito; escrita, comandos e rede não são executados.</span><span>{mission ? `${mission.providerCalls}/${mission.maxProviderCalls} chamadas${toolUsage ? ` · ${toolUsage} ferramentas` : ""}` : "—"}</span></div>
        </div>
      </section>
      <section className="panel-section active-agents"><div className="panel-title"><strong>{showOnboarding ? "Guia de início" : "Etapas da equipe"}</strong><span>{showOnboarding ? "primeira vez" : mission ? selectedLabel : "—"}</span></div>{showOnboarding ? <div className="active-agent"><Avatar person={onboardingAgent} size="sm" state="thinking" /><span><strong>Hane</strong><small>Pronto para orientar você</small></span><i className="ready-dot" /></div> : ROLE_ORDER.map((role) => {
        const person = missionPerson(mission,role);
        const done = mission?.outputs?.[role] !== undefined;
        const working = mission && isActive(mission.status) && role === currentRole;
        return <div className="active-agent" key={role}><Avatar person={person} size="sm" state={avatarStateFromMission({ mission, role, currentRole })} /><span><strong>{person.name}</strong><small>{done ? "Saída registrada" : working ? "Trabalhando agora" : mission ? "Sem saída ainda" : "Aguardando execução"}</small></span>{working && <i />}</div>;
      })}</section>
      <section className="panel-section"><div className="panel-title"><strong>Perexecuções</strong><span>{mission?.capabilityGrants?.length ?? 0} concedida{mission?.capabilityGrants?.length === 1 ? "" : "s"}</span></div>
        {mission?.capabilityGrants?.length ? mission.capabilityGrants.map((grant) => <div className="active-agent" key={`${grant.name}-${grant.scope}`}><span className="setting-icon"><ShieldCheck weight="fill" /></span><span><strong>{CAPABILITY_OPTIONS.find((item) => item.name === grant.name)?.label ?? grant.name}</strong><small>{grantDisplay(grant)}</small></span></div>) : <PanelEmpty>Esta execução não recebeu acesso a workspace, comandos ou rede.</PanelEmpty>}
        {mission && <dl className="workspace-state">
          <div><dt>Raiz do workspace</dt><dd>{workspaceRootLabel(mission.workspaceRoot)}</dd></div>
          <div><dt>Chamadas de ferramenta</dt><dd>{toolUsage ?? "não informado"}</dd></div>
        </dl>}
      </section>
      <section className="panel-section"><div className="panel-title"><strong>Progresso</strong><span>{progressPct}%</span></div>
        {mission ? <>
          <div className="progress-track"><i ref={barRef} /></div>
          <div className="progress-meta"><span>{mission.providerCalls} de {mission.maxProviderCalls} chamadas</span><span>orçamento {mission.maxProviderCalls}</span></div>
        </> : <PanelEmpty>Escolha ou crie uma execução para ver o consumo do orçamento de chamadas.</PanelEmpty>}
        <button className="secondary-action" disabled={!mission} onClick={() => { if (mission) { copyText(mission.id).then((ok) => notify(ok ? `ID da execução copiado: ${mission.id.slice(0, 8)}…` : "O navegador bloqueou a área de transferência.")); } }}>Copiar ID da execução <CaretRight /></button>
      </section>
      <section className="panel-section artifacts"><div className="panel-title"><strong>Artefatos gerados</strong><span>{outputs.length} saída{outputs.length === 1 ? "" : "s"}</span></div>
        {outputs.length === 0 && <PanelEmpty>{mission ? "Nenhum papel registrou saída nesta execução até agora." : "Os artefatos dos papéis técnicos aparecem aqui quando a execução roda."}</PanelEmpty>}
        {outputs.map((role) => <Artifact key={role} type={role === "planner" ? "doc" : role === "executor" ? "json" : "secure"} title={`${missionPerson(mission,role).name} · ${missionPerson(mission,role).job}`} meta={`${mission.outputs[role].length} caracteres · abrir na trilha`} onOpen={() => focusOutput(role)} />)}
      </section>
      <section className="approval-card"><div><span>{mission?.status === "completed" ? <Check /> : mission?.status === "needs_attention" || mission?.status === "failed" ? <Warning /> : <Sparkle />}</span><span><strong>{mission ? selectedLabel : "Nenhuma execução"}</strong><small>{mission?.status === "completed" ? "O veredito do revisor encerrou a execução." : mission?.status === "awaiting_approval" ? "O revisor pediu revisão humana. Aprovar custa mais 2 chamadas." : mission?.status === "needs_attention" ? "Atenção: veredito sinalizado ou orçamento esgotado." : mission?.status === "failed" ? "Uma etapa falhou. Refazer continua de onde parou." : mission?.status === "cancelled" ? "A execução foi cancelada e o histórico foi preservado." : mission ? "Acompanhe os eventos auditáveis da execução." : offline ? "Sem conexão com o hane serve." : noProviders ? "Sem agente configurado para executar execuções." : "Envie uma execução para começar."}</small></span></div>{mission?.status === "awaiting_approval" ? <button ref={approvalRef} disabled={actionBusy} onClick={() => act("approve")}>{actionBusy ? <Spinner /> : <Check />} Revisar e aprovar</button> : cancellable ? <button disabled={actionBusy} onClick={() => act("cancel")}>{actionBusy ? <Spinner /> : <Warning />}{actionBusy ? " Cancelando…" : " Cancelar execução"}</button> : retryable ? <button disabled={actionBusy} onClick={() => act("retry")}>{actionBusy ? <Spinner /> : <Sparkle />}{actionBusy ? " Refazendo…" : " Refazer etapa"}</button> : <Status kind={mission ? selectedChip : "queued"}>{mission ? selectedLabel : "ociosa"}</Status>}</section>
    </div></aside>
    {toast && <div className="toast" ref={toastRef}><Check /> {toast}</div>}
  </main>;
}
