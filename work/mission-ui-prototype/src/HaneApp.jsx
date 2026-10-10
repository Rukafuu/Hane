import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise, ArrowSquareOut, At, BracketsCurly, CaretRight, Check, CircleNotch, Clock, Code,
  CopySimple, FileText, FolderOpen, MagnifyingGlass, PaperPlaneRight, Paperclip, Plugs, Plus, Sparkle,
  GearSix, ShieldCheck, UsersThree, Warning, X,
} from "@phosphor-icons/react";
import {
  approvePop, entrance, flash, growBar, pop, pulseLoop, reduceMotion, rise, spinLoop, spinOnce, staggerIn, toastOut,
} from "./motion.js";
import { approveMission, cancelMission, createMission, fetchMission, fetchMissions, fetchProviders, fetchWorkspace, openMissionEvents, retryMission } from "./api.js";
import { HaneAvatar } from "./HaneAvatar.jsx";
import { avatarStateFromMission } from "./avatar-runtime.js";
import { CAPABILITY_OPTIONS, GATED_CAPABILITIES_NOTE, WORKSPACE_DISABLED_HINT, WORKSPACE_ROW_HINT, capabilityPayload, evidenceRows, grantDisplay, isCapabilityEnabled, toolUsageLabel, workspaceRootLabel } from "./workspace-evidence.js";

