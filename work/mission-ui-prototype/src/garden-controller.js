// Visual state only. No profile data, storage, network or business transitions.
export const GARDEN_IDLE_MS = 45000;
export function createGardenController(now = () => performance.now()) {
  let lastActivity = now(), pulseUntil = 0, pointer = null, clicks = 0, lastClick = -Infinity, eggUntil = 0;
  let dragging = false, blink = 0, wasSleeping = false;
  return {
    activity() { if (wasSleeping) { blink++; wasSleeping=false; } lastActivity = now(); },
    point(x, y) { pointer = x == null ? null : { x, y }; },
    drag(active) { dragging = active; this.activity(); },
    event(type) { this.activity(); if (type === 'explore') pulseUntil = now() + 850; },
    orbClick() {
      this.activity();
      if (now() < eggUntil) return false;
      clicks = now() - lastClick > 6000 ? 1 : clicks + 1; lastClick = now();
      if (clicks < 5) return false;
      clicks = 0; eggUntil = now() + 1700; blink++; return true;
    },
    snapshot() {
      wasSleeping = now() - lastActivity >= GARDEN_IDLE_MS;
      // Direct manipulation takes priority. Every transient state expires naturally.
      const state = dragging ? 'tracking' : now() < eggUntil ? 'celebrating' : now() < pulseUntil ? 'curious' : wasSleeping ? 'sleeping' : pointer ? 'tracking' : 'idle';
      return { state, pointer, dragging, feather: now() < eggUntil, bump: Math.max(0, 1 - (now() - lastClick) / 320), blink };
    },
  };
}
export function springStep(position, velocity, target, dt) {
  const time = Math.min(Math.max(dt, 0), 1 / 30);
  const speed = (velocity + (target - position) * 95 * time) * Math.exp(-13 * time);
  return { position: position + speed * time, velocity: speed };
}
