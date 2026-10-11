import { useEffect, useState } from 'react';
import { libraryRequest as request } from './library-api.js';
import { SettingsSection } from './SettingsCenter.jsx';
import './openrouter.css';

const baseUrl = 'https://openrouter.ai/api/v1';
const number = new Intl.NumberFormat('pt-BR');
const price = value => value === null ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value * 1000000);

export default function OpenRouterModels({ providers, onProvidersChange }) {
  const [configured, setConfigured] = useState(null);
  const [secret, setSecret] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [models, setModels] = useState(null);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const added = new Set(providers.filter(p => p.baseUrl === baseUrl).map(p => p.model));
  useEffect(() => {
    let alive = true;
    request('settings/openrouter').then(data => { if (alive) setConfigured(data.configured); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  async function act(work) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function loadModels() {
    const data = await request('settings/openrouter/models');
    setModels(data.models); setSelected(ids => ids.filter(id => data.models.some(m => m.id === id) && !added.has(id)));
  }
  const visible = (models || []).filter(m => (!freeOnly || m.promptPrice === 0 && m.completionPrice === 0) && (m.name + ' ' + m.id).toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <SettingsSection title="Seu universo de modelos" note="Conecte o OpenRouter e escolha quais modelos ficam disponíveis para seus agentes e Teams.">
    <fieldset className="openrouter-panel" disabled={busy}>
      <div className="openrouter-connection"><div><strong>OpenRouter</strong><p>{configured === null ? 'Consultando conexão…' : configured ? 'Chave configurada no cofre de credenciais.' : 'Uma chave, vários modelos. Configure a sua para começar.'}</p></div>{configured && !editingKey && <button type="button" onClick={() => setEditingKey(true)}>Trocar chave</button>}</div>
      {(configured === false || editingKey) && <form className="runtime-form" onSubmit={e => {
        e.preventDefault(); const value = secret; setSecret('');
        act(async () => {
          await request('settings/openrouter/secret', 'POST', { secret: value });
          setConfigured(true); setEditingKey(false); setModels(null); setSelected([]);
          setMessage('Chave validada e guardada. Agora escolha seus modelos.');
        });
      }}>
        <label>API key do OpenRouter<input type="password" autoComplete="new-password" spellCheck={false} required maxLength={8000} value={secret} onChange={e => setSecret(e.target.value)} placeholder="Cole sua chave aqui" /></label>
        <p className="settings-description">Sua chave fica no cofre do sistema. A validação consulta a conta, sem gerar respostas.</p>
        <div className="library-toolbar"><button className="primary" disabled={!secret.trim()}>Validar e guardar chave</button><a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Criar chave no OpenRouter ↗</a>{editingKey && <button type="button" onClick={() => { setEditingKey(false); setSecret(''); }}>Cancelar</button>}</div>
      </form>}
      {configured && <>
        <div className="openrouter-toolbar"><button type="button" onClick={() => act(loadModels)}>{models ? 'Atualizar catálogo' : 'Explorar modelos'}</button>{models && <span>{number.format(models.length)} modelos de conversa</span>}</div>
        {models && <>
          <div className="openrouter-filters"><label>Encontrar um modelo<input type="search" placeholder="Nome, empresa ou identificador…" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="openrouter-check"><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} />Entrada e saída gratuitas</label></div>
          <p className="settings-description">Preços por 1 milhão de tokens, em USD, conforme o catálogo. Limites e outras cobranças dependem do OpenRouter.</p>
          <div className="openrouter-catalog" aria-label="Catálogo de modelos do OpenRouter">
            {visible.length === 0 && <p>Nenhum modelo encontrado. Tente outro nome ou filtro.</p>}
            {visible.map(model => <label className={'openrouter-model' + (selected.includes(model.id) ? ' is-selected' : '')} key={model.id}>
              <input type="checkbox" checked={added.has(model.id) || selected.includes(model.id)} disabled={added.has(model.id) || selected.length >= 50 && !selected.includes(model.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, model.id] : ids.filter(id => id !== model.id))} />
              <div><strong>{model.name}</strong><small>{model.id}</small><span>{model.contextLength ? number.format(model.contextLength) + ' tokens de contexto' : 'Contexto não informado'} · Entrada {price(model.promptPrice)} · Saída {price(model.completionPrice)}</span></div>
              {added.has(model.id) && <em>Adicionado</em>}
            </label>)}
          </div>
          <div className="openrouter-toolbar"><button className="primary" type="button" disabled={!selected.length} onClick={() => act(async () => {
            const data = await request('settings/openrouter/models', 'POST', { models: selected });
            onProvidersChange(data); setSelected([]); setMessage('Modelos adicionados. Você já pode escolhê-los nas conversas e nos agentes.');
          })}>Adicionar {selected.length || ''} {selected.length === 1 ? 'modelo' : 'modelos'} ao Hane</button><span>Até 50 por vez</span></div>
        </>}
      </>}
    </fieldset>
    {busy && <p role="status">Conectando ao OpenRouter…</p>}
    {error && <p className="settings-feedback" role="alert">{error} {configured === null && <button onClick={() => act(async () => setConfigured((await request('settings/openrouter')).configured))}>Tentar novamente</button>}</p>}
    {message && <p className="settings-feedback" role="status">{message}</p>}
  </SettingsSection>;
}
