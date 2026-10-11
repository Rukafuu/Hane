// Storage boundary: browser data only. A desktop adapter can implement this contract.
export const DEFAULT_GENERAL = Object.freeze({ startup: 'welcome', confirmDestructive: true, notifications: true, desktopNotifications: false, maxProviderCalls: 3, maxToolCalls: 8, defaultProvider: '' });
// The backend owns these ceilings (src/server/mission-server.js and
// src/server/conversations-api.js). The UI mirrors them so a stored preference
// cannot be a value the server would refuse; a call budget is not the
// eight-member group limit.
export const BUDGET_LIMITS = Object.freeze({ maxProviderCalls: 64, maxToolCalls: 24 });
export const DEFAULT_APPEARANCE = Object.freeze({ theme: 'midnight', accent: '#78a9ff', font: 'system', textSize: 'comfortable', density: 'comfortable', width: 'comfortable', motion: 'full', weight: 'normal' });
export const THEME_PRESETS = Object.freeze({ midnight: '#78a9ff', forest: '#7cb58d', paper: '#ed799a' });
export function readPreference(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; }
}
export function writePreference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function normalizeAppearance(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const result = { ...DEFAULT_APPEARANCE };
  const enums = { theme: ['midnight','forest','paper'], font: ['system','hane','mono'], textSize: ['compact','comfortable','large'], density: ['compact','comfortable','spacious'], width: ['comfortable','wide'], motion: ['full','subtle','none'], weight: ['normal','medium'] };
  for (const [key, values] of Object.entries(enums)) if (values.includes(value[key])) result[key] = value[key];
  result.accent = /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : THEME_PRESETS[result.theme];
  return result;
}
export function normalizeGeneral(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const next = { ...DEFAULT_GENERAL };
  if (['welcome','latest'].includes(value.startup)) next.startup = value.startup;
  for (const key of ['confirmDestructive','notifications','desktopNotifications']) if (typeof value[key] === 'boolean') next[key] = value[key];
  for (const key of ['maxProviderCalls','maxToolCalls']) if (Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= BUDGET_LIMITS[key]) next[key] = value[key];
  if (typeof value.defaultProvider === 'string') next.defaultProvider = value.defaultProvider;
  return next;
}
export function validateLibrary(data) {
  if (!data || !Array.isArray(data.agents) || !Array.isArray(data.groups) || data.agents.length > 200 || data.groups.length > 200) throw new Error('Biblioteca inválida.');
  const ids = new Set();
  const agents = data.agents.map(a => {
    if (!a || typeof a.id !== 'string' || ids.has(a.id) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) throw new Error('Agente inválido.');
    ids.add(a.id);
    return { id: a.id, name: a.name, description: String(a.description || '').slice(0,1000), instructions: String(a.instructions || '').slice(0,12000), instructionFiles:Array.isArray(a.instructionFiles)?a.instructionFiles.slice(0,8).map(d=>({id:String(d.id),name:String(d.name).slice(0,120),text:String(d.text).slice(0,12000)})):[], capabilities:Array.isArray(a.capabilities)?[...new Set(a.capabilities.filter(n=>['workspace.read','workspace.write','process.run','network.request'].includes(n)))]:[], provider: String(a.provider || ''), exclusive: a.exclusive === true, shape: ['pebble','diamond','triangle','cloud'].includes(a.shape) ? a.shape : 'pebble', color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#ed799a', groupId: typeof a.groupId === 'string' ? a.groupId : '', image: typeof a.image === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(a.image) && a.image.length < 7000000 ? a.image : null };
  });
  const groupIds = new Set();
  const groups = data.groups.map(g => {
    if (!g || typeof g.id !== 'string' || groupIds.has(g.id) || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 80 || !Array.isArray(g.members) || g.members.length > 8 || new Set(g.members).size !== g.members.length || g.members.some(id => !ids.has(id))) throw new Error('Grupo inválido: até oito integrantes únicos.');
    groupIds.add(g.id);
    return { id: g.id, name: g.name, description: String(g.description || '').slice(0,1000), color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#ed799a', archivedAt: typeof g.archivedAt === 'string' ? g.archivedAt : null, members: g.members, leader: g.members.includes(g.leader) ? g.leader : '', runs: Array.isArray(g.runs) ? g.runs.filter(id => typeof id === 'string').slice(0,10000) : [] };
  });
  if (agents.some(a => a.groupId && !groupIds.has(a.groupId)) || groups.some(g => g.members.some(id => agents.find(a => a.id === id)?.groupId && agents.find(a => a.id === id).groupId !== g.id))) throw new Error('Integrante exclusivo pertence a outro grupo.');
  return { agents, groups };
}
export function accentText(accent) {
  const luminance = hex => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  const background = luminance(accent);
  for (const ink of ['#10151c','#ffffff','#000000']) {
    const foreground = luminance(ink);
    if ((Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05)>=4.5) return ink;
  }
  return '#000000';
}
export const appearanceStyle = a => ({ '--user-accent': a.accent, '--accent-ink': accentText(a.accent), '--user-font': a.font === 'mono' ? 'var(--font-mono)' : a.font === 'hane' ? '"Hane Sans", "Segoe UI", system-ui' : '"Segoe UI Variable Text", "Segoe UI", system-ui', '--reading-width': a.width === 'wide' ? '1100px' : '760px', '--reading-weight': a.weight === 'medium' ? 500 : 400 });
