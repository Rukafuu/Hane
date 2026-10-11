import { createHash } from 'node:crypto';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const OPENROUTER_CREDENTIAL = 'local-agent-orchestrator/openrouter-catalog';

// Only these fixed OpenRouter endpoints receive the credential. Remote errors
// and account metadata never cross back into the browser.
export function createOpenRouterApi({ database, providerConfigStore, credentialManager, fetchImpl, respondJson }) {
  let pending = false;
  const reply = (response, status, data) => { respondJson(response, status, data); return true; };
  async function remote(path, secret) {
    const response = await fetchImpl(OPENROUTER_BASE + path, {
      redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: 'Bearer ' + secret },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 403 ? 'key' : 'remote');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('remote');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 8 * 1024 * 1024) throw new Error('remote');
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function catalog(secret) {
    const result = await remote('/models', secret);
    if (!Array.isArray(result.data) || result.data.length > 5000) throw new Error('remote');
    const price = value => typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    return [...new Map(result.data.filter(m => typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 200 && m.architecture?.output_modalities?.includes('text')).map(m => [m.id, {
      id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 200) : m.id,
      contextLength: Number.isSafeInteger(m.context_length) && m.context_length > 0 ? m.context_length : null,
      promptPrice: price(m.pricing?.prompt), completionPrice: price(m.pricing?.completion),
    }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  return async ({ path, method, body, response, isAuthorized }) => {
    if (!path.startsWith('/api/settings/openrouter')) return false;
    if (path === '/api/settings/openrouter' && method === 'GET') {
      const configured = Boolean(await credentialManager.get(OPENROUTER_CREDENTIAL));
      if (!isAuthorized()) return reply(response, 401, { error: 'Sessão encerrada.' });
      return reply(response, 200, { configured });
    }
    if (!((path.endsWith('/secret') && method === 'POST') || (path.endsWith('/models') && ['GET', 'POST'].includes(method)))) return reply(response, 404, { error: 'Operação não encontrada.' });
    if (pending) return reply(response, 409, { error: 'Uma operação do OpenRouter já está em andamento.' });
    pending = true;
    try {
      if (path === '/api/settings/openrouter/secret') {
        if (typeof body.secret !== 'string' || !body.secret.trim() || body.secret.length > 8000 || /[\r\n]/.test(body.secret)) return reply(response, 400, { error: 'Informe uma chave válida do OpenRouter.' });
        const secret = body.secret.trim();
        const data = await remote('/key', secret);
        if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) throw new Error('remote');
        if (!isAuthorized()) return reply(response, 401, { error: 'Sessão encerrada.' });
        await credentialManager.set(OPENROUTER_CREDENTIAL, secret);
        return reply(response, 200, { configured: true });
      }
      if (path !== '/api/settings/openrouter/models') return reply(response, 404, { error: 'Operação não encontrada.' });
      const secret = await credentialManager.get(OPENROUTER_CREDENTIAL);
      if (!secret) return reply(response, 409, { error: 'Configure sua chave do OpenRouter primeiro.' });
      const models = await catalog(secret);
      if (!isAuthorized()) return reply(response, 401, { error: 'Sessão encerrada.' });
      if (method === 'GET') return reply(response, 200, { models, checkedAt: new Date().toISOString() });
      if (!Array.isArray(body.models) || !body.models.length || body.models.length > 50 || body.models.some(id => typeof id !== 'string')) return reply(response, 400, { error: 'Escolha de 1 a 50 modelos.' });
      const ids = [...new Set(body.models)];
      if (ids.some(id => !models.some(m => m.id === id))) return reply(response, 400, { error: 'Um modelo escolhido não está mais disponível. Atualize o catálogo.' });
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const id of ids) {
          const existing = providerConfigStore.list().find(p => p.baseUrl === OPENROUTER_BASE && p.model === id);
          if (existing) continue;
          const label = 'or-' + id.replace(/[^a-z0-9._-]/gi, '-').slice(0, 40) + '-' + createHash('sha256').update(id).digest('hex').slice(0, 16);
          if (providerConfigStore.findByLabel(label)) throw new Error('collision');
          providerConfigStore.upsert({ label, baseUrl: OPENROUTER_BASE, model: id, credentialReference: OPENROUTER_CREDENTIAL });
        }
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return reply(response, 200, { providers: providerConfigStore.list() });
    } catch (error) {
      return reply(response, error.message === 'key' ? 400 : 502, { error: error.message === 'key' ? 'O OpenRouter recusou a chave. Confira e tente novamente.' : 'Não foi possível conectar ao OpenRouter. Tente novamente em instantes.' });
    } finally { pending = false; }
  };
}
