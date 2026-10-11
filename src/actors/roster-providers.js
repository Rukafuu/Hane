import { assertId } from '../teams/domain.js';
import { ProviderConfigError } from '../providers/provider-factory.js';

/**
 * Who works an actor mission, and with what model each of them answers.
 *
 * The sequential preset binds three roles to three agents; an actor execution
 * binds *members* — everyone in the group, each with its own provider. This is
 * the one place that mapping happens, because the alternative is each caller
 * resolving a provider per agent and deciding the fallback rules twice.
 *
 * Every configuration is validated before a credential is read, and one provider
 * instance is shared by the agents that name the same label: two teammates on the
 * same model are two actors, not two HTTP clients.
 */
export async function resolveActorRoster({ agentIds, agentStore, providerConfigStore, credentialManager, createProvider, fallbackProvider = null }) {
  if (!Array.isArray(agentIds) || agentIds.length === 0) throw new ProviderConfigError('An actor execution needs at least one agent.');
  if (!agentStore || !providerConfigStore) throw new ProviderConfigError('Actor rosters need agent and provider storage.');

  const roster = [];
  const providers = new Map();
  const instances = new Map();
  for (const rawId of agentIds) {
    const agentId = assertId(rawId, 'agentId');
    const agent = agentStore.get(agentId);
    if (!agent) throw new ProviderConfigError(`Selected agent ${agentId} no longer exists.`);
    const config = pickConfig(providerConfigStore, agent.providerLabel ?? fallbackProvider, agent.name);
    if (!instances.has(config.label)) instances.set(config.label, await createProvider({ config, credentialManager }));
    providers.set(agentId, instances.get(config.label));
    roster.push(Object.freeze({
      agentId,
      name: agent.name,
      instructions: agent.instructions,
      instructionFiles: Object.freeze(agent.instructionFiles.map((file) => ({ ...file }))),
      capabilities: Object.freeze([...agent.capabilities]),
      providerLabel: config.label,
      model: config.model,
    }));
  }
  return { roster: Object.freeze(roster), providers };
}

function pickConfig(store, label, agentName) {
  const found = label ? [store.findByLabel(label)].filter(Boolean) : store.list();
  if (found.length !== 1) {
    throw new ProviderConfigError(label
      ? `Agent ${agentName} names unknown provider "${label}". Restore its configuration before starting.`
      : `Agent ${agentName} has no provider configured and the mission names no fallback.`);
  }
  return found[0];
}
