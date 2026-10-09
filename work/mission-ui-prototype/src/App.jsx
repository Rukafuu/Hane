import { useMemo, useState } from "react";
import {
  Archive, ArrowRight, CaretDown, CheckCircle, Circle, CircleNotch, Diamond, FileText, Hexagon,
  FloppyDisk, FunnelSimple, GearSix, MagnifyingGlass, Paperclip,
  Plus, ShieldCheck, Sparkle, Square, Triangle, WarningCircle,
} from "@phosphor-icons/react";

const missions = [
  { id: "flaky", title: "Investigate flaky checkout tests", preview: "Planner posted a hypothesis with evidence.", time: "10:24", color: "violet", active: true },
  { id: "search", title: "Improve search relevance", preview: "Researcher found 3 leads, needs review.", time: "09:41", color: "mint" },
  { id: "release", title: "Plan Q2 release notes", preview: "Draft outline ready for your review.", time: "08:18", color: "orange" },
  { id: "timeouts", title: "Reduce API timeouts", preview: "Investigation complete. 2 options ready.", time: "Yesterday", color: "blue" },
  { id: "deps", title: "Audit dependency updates", preview: "Reviewer left feedback on 4 items.", time: "Yesterday", color: "lilac" },
  { id: "pricing", title: "Explore pricing experiments", preview: "Gathering data from analytics.", time: "Apr 17", color: "green" },
];

const missionIcons = { flaky: Hexagon, search: Circle, release: Triangle, timeouts: Diamond, deps: CircleNotch, pricing: Square };

function AgentMark({ type, color }) {
  const Icon = type === "planner" ? Sparkle : type === "researcher" ? MagnifyingGlass : ShieldCheck;
  return <span className={`agent-mark ${color}`}><Icon size={19} weight="fill" /></span>;
}

function Evidence({ icon: Icon = FileText, label, detail }) {
  const [open, setOpen] = useState(false);
  return <button className={`evidence ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
    <Icon size={18} weight="regular" />
    <span><b>{label}</b><small>{open ? "Preview ready · local artifact" : detail}</small></span>
    <CaretDown size={16} className={open ? "up" : ""} />
  </button>;
}

function ThreadEntry({ agent, color, time, title, children, waiting }) {
  return <article className={`thread-entry ${waiting ? "waiting" : ""}`}>
    <div className="thread-rail"><AgentMark type={agent.toLowerCase()} color={color} /></div>
    <div className="thread-content">
      <header><strong>{agent}</strong><time>{time}</time></header>
      <section className="message-card">
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  </article>;
}

export function App() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("flaky");
  const [approved, setApproved] = useState(false);
  const [draft, setDraft] = useState("");
  const visibleMissions = useMemo(() => missions.filter((mission) => mission.title.toLowerCase().includes(query.toLowerCase())), [query]);
  const current = missions.find((mission) => mission.id === selected) ?? missions[0];

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand-row"><span className="brand-mark"><Sparkle weight="fill" size={27} /></span><b>Missions</b><button aria-label="Create mission"><Plus size={20} /></button></div>
      <label className="search"><MagnifyingGlass size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search missions…" /><button aria-label="Filter missions"><FunnelSimple size={17} /></button></label>
      <nav aria-label="Mission list">
        {visibleMissions.map((mission) => { const MissionIcon = missionIcons[mission.id]; return <button key={mission.id} onClick={() => setSelected(mission.id)} className={`mission-row ${selected === mission.id ? "selected" : ""}`}>
          <span className={`mission-shape ${mission.color}`}><MissionIcon size={37} weight="fill" /></span>
          <span className="mission-copy"><b>{mission.title}</b><small>{mission.preview}</small></span>
          <span className="mission-meta"><time>{mission.time}</time><i /></span>
        </button>})}
      </nav>
      <footer className="sidebar-footer"><button><Archive size={18} />Archived</button><button><GearSix size={19} />Settings</button></footer>
    </aside>

    <section className="mission-view">
      <header className="topbar"><span><CircleNotch size={16} weight="fill" /> Local only</span><span><Sparkle size={16} weight="fill" /> OpenRouter · free</span><span><b>2/6</b> calls</span><span className="readonly"><ShieldCheck size={16} weight="fill" /> Read-only</span></header>
      <div className="mission-scroll">
        <header className="mission-heading"><div><p>MISSION</p><h1>{current.title}</h1><span>Find the root cause with clear evidence and human-approved next steps.</span></div><button className="more" aria-label="Mission options">•••</button></header>
        <div className="thread">
          <ThreadEntry agent="Planner" color="violet" time="10:02" title="Initial hypothesis">
            <p>The checkout suite may race between payment initialization and the confirmation redirect. The assertion can run before the page reaches its final state.</p>
            <div className="evidence-line"><Evidence label="test-run-7842.log" detail="124 KB · 220 lines" /><Evidence icon={FileText} label="checkout-timeline.md" detail="8 KB · annotated" /></div>
            <div className="uncertainty"><WarningCircle size={18} /><span><b>Uncertainty</b>This is a hypothesis, not a confirmed cause. Environment staleness and payment sandbox latency remain plausible.</span></div>
          </ThreadEntry>
          <ThreadEntry agent="Researcher" color="mint" time="10:07" title="Examined a failed test log">
            <p>I compared the failing run with two successful runs. In the failure, redirect completes approximately 1.2s later and the assertion happens before the page is ready.</p>
            <div className="evidence-line"><Evidence label="comparison-notes.md" detail="2.1 KB · local note" /></div>
            <div className="uncertainty"><WarningCircle size={18} /><span><b>Uncertainty</b>The delay is inconsistent across runs. We need a scoped investigation before recommending a fix.</span></div>
          </ThreadEntry>
          <ThreadEntry agent="Reviewer" color="lilac" time="10:12" title="Waiting" waiting>
            <p>Standing by for your approval of the investigation scope before proceeding.</p>
          </ThreadEntry>
          <div className="handoff"><ArrowRight size={18} /><span><b>Handoff</b><em>Researcher</em> → waiting for your approval</span><time>10:12</time></div>
          <div className="human-decision"><div><small>YOU · 10:18</small><p>{approved ? "Investigation scope approved. Continue read-only." : "Approve the investigation scope."}</p><button onClick={() => setApproved(!approved)} className={approved ? "approved" : ""}>{approved ? <><CheckCircle weight="fill" /> Approved</> : <><CheckCircle /> Approve scope</>}</button></div><span className="human-avatar">Y</span></div>
        </div>
      </div>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); setDraft(""); }}><button type="button" aria-label="Attach context"><Paperclip size={20} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message this mission" /><button type="button" aria-label="Save draft"><FloppyDisk size={19} /></button><button className="send" aria-label="Send message" type="submit"><ArrowRight size={20} weight="bold" /></button></form>
    </section>
  </main>;
}
