import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut, At, BracketsCurly, CaretRight, Check, CircleNotch, Clock, Code,
  FileText, GearSix, MagnifyingGlass, PaperPlaneRight, Paperclip, Plus,
  ShieldCheck, Sparkle, UsersThree, Warning,
} from "@phosphor-icons/react";
import {
  approvePop, entrance, growBar, pop, pulseLoop, reduceMotion, rise, spinLoop, staggerIn, toastOut,
} from "./motion.js";
import { approveMission, createMission, fetchMission, fetchMissions, fetchProviders, openMissionEvents, retryMission } from "./api.js";

const roles = {
  planner: { name: "Orion", job: "Planejamento", tone: "lilac", Icon: UsersThree },
  executor: { name: "Byte", job: "Execução", tone: "blue", Icon: Code },
  reviewer: { name: "Cipher", job: "Revisão", tone: "mint", Icon: ShieldCheck },
};
const ROLE_ORDER = ["planner", "executor", "reviewer"];

const statusInfo = (status) => ({
  queued: ["Na fila", "queued"],
  draft: ["Rascunho", "queued"],
  planned: ["Planejando", "running"],
  executing: ["Executando", "running"],
  reviewing: ["Revisando", "running"],
  awaiting_approval: ["Aguardando aprovação", "running"],
  completed: ["Concluída", "done"],
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

function Avatar({ person, size = "md" }) {
  const Icon = person.Icon;
  return <span className={`avatar ${person.tone} ${size}`} aria-label={person.name}><Icon weight="bold" /></span>;
}

function Stack() {
  return <span className="agent-stack">{ROLE_ORDER.map((role) => <Avatar key={role} person={roles[role]} size="xs" />)}</span>;
}

function Status({ kind, children }) {
  return <span className={`status ${kind}`}>{kind === "done" && <Check weight="bold" />}{children}</span>;
}

function Artifact({ type, title, meta, onOpen }) {
  return <button className="artifact" onClick={() => onOpen(title)}>
    <span className={`artifact-icon ${type}`}>{type === "json" ? <BracketsCurly /> : type === "secure" ? <ShieldCheck /> : <FileText />}</span>
    <span><strong>{title}</strong><small>{meta}</small></span>
    <ArrowSquareOut />
  </button>;
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
  const rootRef = useRef(null);
  const barRef = useRef(null);
  const toastRef = useRef(null);
  const sendRef = useRef(null);
  const composerRef = useRef(null);
  const approvalRef = useRef(null);
  const selectedRef = useRef(null);
  const rowIdsRef = useRef("");
  selectedRef.current = selectedId;

  const visible = useMemo(() => (missions ?? []).filter((item) => `${item.objective} ${item.id}`.toLowerCase().includes(query.toLowerCase())), [missions, query]);
  const [selectedLabel, selectedChip] = statusInfo(mission?.status ?? (selectedId ? "queued" : "draft"));
  const currentRole = mission ? ROLE_ORDER.find((role) => mission.outputs?.[role] === undefined) : null;
  const progressPct = mission && mission.maxProviderCalls > 0 ? Math.min(100, Math.round((mission.providerCalls / mission.maxProviderCalls) * 100)) : 0;
  const outputs = mission ? ROLE_ORDER.filter((role) => mission.outputs?.[role] !== undefined) : [];
  const verdictEntry = useMemo(() => mission?.audit?.filter((entry) => entry.type === "verdict_parsed" || entry.type === "verdict_unparsed").at(-1) ?? null, [mission]);
  const retryable = mission && (mission.status === "failed" || (mission.status === "needs_attention" && ROLE_ORDER.some((role) => mission.outputs?.[role] === undefined)));

  useEffect(() => {
    const runs = entrance(rootRef.current);
    return () => runs.forEach((animation) => animation.revert());
  }, []);

  useEffect(() => {
    let alive = true;
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
  }, [selectedId]);

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

  function notify(message) {
    setToast(message);
    window.clearTimeout(window.__haneToast);
    window.__haneToast = window.setTimeout(() => {
      const el = toastRef.current;
      if (el && !reduceMotion()) toastOut(el).then(() => setToast(""));
      else setToast("");
    }, 2400);
  }

  async function send(event) {
    event.preventDefault();
    const objective = draft.trim();
    if (!objective || sending) return;
    setSending(true);
    try {
      const created = await createMission(objective);
      setDraft("");
      setOffline(false);
      setSelectedId(created.id);
      setMission(null);
      setMissions((items) => [toSummary({ ...created, providerCalls: 0, updatedAt: new Date().toISOString() }), ...(items ?? []).filter((item) => item.id !== created.id)]);
      pop(sendRef.current);
      notify("Missão criada · a equipe assumiu o trabalho");
    } catch (error) {
      notify(`Falha ao criar a missão: ${error.message}`);
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

  return <main className="app-shell" ref={rootRef}>
    <aside className="left-sidebar">
      <div className="brand-row"><img src="/brand/hane-logo.png" alt="Hane" /><button className="icon-button" aria-label="Versão"><GearSix /></button></div>
      <label className="search-box"><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar missões" /><kbd>⌘ K</kbd></label>
      <button className="new-chat" onClick={() => { setSelectedId(null); composerRef.current?.focus(); }}><span><Plus weight="bold" /></span>Nova missão<CaretRight /></button>

      <nav className="sidebar-scroll" aria-label="Provedores e missões">
        <header className="section-head"><span>AGENTES</span></header>
        {providers.length === 0 && <small className="panel-note">Nenhum provedor · rode <code>hane provider add</code></small>}
        {providers.map((provider) => <button className="agent-nav" key={provider.label} onClick={() => notify(`${provider.label} · ${provider.model} · ${provider.baseUrl}`)}>
          <Avatar person={{ name: provider.label, job: provider.model, tone: "peach", Icon: At }} size="sm" />
          <span><strong>{provider.label}</strong><small>{provider.model}</small></span><i className="online" />
        </button>)}
        <header className="section-head conversation-head"><span>MISSÕES</span><button aria-label="Nova missão" onClick={() => composerRef.current?.focus()}><Plus /></button></header>
        {missions === null && <small className="panel-note">Carregando…</small>}
        {offline && <small className="panel-note">API do Hane indisponível — rode <code>hane serve</code>. <button className="link-action" onClick={() => setRetryTick((tick) => tick + 1)}>tentar de novo</button></small>}
        {!offline && missions?.length === 0 && <small className="panel-note">Nenhuma missão ainda.</small>}
        {visible.map((item) => {
          const [label, chip] = statusInfo(item.status);
          return <button className={`conversation-row ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)} title={item.objective}>
            <Stack /><span className="conversation-copy"><strong>{item.objective}</strong><small>{label} · {item.providerCalls}/{item.maxProviderCalls} chamadas</small></span><time>{clock(item.updatedAt)}</time>
          </button>;
        })}
      </nav>

      <footer className="sidebar-footer">
        <button onClick={() => notify("Gerencie provedores pelo CLI: hane provider add · set-secret")}><Clock /><span><strong>Provedores</strong><small>{providers.length} configurado{providers.length === 1 ? "" : "s"}</small></span><CaretRight /></button>
      </footer>
    </aside>

    <section className="conversation-view">
      <header className="conversation-header"><Stack /><span className="conversation-title"><strong>{mission?.objective ?? (missions?.length ? "Selecione uma missão" : "Descreva uma missão abaixo")}</strong><small><i /> {mission ? `${selectedLabel} · ${mission.providerCalls}/${mission.maxProviderCalls} chamadas` : "equipe: planejador, executor, revisor"}</small></span>{mission && <Status kind={selectedChip}>{selectedLabel}</Status>}</header>
      <div className="messages">
        <div className="day-divider"><span>Hoje</span></div>
        {missions === null && <div className="day-divider"><span>Carregando missões…</span></div>}
        {offline && <div className="day-divider"><span>Hane serve indisponível · inicie com <code>hane serve</code></span></div>}
        {!offline && mission && <>
          <RiseIn className="user-message" key={`objective-${mission.id}`}><small>Você · {clock(mission.audit?.at(-1)?.at)}</small><p>{mission.objective}</p></RiseIn>
          {ROLE_ORDER.map((role) => {
            const person = roles[role];
            const output = mission.outputs?.[role];
            const failed = mission.audit?.find((entry) => entry.type === "provider_call_failed" && entry.detail?.role === role);
            if (failed) return <article className="message" key={`${mission.id}-${role}`}><Avatar person={person} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="attention">Falhou</Status></header><p>{failed.detail.message}</p></div></article>;
            if (output !== undefined) return <article className="message" key={`${mission.id}-${role}`}><Avatar person={person} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="done">Concluído</Status></header><p className="output-text">{output}</p></div></article>;
            if (isActive(mission.status) && role === currentRole) return <article className="message" key={`${mission.id}-${role}`}><Avatar person={person} /><div className="message-content"><header><strong>{person.name}</strong><small>{person.job}</small><Status kind="running">Trabalhando</Status></header><p><Spinner /> Gerando a saída de {person.job.toLowerCase()}…</p></div></article>;
            return null;
          })}
          {["completed", "needs_attention", "failed", "awaiting_approval"].includes(mission.status) && <div className="handoff-card"><span><Avatar person={roles.reviewer} size="xs" /><CaretRight /><Avatar person={{ name: "Você", job: "", tone: "pink", Icon: Check }} size="xs" /></span><span><strong>{selectedLabel}</strong><small>{verdictEntry ? `Veredito do revisor: ${verdictEntry.detail.verdict}` : mission.status === "needs_attention" ? "Orçamento esgotado ou revisão pendente de atenção." : "Acompanhe os artefatos no painel direito."}</small></span><Status kind={selectedChip}>{selectedLabel}</Status></div>}
        </>}
        {!offline && !mission && selectedId === null && <div className="day-divider"><span>Nenhuma missão selecionada — crie uma no campo abaixo.</span></div>}
      </div>
      <form className="composer-wrap" onSubmit={send}><div className="composer"><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Descreva uma missão para a equipe Hane..." /><div><span className="composer-tools"><button type="button" aria-label="Anexar arquivo (em breve)"><Paperclip /></button><button type="button" aria-label="Mencionar (em breve)"><At /></button></span><small>{sending ? "enviando…" : "⌘ Enter"}</small><button ref={sendRef} className="send-button" aria-label="Criar missão" disabled={sending}><PaperPlaneRight weight="fill" /></button></div></div><small>Cada envio cria uma missão real executada por planejador, executor e revisor.</small></form>
    </section>

    <aside className="right-panel"><header><span><strong>Contexto da missão</strong><small>{mission ? clock(mission.audit?.at(-1)?.at) || "agora" : "sem missão ativa"}</small></span></header><div className="panel-scroll">
      <section className="panel-section active-agents"><div className="panel-title"><strong>Etapas da equipe</strong><span>{mission ? selectedLabel : "—"}</span></div>{ROLE_ORDER.map((role) => {
        const person = roles[role];
        const done = mission?.outputs?.[role] !== undefined;
        const working = mission && isActive(mission.status) && role === currentRole;
        return <div className="active-agent" key={role}><Avatar person={person} size="sm" /><span><strong>{person.name}</strong><small>{done ? "Saída registrada" : working ? "Trabalhando agora" : mission ? "Sem saída ainda" : "Aguardando missão"}</small></span>{working && <i />}</div>;
      })}</section>
      <section className="panel-section"><div className="panel-title"><strong>Progresso</strong><span>{progressPct}%</span></div><div className="progress-track"><i ref={barRef} /></div><div className="progress-meta"><span>{mission ? `${mission.providerCalls} de ${mission.maxProviderCalls} chamadas` : "sem missão ativa"}</span><span>{mission?.id ? `orçamento ${mission.maxProviderCalls}` : ""}</span></div><button className="secondary-action" onClick={() => { if (mission) { navigator.clipboard?.writeText(mission.id).catch(() => {}); notify(`ID da missão copiado: ${mission.id.slice(0, 8)}…`); } }}>Copiar ID da missão <CaretRight /></button></section>
      <section className="panel-section artifacts"><div className="panel-title"><strong>Artefatos gerados</strong><span>{outputs.length} saída{outputs.length === 1 ? "" : "s"}</span></div>{outputs.map((role) => <Artifact key={role} type={role === "planner" ? "doc" : role === "executor" ? "json" : "secure"} title={`${roles[role].name} · ${roles[role].job}`} meta={`${mission.outputs[role].length} caracteres`} onOpen={() => notify(`Saída de ${roles[role].name} visível na trilha da missão`)} />)}</section>
      <section className="approval-card"><div><span>{mission?.status === "completed" ? <Check /> : mission?.status === "needs_attention" || mission?.status === "failed" ? <Warning /> : <Sparkle />}</span><span><strong>{mission ? selectedLabel : "Nenhuma missão"}</strong><small>{mission?.status === "completed" ? "O veredito do revisor encerrou a missão." : mission?.status === "awaiting_approval" ? "O revisor pediu revisão humana. Aprovar custa mais 2 chamadas." : mission?.status === "needs_attention" ? "Atenção: veredito sinalizado ou orçamento esgotado." : mission?.status === "failed" ? "Uma etapa falhou. Refazer continua de onde parou." : mission ? "Acompanhe os artefatos da missão." : "Envie uma missão para começar."}</small></span></div>{mission?.status === "awaiting_approval" ? <button ref={approvalRef}  disabled={actionBusy} onClick={() => act("approve")}>{actionBusy ? <Spinner /> : <Check />} Revisar e aprovar</button> : retryable ? <button  disabled={actionBusy} onClick={() => act("retry")}>{actionBusy ? <Spinner /> : <Sparkle />}{actionBusy ? " Refazendo…" : " Refazer etapa"}</button> : <Status kind={mission ? selectedChip : "queued"}>{mission ? selectedLabel : "ociosa"}</Status>}</section>
    </div></aside>
    {toast && <div className="toast" ref={toastRef}><Check /> {toast}</div>}
  </main>;
}
