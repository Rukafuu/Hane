import { useState } from "react";
import { HaneAvatar } from "./HaneAvatar.jsx";

const shapes = ["petal", "drop", "cloud", "pebble"];
const states = ["idle", "thinking", "working", "waiting", "blocked", "done", "error"];

// Kept behind a query route so the production mission surface stays focused.
export function AvatarPlayground() {
  const [state, setState] = useState("thinking");
  const [color, setColor] = useState("#c9b7d9");
  const [intensity, setIntensity] = useState(1);
  const [reduced, setReduced] = useState(false);
  return <main className="avatar-playground">
    <header><a href="/">← Missões</a><span>Hane Avatar Engine · playground</span></header>
    <section><div><p className="eyebrow">FORMA + ESTADO</p><h1>Presença sem ruído.</h1><p>O mesmo motor que aparece nas missões, com estados e movimento verificáveis.</p></div><label className="avatar-reduce"><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} /> Movimento reduzido</label></section>
    <div className="avatar-playground__controls"><label>Cor <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label>Intensidade <input type="range" min="0" max="1.5" step="0.1" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} /></label><span>{states.map((item) => <button className={item === state ? "is-selected" : ""} onClick={() => setState(item)} key={item}>{item}</button>)}</span></div>
    <section className="avatar-playground__grid" aria-label="Quatro formatos de avatar">
      {shapes.map((shape) => <article key={shape}><HaneAvatar agentId={`playground-${shape}`} name={shape} shape={shape} color={color} state={state} size={116} intensity={intensity} reducedMotion={reduced} interactive /><strong>{shape}</strong><small>{state}</small></article>)}
    </section>
    <section className="avatar-playground__ten" aria-label="Dez avatares simultâneos">{Array.from({ length: 10 }, (_, index) => <HaneAvatar key={index} agentId={`squad-${index}`} name={`Agente ${index + 1}`} shape={shapes[index % shapes.length]} color={["#c9b7d9", "#8aa9c9", "#9bbfae", "#d8ae91"][index % 4]} state={states[index % states.length]} size={58} intensity={intensity} reducedMotion={reduced} />)}</section>
  </main>;
}
