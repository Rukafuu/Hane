export interface HaneUser {
  name: string;
  email: string;
}

const STORAGE_KEY = 'hane-user';

export function useAuth() {
  const user = useState<HaneUser | null>('hane-user', () => null);

  function load() {
    if (!import.meta.client) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      user.value = JSON.parse(raw);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function persist() {
    if (import.meta.client && user.value) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user.value));
    }
  }

  function displayNameFromEmail(email: string) {
    const raw = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    if (!raw) return 'Pessoa Hane';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function login(email: string) {
    user.value = { name: displayNameFromEmail(email), email };
    persist();
  }

  function signup(name: string, email: string) {
    user.value = { name: name.trim(), email };
    persist();
  }

  function logout() {
    user.value = null;
    if (import.meta.client) localStorage.removeItem(STORAGE_KEY);
  }

  return { user, load, login, signup, logout };
}
