import { useEffect, useRef, useId } from "react";

// A page-wide scheduler keeps ten avatars on one requestAnimationFrame rather
// than mounting one loop per component.
const frameSubscribers = new Set();
let sharedFrame = null;
function runSharedFrame(now) {
  sharedFrame = null;
  for (const callback of frameSubscribers) callback(now);
  if (frameSubscribers.size > 0 && !document.hidden) sharedFrame = requestAnimationFrame(runSharedFrame);
}
export function subscribeFrame(callback) {
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

const SHAPE_PROFILES = {
  circle: { radii: [1, 1, 1, 1, 1, 1, 1, 1], width: 1, height: 1 },
  pebble: { radii: [1.05, 1.02, 0.98, 1.02, 1.04, 0.98, 0.96, 1.01], width: 1.2, height: 0.82 },
  capsule: { radii: [1, 1, 1, 1, 1, 1, 1, 1], width: 1.32, height: 0.7 },
  hexagon: { radii: [1.04, 1.18, 1.04, 1.18, 1.04, 1.18, 1.04, 1.18], width: 1, height: 1 },
  cloud: { radii: [1.08, 0.86, 1.19, 0.9, 1.13, 0.84, 1.17, 0.91], width: 1.03, height: 0.94 },
  drop: { radii: [0.68, 0.87, 1.12, 1.18, 1.1, 1.02, 0.9, 0.76], width: 0.95, height: 1.1 },
  // Older component callers keep rendering, but now use visibly different forms.
  petal: { radii: [1, 1, 1, 1, 1, 1, 1, 1], width: 1, height: 1 },
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
  // Deliberately preserve hard edges where the silhouette needs to read at
  // 24px. The softer quadratic contour below made the former hexagon look
  // like another rounded blob.
  if (shape === "diamond" || shape === "triangle") {
    const vertices = shape === "diamond" ? [[50, 10], [84, 50], [50, 90], [16, 50]] : [[50, 12], [86, 83], [14, 83]];
    return `M ${vertices.map(([x, y]) => `${(50 + (x - 50) * (1 + squash)).toFixed(2)} ${(50 + (y - 50) * (1 - squash * 0.35)).toFixed(2)}`).join(" L ")} Z`;
  }
  if (shape === "hexagon") {
    const scaleX = 1 + squash;
    const scaleY = 1 - squash * 0.35;
    const points = [[50, 13], [80, 31], [80, 68], [50, 87], [20, 68], [20, 31]]
      .map(([x, y]) => [50 + (x - 50) * scaleX, 50 + (y - 50) * scaleY]);
    return `M ${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
  }
  if (shape === "drop") {
    const top = 10 + squash * 5;
    return `M 50 ${top.toFixed(2)} C 67 31, 83 48, 78 64 C 74 79, 63 88, 50 88 C 37 88, 26 79, 22 64 C 17 48, 33 31, 50 ${top.toFixed(2)} Z`;
  }
  const profile = SHAPE_PROFILES[shape] ?? SHAPE_PROFILES.circle;
  const radii = profile.radii;
  const points = radii.map((radius, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / radii.length);
    const r = radius * (1 + wobble * Math.sin(index * 2.2 + 0.8));
    return [50 + Math.cos(angle) * r * 29 * profile.width * (1 + squash), 50 + Math.sin(angle) * r * 31 * profile.height * (1 - squash)];
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
export function HaneAvatar({ agentId, name, shape = "petal", color = "#c9b7d9", image, state = "idle", size = 44, intensity = 1, reducedMotion = false, interactive = false, onClick, className = "", behaviourRef, decorative = false, garden = false }) {
  const gradientId = useId().replace(/:/g, "");
  const pathRef = useRef(null);
  const bodyRef = useRef(null);
  const eyesRef = useRef(null);
  const blinkRef = useRef(null);
  const visibleRef = useRef(true);
  const shellRef = useRef(null);
  const behaviour = BEHAVIOURS[state] ?? BEHAVIOURS.idle;

  useEffect(() => {
    if (reducedMotion) {
      bodyRef.current?.removeAttribute("transform"); eyesRef.current?.removeAttribute("transform"); blinkRef.current?.removeAttribute("transform");
      pathRef.current?.setAttribute("d", contour(shape, 0, 0));
      return undefined;
    }
    const started = performance.now();
    let nextBlink = 1200 + Math.random() * 2600;
    let blinkStart = -1;
    let blinkToken = 0, doubleBlink = false, gazeX = 0, gazeY = 0, previous = started, sleepLid = 1;
    const step = (now) => {
      if (!visibleRef.current) return;
      const seconds = (now - started) / 1000;
      const external = behaviourRef?.current;
      const sleeping = external?.state === "sleeping";
      const mood = external?.state;
      const damping = 1 - Math.exp(-Math.min(now - previous, 40) / 90); previous = now;
      if (external) { gazeX += (external.gazeX - gazeX) * damping; gazeY += (external.gazeY - gazeY) * damping;
        if (external.blink !== blinkToken) { blinkToken = external.blink; blinkStart = now; } }
      if (now - started > nextBlink && blinkStart < 0) blinkStart = now;
      let lid = 1;
      if (blinkStart >= 0) {
        const phase = (now - blinkStart) / 150;
        lid = phase < 0.5 ? 1 - phase * 1.9 : (phase - 0.5) * 1.9;
        if (phase >= 1) { blinkStart = -1; nextBlink = now - started + (doubleBlink ? 120 : 1800 + Math.random() * 3800); doubleBlink = doubleBlink ? false : Math.random() < 0.18; }
      }
      sleepLid += ((sleeping ? 0.1 : 1) - sleepLid) * damping * 0.2;
      lid = Math.min(lid, sleepLid);
      const pulse = Math.sin(seconds * (sleeping ? 1 : state === "working" ? 8 : 2.4)) * behaviour.breath * intensity;
      const tiltBase = mood === "focused" ? -7 : mood === "curious" ? 4 : mood === "happy" ? -3 : mood === "surprised" ? 3 : state === "thinking" ? -5 : state === "blocked" ? 4 : state === "error" ? -2 : 0;
      const tilt = tiltBase + Math.sin(seconds * 1.6) * behaviour.sway * intensity;
      const glance = Math.sin(seconds * (state === "thinking" ? 2.4 : 0.8)) * behaviour.gaze * 3 * intensity;
      const pop = mood === "happy" || mood === "celebrating" || state === "done" ? Math.max(0, Math.sin(seconds * 7)) * 0.07 : 0;
      if (pathRef.current) pathRef.current.setAttribute("d", contour(shape, pulse + pop, pulse * 1.25));
      if (bodyRef.current) bodyRef.current.setAttribute("transform", `translate(50 50) rotate(${tilt}) scale(${1 + pulse + pop} ${1 - pulse * 0.35}) translate(-50 -50)`);
      if (eyesRef.current) eyesRef.current.setAttribute("transform", `translate(${(external ? gazeX : glance).toFixed(2)} ${(external ? gazeY : Math.cos(seconds * 1.1) * behaviour.gaze).toFixed(2)}) rotate(${tilt * 0.16} 50 50)`);
      if (blinkRef.current) blinkRef.current.setAttribute("transform", `translate(0 ${((1 - lid) * 4).toFixed(2)}) scale(1 ${Math.max(0.08, lid).toFixed(2)})`);
    };
    return subscribeFrame(step);
  }, [behaviour, intensity, reducedMotion, shape, state, behaviourRef]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => { visibleRef.current = entry.isIntersecting; }, { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const label = `${name ?? agentId}, ${state}`;
  const Shell = decorative ? "span" : "button";
  return <Shell ref={shellRef} type={decorative ? undefined : "button"} className={`hane-avatar ${className}`} style={{ width: size, height: size, "--avatar-color": color }} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} data-avatar-state={state} onClick={onClick} disabled={decorative ? undefined : !interactive}>
    {image ? <img className="hane-avatar__image" src={image} alt="" /> : null}
    <svg viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false">
      <defs><radialGradient id={gradientId} cx="35%" cy="25%" r="80%"><stop offset="0" stopColor="#fffdfd"/><stop offset=".65" stopColor={color}/><stop offset="1" stopColor="#edc8d9"/></radialGradient></defs>
      <g ref={bodyRef}><path ref={pathRef} d={contour(shape, 0, 0)} fill={garden ? `url(#${gradientId})` : color} /></g>
      <g ref={eyesRef}><g ref={blinkRef} className="hane-avatar__eyes"><ellipse cx="40" cy="49" rx="4.5" ry="6.5"/><ellipse cx="60" cy="49" rx="4.5" ry="6.5"/></g>{state === "blocked" && <path className="hane-avatar__signal" d="M72 22 L72 31 M67.5 26.5 L76.5 26.5" />}</g>
    </svg>
  </Shell>;
}