// The mission roles deliberately retain the real planner → executor → reviewer
// contract.  `face` only changes their presentation to the Figma Make avatar
// language; it must not be used as an identity or permission signal.
const roles = {
  planner: { name: "Orion", job: "Planejamento", tone: "lilac", shape: "petal", color: "#b9a4d9", Icon: UsersThree },
  executor: { name: "Byte", job: "Execução", tone: "blue", shape: "drop", color: "#8aa9c9", Icon: Code },
  reviewer: { name: "Cipher", job: "Revisão", tone: "mint", shape: "cloud", color: "#9bbfae", Icon: ShieldCheck },
};
const onboardingAgent = { name: "Hane", job: "Guia de início", tone: "pink", shape: "pebble", color: "#e66f98", Icon: Sparkle };
const ROLE_ORDER = ["planner", "executor", "reviewer"];
const CONNECTOR_CATALOG = Object.freeze([
  { id: "github", name: "GitHub", detail: "Repositórios, issues e pull requests", mode: "API / OAuth", status: "Ainda não integrado" },
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

function toSummary(task) {
  return {
    id: task.id,
    objective: task.objective,
    status: task.status,
    maxProviderCalls: task.maxProviderCalls,
    providerCalls: task.providerCalls ?? 0,
    updatedAt: task.updatedAt ?? task.audit?.at(-1)?.at ?? null,
  };
}

function composeObjective(text, attachments) {
  if (attachments.length === 0) return text;
  const blocks = attachments.map((item) => item.text).join("\n\n");
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
  return <HaneAvatar agentId={person.name} name={person.name} shape={person.shape} color={person.color} state={state} size={dimensions[size] ?? 44} interactive={interactive} onClick={onClick} />;
}

function Stack({ mission, currentRole }) {
  return <span className="agent-stack">{ROLE_ORDER.map((role) => <Avatar key={role} person={roles[role]} size="xs" state={avatarStateFromMission({ mission, role, currentRole })} />)}</span>;
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

function OnboardingMessage({ hasProvider, onOpenProviders, onCreateMission, onCopy }) {
  return <article className="message onboarding-message">
    <Avatar person={onboardingAgent} state="thinking" />
    <div className="message-content">
      <header><strong>Hane</strong><small>Guia de início</small><Status kind={hasProvider ? "done" : "queued"}>{hasProvider ? "Pronto para começar" : "Primeira configuração"}</Status></header>
      <p>Bem-vindo. Eu vou te ajudar a preparar a primeira missão e entender como a equipe trabalha.</p>
      <ol className="onboarding-steps">
        <li>
          <strong>Conecte um provedor</strong>
          <p>{hasProvider ? "Um provedor já está configurado. Você pode escolher outro para a próxima missão quando quiser." : "Cadastre um provedor compatível com OpenAI e guarde a chave no Gerenciador de Credenciais do Windows."}</p>
          {hasProvider ? <button type="button" className="onboarding-action" onClick={onOpenProviders}>Ver provedores <CaretRight /></button> : <div className="onboarding-commands"><CmdLine command="node bin/hane.js provider add --label <nome> --base-url <url> --model <id>" onCopy={onCopy} /><CmdLine command="node bin/hane.js provider set-secret <nome>" onCopy={onCopy} /></div>}
        </li>
        <li>
          <strong>Descreva e execute uma missão</strong>
          <p>Escreva um objetivo claro no campo abaixo. O Hane salva a missão localmente e inicia a equipe com o provedor que você escolheu.</p>
          <button type="button" className="onboarding-action primary" onClick={onCreateMission}>Escrever primeira missão <CaretRight /></button>
        </li>
        <li>
          <strong>Acompanhe e revise</strong>
          <p>Orion planeja, Byte executa e Cipher revisa. As saídas ficam na trilha da missão e ações importantes continuam pedindo sua aprovação.</p>
        </li>
      </ol>
    </div>
  </article>;
}

function PanelEmpty({ children }) {
  return <p className="panel-empty">{children}</p>;
}

function auditSummary(entry) {
  const role = entry.detail?.role ? `${roles[entry.detail.role]?.name ?? entry.detail.role} · ` : "";
  if (entry.type === "task_created") return "Missão registrada no armazenamento local.";
  if (entry.type === "state_changed") return `${role}estado: ${entry.detail?.nextStatus ?? "atualizado"}.`;
  if (entry.type === "provider_call_reserved") return `${role}chamada ${entry.detail?.providerCall ?? ""} reservada.`;
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

function SettingsSheet({ providers, onBack, onProviders }) {
  return <main className="settings-sheet" aria-label="Configurações do Hane">
    <section><header><strong>Configurações do Hane</strong><button type="button" onClick={onBack}>Voltar à missão <CaretRight /></button></header>
      <p className="settings-intro">Configurações globais ficam separadas do contexto da missão. Credenciais nunca entram nesta tela.</p>
    </section>
    <section><header><strong>Provedores de IA</strong><button type="button" onClick={onProviders}>Gerenciar <CaretRight /></button></header>
      <div className="settings-row"><span className="setting-icon"><At weight="bold" /></span><span><strong>{providers.length} configurado{providers.length === 1 ? "" : "s"}</strong><small>{providers.length ? providers.map((item) => item.label).join(", ") : "Adicione via CLI; a UI não recebe segredos."}</small></span></div>
    </section>
    <section><header><strong>Conectores</strong><span className="settings-muted">catálogo inicial</span></header>
      <p className="settings-intro">Conectores só poderão ser usados após credencial, escopo por missão e aprovação humana por ação.</p>
      {CONNECTOR_CATALOG.map((connector) => <div className="settings-row" key={connector.id}><span className="setting-icon"><Plugs weight="bold" /></span><span><strong>{connector.name}</strong><small>{connector.detail} · {connector.mode}</small></span><em>{connector.status}</em></div>)}
    </section>
    <section><header><strong>Segurança e acessibilidade</strong></header>
      <div className="settings-row"><span className="setting-icon"><ShieldCheck weight="fill" /></span><span><strong>Aprovação explícita</strong><small>Escrita, comandos e rede continuam limitados pela missão e exigem revisão.</small></span></div>
    </section>
  </main>;
}

export function HaneApp() {
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
  const [capabilityGrants, setCapabilityGrants] = useState([]);
  // Root owned by the server itself (GET /api/workspace). Unknown until fetched,
  // and a missing route stays "unavailable" rather than optimistic.
  const [serverWorkspace, setServerWorkspace] = useState({ available: false, root: null, loaded: false });
  const [createError, setCreateError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
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
  const gearRef = useRef(null);
  const formRef = useRef(null);
  const rowIdsRef = useRef("");
  selectedRef.current = selectedId;

  const visible = useMemo(() => (missions ?? []).filter((item) => `${item.objective} ${item.id}`.toLowerCase().includes(query.toLowerCase())), [missions, query]);
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
  const showOnboarding = loaded && noMissions;
  const observedRole = currentRole ?? outputs.at(-1) ?? "planner";
  const sessionEvents = mission?.audit?.slice(-4).map((entry) => `${clock(entry.at)}  ${auditSummary(entry)}`) ?? [];
  const evidence = useMemo(() => evidenceRows(mission), [mission]);
  const toolUsage = toolUsageLabel(mission);

  useEffect(() => {
    const runs = entrance(rootRef.current);
    return () => runs.forEach((animation) => animation.revert());
  }, []);

  useEffect(() => {
    let alive = true;
    fetchWorkspace().then((data) => { if (alive) setServerWorkspace({ ...data, loaded: true }); });
    Promise.all([fetchMissions(), fetchProviders()])
      .then(([missionData, providerData]) => {
        if (!alive) return;
        setOffline(false);
        setMissions(missionData.missions);
        setProviders(providerData.providers);
        setSelectedId((current) => current ?? missionData.missions[0]?.id ?? null);
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
      if (event.key !== "Escape") return;
      if (popover) setPopover(null);
      else if (document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [popover]);

  useEffect(() => {
    const root = rootRef.current;
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
    const animation = staggerIn(rootRef.current.querySelectorAll(".conversation-row"), { y: 8, step: 22, duration: 260 });
    return () => animation?.revert();
  }, [visible]);

  useEffect(() => {
    const root = rootRef.current;
    const scope = root.querySelector(".messages");
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
    if (popover === "attach") contextRef.current?.focus();
    if (popover === "mention") composerRef.current?.focus();
  }, [popover]);

  function notify(message) {
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
    notify("Recarregando missões e agentes");
  }

  function focusComposer() {
    setSelectedId(null);
    composerRef.current?.focus();
  }

  function togglePopover(kind) {
    setContextDraft("");
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

  function removeAttachment(id) {
    setAttachments((items) => items.filter((item) => item.id !== id));
  }

  function pickProvider(label) {
    const next = chosenProvider === label ? null : label;
    setChosenProvider(next);
    setPopover(null);
    notify(next ? `Próxima missão usa ${next}` : "Provedor liberado · a API usa o padrão");
  }

  function toggleCapability(option) {
    if (!isCapabilityEnabled(option, serverWorkspace)) return;
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
    const objective = composeObjective(draft.trim(), attachments);
    if (objective.length < 3) {
      notify("Descreva a missão em pelo menos três caracteres.");
      composerRef.current?.focus();
      return;
    }
    if (objective.length > MAX_OBJECTIVE_CHARS) {
      notify("Contexto grande demais · remova anexos antes de enviar.");
      return;
    }
    setSending(true);
    setCreateError("");
    try {
      const created = await createMission(objective, chosenProvider, capabilityPayload(capabilityGrants));
      setDraft("");
      setAttachments([]);
      setCapabilityGrants([]);
      setPopover(null);
      setOffline(false);
      setSelectedId(created.id);
      setMission(null);
      setMissions((items) => [toSummary({ ...created, providerCalls: 0, updatedAt: new Date().toISOString() }), ...(items ?? []).filter((item) => item.id !== created.id)]);
      pop(sendRef.current);
      notify("Missão criada · a equipe assumiu o trabalho");
    } catch (error) {
      // Shown inline, not only as a toast: a rejected mission has to stay on
      // screen with the wording the API actually returned.
      const detail = error instanceof Error && error.message ? error.message : "A API não respondeu.";
      setCreateError(detail);
      notify(`Falha ao criar a missão: ${detail}`);
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
        notify("Missão retomada");
      }
    } catch (error) {
      notify(`Falha: ${error.message}`);
    } finally {
      setActionBusy(false);
    }
  }

  if (showSettings) return <SettingsSheet providers={providers} onBack={() => setShowSettings(false)} onProviders={() => { setShowSettings(false); setPopover("providers"); }} />;

  return <main className="app-shell" ref={rootRef}>
    <aside className="left-sidebar">
      <div className="brand-row"><img src="/brand/hane-logo.png" alt="Hane" /><button ref={gearRef} className="icon-button" aria-label="Abrir configurações do Hane" onClick={() => setShowSettings(true)}><GearSix /></button></div>
      <label className="search-box"><MagnifyingGlass /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar missões" /><kbd>{MOD_KEY} K</kbd></label>
      <button className="new-chat" onClick={focusComposer}><span><Plus weight="bold" /></span>Nova missão<CaretRight /></button>

      <nav className="sidebar-scroll" aria-label="Agentes e missões">
        <header className="section-head"><span>AGENTES</span><button aria-label="Recarregar dados dos agentes" onClick={reload}><ArrowsClockwise /></button></header>
        {showOnboarding ? <button className="agent-nav selected" onClick={() => messagesRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>
          <Avatar person={onboardingAgent} size="sm" state="thinking" />
          <span><strong>Hane</strong><small>Guia de início</small></span>
          <i className="online" />
        </button> : ROLE_ORDER.map((role) => {
          const person = roles[role];
          const done = mission?.outputs?.[role] !== undefined;
          const working = mission && isActive(mission.status) && role === currentRole;
          return <button className={`agent-nav ${role === observedRole && mission ? "selected" : ""}`} key={role} onClick={() => {
            if (!mission) return notify("Abra ou crie uma missão para acompanhar o agente.");
            focusOutput(role);
          }}>
            <Avatar person={person} size="sm" state={avatarStateFromMission({ mission, role, currentRole })} />
            <span><strong>{person.name}</strong><small>{working ? "Executando agora" : done ? "Última saída pronta" : person.job}</small></span>
            {working ? <i className="online" /> : done ? <Check weight="bold" className="pick" /> : null}
          </button>;
        })}
        {loaded && noProviders && <EmptyMini Icon={Plugs} title="Nenhum provedor" action={{ label: "Detalhes", onClick: () => setPopover("providers") }}>
          Hane pode orientar você; conecte um provedor para executar missões.
        </EmptyMini>}
        <header className="section-head conversation-head"><span>MISSÕES</span><button aria-label="Nova missão" onClick={focusComposer}><Plus /></button></header>
        {missions === null && <small className="panel-note">Carregando…</small>}
        {offline && <EmptyMini Icon={Plugs} title="API do Hane offline" action={{ label: "Tentar", onClick: reload }}>Inicie com <code>hane serve</code> na porta 7788.</EmptyMini>}
        {loaded && !noMissions && visible.length === 0 && <EmptyMini Icon={MagnifyingGlass} title="Nada encontrado" action={{ label: "Limpar", onClick: () => { setQuery(""); searchRef.current?.focus(); } }}>Nenhuma missão combina com “{query}”.</EmptyMini>}
        {loaded && noMissions && <EmptyMini Icon={Sparkle} title="Nenhuma missão" action={{ label: "Criar", onClick: focusComposer }}>Escreva um objetivo no campo abaixo.</EmptyMini>}
        {visible.map((item) => {
          const [label, chip] = statusInfo(item.status);
          return <button className={`conversation-row ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)} title={item.objective}>
            <Stack mission={item.id === mission?.id ? mission : null} currentRole={item.id === mission?.id ? currentRole : null} /><span className="conversation-copy"><strong>{item.objective}</strong><small>{label} · {item.providerCalls}/{item.maxProviderCalls} chamadas</small></span><time>{clock(item.updatedAt)}</time>
          </button>;
        })}
      </nav>

      <footer className="sidebar-footer">
        <button onClick={() => setPopover("providers")}><Clock /><span><strong>Provedores</strong><small>{providers.length} configurado{providers.length === 1 ? "" : "s"}{chosenProvider ? ` · ${chosenProvider} ativo` : ""}</small></span><CaretRight /></button>
      </footer>
    </aside>

    <section className="conversation-view">
      <header className="conversation-header">{showOnboarding ? <Avatar person={onboardingAgent} size="sm" state="thinking" /> : <Stack mission={mission} currentRole={currentRole} />}<span className="conversation-title"><strong>{mission?.objective ?? (showOnboarding ? "Hane" : missions?.length ? "Selecione uma missão" : "Descreva uma missão abaixo")}</strong><small><i /> {mission ? `${selectedLabel} · ${mission.providerCalls}/${mission.maxProviderCalls} chamadas` : showOnboarding ? "guia para configurar e usar o Hane" : "equipe: planejador, executor, revisor"}</small></span>{mission && <Status kind={selectedChip}>{selectedLabel}</Status>}</header>
      <div className="messages" ref={messagesRef}>
        {missions === null && <EmptyStage Icon={CircleNotch} title="Consultando o Hane…">Lendo o arquivo de missões local para montar a trilha.</EmptyStage>}
        {offline && <EmptyStage Icon={Plugs} title="API do Hane indisponível" commands={["hane serve --port 7788"]} action={{ label: "Tentar de novo", onClick: reload }} onCopy={copyNotice}>
          A interface fala apenas com o servidor local. Inicie o <code>hane serve</code> e reconecte para ver as missões reais.
        </EmptyStage>}
        {loaded && mission && <>
          <div className="day-divider"><span>Hoje</span></div>
          <RiseIn className="user-message" key={`objective-${mission.id}`}><small>Você · {clock(mission.audit?.at(-1)?.at)}{mission.providerLabel ? ` · agente ${mission.providerLabel}` : ""}</small><p>{mission.objective}</p></RiseIn>
          {ROLE_ORDER.map((role) => {
            const person = roles[role];
            const output = mission.outputs?.[role];
            const failed = mission.audit?.find((entry) => entry.type === "provider_call_failed" && entry.detail?.role === role);
            const avatarState = avatarStateFromMission({ mission, role, currentRole });
            if (failed) return <article className="message" data-output={role} key={`${mission.id}-${role}`}><Avatar person={person} state={avatarState} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="attention">Falhou</Status></header><p>{failed.detail.message}</p></div></article>;
            if (output !== undefined) return <article className="message" data-output={role} key={`${mission.id}-${role}`}><Avatar person={person} state={avatarState} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="done">Concluído</Status></header><p className="output-text">{output}</p></div></article>;
            if (isActive(mission.status) && role === currentRole) return <article className="message" data-output={role} key={`${mission.id}-${role}`}><Avatar person={person} state={avatarState} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="running">Trabalhando</Status></header><p><Spinner /> Gerando a saída de {person.job.toLowerCase()}…</p></div></article>;
            return null;
          })}
          {["completed", "needs_attention", "failed", "awaiting_approval"].includes(mission.status) && <div className="handoff-card"><span><Avatar person={roles.reviewer} size="xs" /><CaretRight /><Avatar person={{ name: "Você", job: "", tone: "pink", Icon: Check }} size="xs" /></span><span><strong>{selectedLabel}</strong><small>{verdictEntry ? `Veredito do revisor: ${verdictEntry.detail.verdict}` : mission.status === "needs_attention" ? "Orçamento esgotado ou revisão pendente de atenção." : "Acompanhe os artefatos no painel direito."}</small></span><Status kind={selectedChip}>{selectedLabel}</Status></div>}
        </>}
        {loaded && !mission && selectedId && <EmptyStage Icon={Warning} title="Esta missão não está no arquivo" commands={[`hane mission ${selectedId}`]} action={{ label: "Recarregar", onClick: reload }} onCopy={copyNotice}>
          Pode ter sido removida do SQLite local. Recarregue para sincronizar a lista.
        </EmptyStage>}
        {loaded && !mission && !selectedId && !noMissions && <EmptyStage Icon={UsersThree} title="Selecione uma missão" action={{ label: "Abrir a mais recente", onClick: () => setSelectedId(missions[0].id) }}>
          Escolha uma missão na esquerda para ver planejador, executor e revisor trabalharem, ou crie uma nova abaixo.
        </EmptyStage>}
        {showOnboarding && !mission && !selectedId && <OnboardingMessage hasProvider={!noProviders} onOpenProviders={() => setPopover("providers")} onCreateMission={focusComposer} onCopy={copyNotice} />}
      </div>

      {popover && <div className="pop-backdrop" onClick={() => setPopover(null)} />}
      {popover === "attach" && <div className="pop" role="dialog" aria-label="Anexar contexto">
        <header><strong>Anexar contexto</strong><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        <p>Cole o contexto que a equipe deve ler: trechos, logs, requisitos ou um link. Nada é lido do disco — o texto segue no objetivo da missão.</p>
        <textarea ref={contextRef} value={contextDraft} maxLength={MAX_CONTEXT_CHARS} placeholder="Cole aqui o contexto…" onChange={(event) => setContextDraft(event.target.value)} />
        <footer><small>{contextDraft.length} / {MAX_CONTEXT_CHARS}</small><button type="button" className="pop-primary" disabled={contextDraft.trim().length < 3} onClick={addContext}><Plus weight="bold" /> Anexar à missão</button></footer>
      </div>}
      {popover === "mention" && <div className="pop" role="dialog" aria-label="Mencionar">
        <header><strong>Mencionar</strong><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        <span className="pop-label">Papéis da equipe · insere no texto</span>
        {ROLE_ORDER.map((role) => <button type="button" className="pop-row" key={role} onClick={() => insertMention(roles[role].name)}>
          <Avatar person={roles[role]} size="xs" /><span><strong>{roles[role].name}</strong><small>{roles[role].job}</small></span><CaretRight />
        </button>)}
        <span className="pop-label">Agente desta missão · define o provedor</span>
        {noProviders && <PanelEmpty>Nenhum provedor configurado · rode <code>hane provider add</code>.</PanelEmpty>}
        {providers.map((item) => <button type="button" className={`pop-row ${chosenProvider === item.label ? "on" : ""}`} key={item.label} onClick={() => pickProvider(item.label)}>
          <Avatar person={{ name: item.label, job: item.model, tone: "peach", Icon: At }} size="xs" /><span><strong>{item.label}</strong><small>{item.model}</small></span>
          {chosenProvider === item.label ? <Check weight="bold" /> : <CaretRight />}
        </button>)}
      </div>}
      {popover === "capabilities" && <div className="pop pop-wide" role="dialog" aria-label="Permissões da missão">
        <header><strong>Permissões da missão</strong><span className="pop-count">{capabilityGrants.length}</span><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        <p>Você está definindo o teto de acesso desta missão. A leitura de arquivos é aplicada pelo runtime dentro da raiz concedida; escrita, comandos e acesso externo não são executados.</p>
        <p className="pop-scope">O escopo <code>.</code> é a raiz que o servidor concede à missão; o navegador nunca envia um caminho absoluto.</p>
        {serverWorkspace.available && serverWorkspace.root && <p className="pop-root"><FolderOpen weight="fill" /> Raiz deste servidor: <code>{serverWorkspace.root}</code></p>}
        {CAPABILITY_OPTIONS.map((option) => {
          const selectable = isCapabilityEnabled(option, serverWorkspace);
          const enabled = capabilityGrants.some((grant) => grant.name === option.name && grant.scope === option.scope);
          return <button type="button" className={`pop-row ${enabled ? "on" : ""} ${selectable ? "" : "is-off"}`} key={option.name} disabled={!selectable} aria-disabled={!selectable} title={selectable ? undefined : WORKSPACE_DISABLED_HINT} onClick={() => toggleCapability(option)}>
            <span className="setting-icon"><ShieldCheck weight={enabled ? "fill" : "regular"} /></span><span><strong>{option.label}</strong><small>{selectable ? option.detail : WORKSPACE_ROW_HINT}</small></span>{enabled ? <Check weight="bold" /> : <CaretRight />}
          </button>;
        })}
        {!serverWorkspace.available && <p className="pop-note">{serverWorkspace.loaded ? WORKSPACE_DISABLED_HINT : "Consultando /api/workspace… enquanto o servidor não confirma uma raiz, leitura e escrita ficam desativadas."}</p>}
      </div>}
      {popover === "providers" && <div className="pop pop-wide" role="dialog" aria-label="Provedores configurados">
        <header><strong>Provedores</strong><span className="pop-count">{providers.length}</span><button type="button" aria-label="Fechar" onClick={() => setPopover(null)}><X /></button></header>
        {noProviders && <PanelEmpty>Nada no arquivo local. Adicione um provedor para a equipe poder executar missões.</PanelEmpty>}
        {providers.map((item) => <div className="provider-detail" key={item.label}>
          <strong>{item.label}</strong>
          <dl>
            <div><dt>Modelo</dt><dd>{item.model}</dd></div>
            <div><dt>Base URL</dt><dd>{item.baseUrl}</dd></div>
            <div><dt>Credencial</dt><dd>{item.credentialReference}</dd></div>
            {item.maxTokens ? <div><dt>max_tokens</dt><dd>{item.maxTokens}</dd></div> : null}
          </dl>
          <button type="button" className="pop-mini" onClick={() => pickProvider(item.label)}>{chosenProvider === item.label ? "Remover da próxima missão" : "Usar na próxima missão"}</button>
        </div>)}
        <footer className="pop-commands">
          <CmdLine command="hane provider add --label <nome> --base-url <url> --model <id>" onCopy={copyNotice} />
          <CmdLine command="hane provider set-secret <nome>" onCopy={copyNotice} />
          <button type="button" className="pop-mini" onClick={reload}><ArrowsClockwise /> Recarregar</button>
        </footer>
      </div>}

      <form className="composer-wrap" ref={formRef} onSubmit={send}>
        {loaded && noProviders && <div className="composer-warning"><Warning /> Nenhum agente · as missões ficam sem executor até <code>hane provider add</code> <button type="button" className="link-action" onClick={() => setPopover("providers")}>ver detalhes</button></div>}
        {(attachments.length > 0 || chosenProvider || capabilityGrants.length > 0) && <div className="chip-row">
          {chosenProvider && <span className="chip"><At weight="bold" />{chosenProvider}<button type="button" aria-label="Liberar provedor" onClick={() => setChosenProvider(null)}><X /></button></span>}
          {attachments.map((item, index) => <span className="chip" key={item.id}><Paperclip />Contexto {index + 1} · {item.text.length} car.<button type="button" aria-label="Remover contexto" onClick={() => removeAttachment(item.id)}><X /></button></span>)}
          {capabilityGrants.map((grant) => <span className="chip" key={`${grant.name}-${grant.scope}`}><ShieldCheck weight="bold" />{CAPABILITY_OPTIONS.find((item) => item.name === grant.name)?.label ?? grant.name}<button type="button" aria-label={`Remover ${grant.name}`} onClick={() => setCapabilityGrants((current) => current.filter((item) => item.name !== grant.name || item.scope !== grant.scope))}><X /></button></span>)}
        </div>}
        {createError && <div className="composer-error" role="alert"><Warning /><span><strong>Missão não enviada</strong><small>{createError}</small></span><button type="button" className="link-action" onClick={() => setCreateError("")}>dispensar</button></div>}
        <div className="composer"><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); formRef.current?.requestSubmit(); } }} placeholder="Descreva uma missão para a equipe Hane..." /><div><span className="composer-tools"><button type="button" className={popover === "attach" ? "on" : ""} aria-label="Anexar contexto" aria-expanded={popover === "attach"} onClick={() => togglePopover("attach")}><Paperclip /></button><button type="button" className={popover === "mention" ? "on" : ""} aria-label="Mencionar papel ou agente" aria-expanded={popover === "mention"} onClick={() => togglePopover("mention")}><At /></button><button type="button" className={popover === "capabilities" ? "on" : ""} aria-label="Definir permissões da missão" aria-expanded={popover === "capabilities"} onClick={() => togglePopover("capabilities")}><ShieldCheck /></button></span><small>{sending ? "enviando…" : `${MOD_KEY} Enter`}</small><button ref={sendRef} className="send-button" aria-label="Criar missão" disabled={sending}><PaperPlaneRight weight="fill" /></button></div></div>
        <small>Cada envio cria uma missão real executada por planejador, executor e revisor.</small>
      </form>
    </section>

    <aside className="right-panel"><header><span><strong>Contexto da missão</strong><small>{mission ? clock(mission.audit?.at(-1)?.at) || "agora" : "sem missão ativa"}</small></span></header><div className="panel-scroll">
      <section className="panel-section live-computer"><div className="panel-title"><strong>Computador ao vivo</strong><span>{GATED_CAPABILITIES_NOTE}</span></div>
        <div className="computer-preview" aria-label="Eventos auditáveis da sessão da missão">
          <div className="window-bar"><span /><span /><span /><small>{mission ? "eventos persistidos da missão" : "sem sessão ativa"}</small></div>
          <div className="window-body"><div><i /><i /><i /></div><pre>{sessionEvents.length ? sessionEvents.map((line, index) => <span key={`${line}-${index}`}>{line}{"\n"}</span>) : <span>Nenhuma sessão de ferramentas disponível.\nOs próximos eventos auditáveis aparecem aqui.</span>}</pre></div>
          <div className="evidence-list">
            <header><strong>Evidências de ferramentas</strong><span>{evidence.length} registro{evidence.length === 1 ? "" : "s"}</span></header>
            {evidence.length ? evidence.map((row) => {
              const roleName = row.role ? roles[row.role]?.name ?? row.role : null;
              return <div className={`evidence-row ${row.kind}`} key={row.id}>
                <span className="evidence-icon">{row.kind === "denied" ? <X weight="bold" /> : row.kind === "read" ? <FileText /> : row.kind === "listing" ? <FolderOpen /> : <Warning />}</span>
                <span className="evidence-copy"><strong>{row.label}</strong>{row.path && <code title={row.path}>{row.path}</code>}{row.meta && <span className="evidence-meta">{row.meta}</span>}{row.marker && <em className="evidence-flag">{row.marker}</em>}{roleName && <em className="evidence-role">{roleName}</em>}</span>
                <time>{row.at ? clock(row.at) : ""}</time>
              </div>;
            }) : <p className="evidence-empty">{mission ? "Nenhum acesso a ferramentas registrado nesta missão até agora." : "As leituras reais de arquivos aparecem aqui quando a missão recebe workspace.read."}</p>}
          </div>
          <div className="preview-caption"><span>A leitura de arquivos funciona sob grant explícito; escrita, comandos e rede não são executados.</span><span>{mission ? `${mission.providerCalls}/${mission.maxProviderCalls} chamadas${toolUsage ? ` · ${toolUsage} ferramentas` : ""}` : "—"}</span></div>
        </div>
      </section>
      <section className="panel-section active-agents"><div className="panel-title"><strong>{showOnboarding ? "Guia de início" : "Etapas da equipe"}</strong><span>{showOnboarding ? "primeira vez" : mission ? selectedLabel : "—"}</span></div>{showOnboarding ? <div className="active-agent"><Avatar person={onboardingAgent} size="sm" state="thinking" /><span><strong>Hane</strong><small>Pronto para orientar você</small></span><i className="ready-dot" /></div> : ROLE_ORDER.map((role) => {
        const person = roles[role];
        const done = mission?.outputs?.[role] !== undefined;
        const working = mission && isActive(mission.status) && role === currentRole;
        return <div className="active-agent" key={role}><Avatar person={person} size="sm" state={avatarStateFromMission({ mission, role, currentRole })} /><span><strong>{person.name}</strong><small>{done ? "Saída registrada" : working ? "Trabalhando agora" : mission ? "Sem saída ainda" : "Aguardando missão"}</small></span>{working && <i />}</div>;
      })}</section>
      <section className="panel-section"><div className="panel-title"><strong>Permissões</strong><span>{mission?.capabilityGrants?.length ?? 0} concedida{mission?.capabilityGrants?.length === 1 ? "" : "s"}</span></div>
        {mission?.capabilityGrants?.length ? mission.capabilityGrants.map((grant) => <div className="active-agent" key={`${grant.name}-${grant.scope}`}><span className="setting-icon"><ShieldCheck weight="fill" /></span><span><strong>{CAPABILITY_OPTIONS.find((item) => item.name === grant.name)?.label ?? grant.name}</strong><small>{grantDisplay(grant)}</small></span></div>) : <PanelEmpty>Esta missão não recebeu acesso a workspace, comandos ou rede.</PanelEmpty>}
        {mission && <dl className="workspace-state">
          <div><dt>Raiz do workspace</dt><dd>{workspaceRootLabel(mission.workspaceRoot)}</dd></div>
          <div><dt>Chamadas de ferramenta</dt><dd>{toolUsage ?? "não informado"}</dd></div>
        </dl>}
      </section>
      <section className="panel-section"><div className="panel-title"><strong>Progresso</strong><span>{progressPct}%</span></div>
        {mission ? <>
          <div className="progress-track"><i ref={barRef} /></div>
          <div className="progress-meta"><span>{mission.providerCalls} de {mission.maxProviderCalls} chamadas</span><span>orçamento {mission.maxProviderCalls}</span></div>
        </> : <PanelEmpty>Escolha ou crie uma missão para ver o consumo do orçamento de chamadas.</PanelEmpty>}
        <button className="secondary-action" disabled={!mission} onClick={() => { if (mission) { copyText(mission.id).then((ok) => notify(ok ? `ID da missão copiado: ${mission.id.slice(0, 8)}…` : "O navegador bloqueou a área de transferência.")); } }}>Copiar ID da missão <CaretRight /></button>
      </section>
      <section className="panel-section artifacts"><div className="panel-title"><strong>Artefatos gerados</strong><span>{outputs.length} saída{outputs.length === 1 ? "" : "s"}</span></div>
        {outputs.length === 0 && <PanelEmpty>{mission ? "Nenhum papel registrou saída nesta missão até agora." : "Os artefatos de Orion, Byte e Cipher aparecem aqui quando a missão roda."}</PanelEmpty>}
        {outputs.map((role) => <Artifact key={role} type={role === "planner" ? "doc" : role === "executor" ? "json" : "secure"} title={`${roles[role].name} · ${roles[role].job}`} meta={`${mission.outputs[role].length} caracteres · abrir na trilha`} onOpen={() => focusOutput(role)} />)}
      </section>
      <section className="approval-card"><div><span>{mission?.status === "completed" ? <Check /> : mission?.status === "needs_attention" || mission?.status === "failed" ? <Warning /> : <Sparkle />}</span><span><strong>{mission ? selectedLabel : "Nenhuma missão"}</strong><small>{mission?.status === "completed" ? "O veredito do revisor encerrou a missão." : mission?.status === "awaiting_approval" ? "O revisor pediu revisão humana. Aprovar custa mais 2 chamadas." : mission?.status === "needs_attention" ? "Atenção: veredito sinalizado ou orçamento esgotado." : mission?.status === "failed" ? "Uma etapa falhou. Refazer continua de onde parou." : mission?.status === "cancelled" ? "A execução foi cancelada e o histórico foi preservado." : mission ? "Acompanhe os eventos auditáveis da missão." : offline ? "Sem conexão com o hane serve." : noProviders ? "Sem agente configurado para executar missões." : "Envie uma missão para começar."}</small></span></div>{mission?.status === "awaiting_approval" ? <button ref={approvalRef} disabled={actionBusy} onClick={() => act("approve")}>{actionBusy ? <Spinner /> : <Check />} Revisar e aprovar</button> : cancellable ? <button disabled={actionBusy} onClick={() => act("cancel")}>{actionBusy ? <Spinner /> : <Warning />}{actionBusy ? " Cancelando…" : " Cancelar execução"}</button> : retryable ? <button disabled={actionBusy} onClick={() => act("retry")}>{actionBusy ? <Spinner /> : <Sparkle />}{actionBusy ? " Refazendo…" : " Refazer etapa"}</button> : <Status kind={mission ? selectedChip : "queued"}>{mission ? selectedLabel : "ociosa"}</Status>}</section>
    </div></aside>
    {toast && <div className="toast" ref={toastRef}><Check /> {toast}</div>}
  </main>;
}
