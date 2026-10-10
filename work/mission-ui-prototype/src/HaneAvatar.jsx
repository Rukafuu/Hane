import { useEffect, useRef } from "react";

// A page-wide scheduler keeps ten avatars on one requestAnimationFrame rather
// than mounting one loop per component.
const frameSubscribers = new Set();
let sharedFrame = null;
function runSharedFrame(now) {
  sharedFrame = null;
  for (const callback of frameSubscribers) callback(now);
  if (frameSubscribers.size > 0 && !document.hidden) sharedFrame = requestAnimationFrame(runSharedFrame);
}
function subscribeFrame(callback) {
  frameSubscribers.add(callback);
  if (!sharedFrame && !document.hidden) sharedFrame = requestAnimationFrame(runSharedFrame);
  return () => {
    frameSubscribers.delete(callback);
    if (frameSubscribers.size === 0 && sharedFrame) { cancelAnimationFrame(sharedFrame); sharedFrame = null; }
  };
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (!document.hidden && frameSubscribers.size > 0 && !sharedFrame) sharedFrame = requestAnimationFrame(runSharedFrame);
});

const SHAPE_RADII = {
  petal: [0.86, 1.03, 1.12, 1.02, 0.88, 1.08, 1.12, 1.0],
  drop: [0.76, 0.9, 1.12, 1.18, 1.08, 0.92, 0.83, 0.8],
  cloud: [0.99, 1.1, 0.97, 1.1, 0.98, 1.08, 0.96, 1.07],
  pebble: [1.09, 1.05, 1.0, 0.97, 1.04, 1.01, 0.96, 1.04],
};

const BEHAVIOURS = {
  idle: { breath: 0.022, sway: 0.55, gaze: 0.38 },
  thinking: { breath: 0.03, sway: 1.4, gaze: 1 },
  working: { breath: 0.045, sway: 0.65, gaze: 0.72 },
  waiting: { breath: 0.012, sway: 0.23, gaze: 0.18 },
  blocked: { breath: 0.018, sway: 0.6, gaze: 0.72 },
  done: { breath: 0.035, sway: 0.38, gaze: 0.34 },
  error: { breath: 0.015, sway: 0.28, gaze: 0.12 },
};

function contour(shape, squash, wobble) {
  const radii = SHAPE_RADII[shape] ?? SHAPE_RADII.petal;
  const points = radii.map((radius, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / radii.length);
    const r = radius * (1 + wobble * Math.sin(index * 2.2 + 0.8));
    return [50 + Math.cos(angle) * r * 29 * (1 + squash), 50 + Math.sin(angle) * r * 31 * (1 - squash)];
  });
  // Eight compatible quadratic segments: every silhouette has the same order.
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const mid = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
    return index === 0 ? `M ${mid[0].toFixed(2)} ${mid[1].toFixed(2)}` : "";
  }).join("") + points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return ` Q ${point[0].toFixed(2)} ${point[1].toFixed(2)} ${((point[0] + next[0]) / 2).toFixed(2)} ${((point[1] + next[1]) / 2).toFixed(2)}`;
  }).join("") + " Z";
}

/** Lightweight SVG avatar. One rAF updates its own SVG nodes, avoiding React frame renders. */
export function HaneAvatar({ agentId, name, shape = "petal", color = "#c9b7d9", state = "idle", size = 44, intensity = 1, reducedMotion = false, interactive = false, onClick, className = "" }) {
  const pathRef = useRef(null);
  const bodyRef = useRef(null);
  const eyesRef = useRef(null);
  const blinkRef = useRef(null);
  const visibleRef = useRef(true);
  const shellRef = useRef(null);
  const behaviour = BEHAVIOURS[state] ?? BEHAVIOURS.idle;

  useEffect(() => {
    if (reducedMotion) return undefined;
    const started = performance.now();
    let nextBlink = 1200 + Math.random() * 2600;
    let blinkStart = -1;
    const step = (now) => {
      if (!visibleRef.current) return;
      const seconds = (now - started) / 1000;
      if (now - started > nextBlink && blinkStart < 0) blinkStart = now;
      let lid = 1;
      if (blinkStart >= 0) {
        const phase = (now - blinkStart) / 150;
        lid = phase < 0.5 ? 1 - phase * 1.9 : (phase - 0.5) * 1.9;
        if (phase >= 1) { blinkStart = -1; nextBlink = now - started + 1800 + Math.random() * 3800; }
      }
      const pulse = Math.sin(seconds * (state === "working" ? 8 : 2.4)) * behaviour.breath * intensity;
      const tiltBase = state === "thinking" ? -5 : state === "blocked" ? 4 : state === "error" ? -2 : 0;
      const tilt = tiltBase + Math.sin(seconds * 1.6) * behaviour.sway * intensity;
      const glance = Math.sin(seconds * (state === "thinking" ? 2.4 : 0.8)) * behaviour.gaze * 3 * intensity;
      const pop = state === "done" ? Math.max(0, Math.sin(seconds * 7)) * 0.07 : 0;
      if (pathRef.current) pathRef.current.setAttribute("d", contour(shape, pulse + pop, pulse * 1.25));
      if (bodyRef.current) bodyRef.current.setAttribute("transform", `translate(50 50) rotate(${tilt}) scale(${1 + pulse + pop} ${1 - pulse * 0.35}) translate(-50 -50)`);
      if (eyesRef.current) eyesRef.current.setAttribute("transform", `translate(${glance.toFixed(2)} ${(Math.cos(seconds * 1.1) * behaviour.gaze).toFixed(2)}) rotate(${tilt * 0.16} 50 50)`);
      if (blinkRef.current) blinkRef.current.setAttribute("transform", `translate(0 ${((1 - lid) * 4).toFixed(2)}) scale(1 ${Math.max(0.08, lid).toFixed(2)})`);
    };
    return subscribeFrame(step);
  }, [behaviour, intensity, reducedMotion, shape, state]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => { visibleRef.current = entry.isIntersecting; }, { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const label = `${name ?? agentId}, ${state}`;
  return <button ref={shellRef} type="button" className={`hane-avatar ${className}`} style={{ width: size, height: size, "--avatar-color": color }} aria-label={label} data-avatar-state={state} onClick={onClick} disabled={!interactive}>
    <svg viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false">
      <g ref={bodyRef}><path ref={pathRef} d={contour(shape, 0, 0)} fill={color} /><path d={contour(shape, -0.03, 0)} fill="none" stroke="white" strokeOpacity=".32" strokeWidth="1" /></g>
      <g ref={eyesRef}><g ref={blinkRef} className="hane-avatar__eyes"><ellipse cx="40" cy="49" rx="4.5" ry="6.5"/><ellipse cx="60" cy="49" rx="4.5" ry="6.5"/></g>{state === "blocked" && <path className="hane-avatar__signal" d="M72 22 L72 31 M67.5 26.5 L76.5 26.5" />}</g>
    </svg>
  </button>;
}
