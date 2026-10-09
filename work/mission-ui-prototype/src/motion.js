import { animate, stagger } from "animejs";

export const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const list = (targets) =>
  targets == null ? [] : targets instanceof Element ? [targets] : [...targets];

export function entrance(root) {
  if (!root || reduceMotion()) return [];
  const groups = [
    { sel: [".brand-row", ".search-box", ".new-chat", ".agent-nav", ".conversation-row", ".sidebar-footer button"], base: 0, step: 26, y: 8, duration: 320 },
    { sel: [".conversation-header", ".messages > *", ".settings-sheet > section"], base: 90, step: 42, y: 12, duration: 380 },
    { sel: [".right-panel > header", ".panel-section", ".approval-card"], base: 170, step: 55, y: 10, duration: 340 },
  ];
  const runs = [];
  for (const g of groups) {
    const targets = g.sel.flatMap((s) => [...root.querySelectorAll(s)]);
    if (!targets.length) continue;
    runs.push(animate(targets, {
      opacity: [0, 1],
      translateY: [g.y, 0],
      duration: g.duration,
      delay: (el, i) => g.base + i * g.step,
      ease: "outQuad",
    }));
  }
  return runs;
}

export function staggerIn(targets, { y = 8, step = 28, duration = 300, base = 0 } = {}) {
  const items = list(targets);
  if (!items.length || reduceMotion()) return null;
  return animate(items, {
    opacity: [0, 1],
    translateY: [y, 0],
    duration,
    delay: (el, i) => base + i * step,
    ease: "outQuad",
  });
}

export function rise(targets, { y = 10, duration = 340 } = {}) {
  const items = list(targets);
  if (!items.length || reduceMotion()) return null;
  return animate(items, { opacity: [0, 1], translateY: [y, 0], duration, ease: "outQuad" });
}

export function toastOut(el) {
  if (!el || reduceMotion()) return Promise.resolve();
  return animate(el, { opacity: [1, 0], translateY: [0, 8], duration: 180, ease: "inQuad" }).finished;
}

export function pop(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { scale: [1, 0.92, 1], duration: 260, ease: "outQuad" });
}

export function approvePop(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { scale: [1, 0.95, 1.04, 1], duration: 420, ease: "outQuad" });
}

export function slideKnob(el, on) {
  if (!el || reduceMotion()) return null;
  return animate(el, { translateX: on ? 13 : 0, duration: 220, ease: "outQuad" });
}

export function spinLoop(el) {
  if (!el || reduceMotion()) return null;
  return animate(el, { rotate: "1turn", duration: 1000, ease: "linear", loop: true });
}

export function pulseLoop(targets) {
  const items = list(targets);
  if (!items.length || reduceMotion()) return null;
  return animate(items, { scale: [1, 1.45], duration: 850, delay: stagger(170), ease: "inOutSine", loop: true, alternate: true });
}

export function growBar(el, width = "67%") {
  if (!el || reduceMotion()) return null;
  return animate(el, { width: ["0%", width], duration: 900, delay: 350, ease: "outQuart" });
}
