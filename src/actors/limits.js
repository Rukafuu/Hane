/**
 * Every number that bounds what a group of actors may do to each other and to
 * the mission's budget. They live in one file because each is a decision the
 * user made once, and a limit decided twice in two modules is a limit nobody
 * can state.
 *
 * The messaging limits exist to answer one trap: a model that answers everything
 * it reads. `maxHop` bounds how far a reply chain can travel, `messagesPerPair`
 * bounds one teammate pestering another, and `messagesProcessedPerActor` bounds
 * what one agent can take in over a whole run — so a conversation between two
 * agents is a bounded cost rather than an open loop.
 */
export const ACTOR_LIMITS = Object.freeze({
  /** How many reply generations a message may travel before it is refused. */
  maxHop: 3,
  /** Directed messages one agent may send to the same peer over a run. */
  messagesPerPair: 4,
  /** Messages one agent may take in over a run, however many peers send them. */
  messagesProcessedPerActor: 12,
  /** Actors running at the same instant, and the hard ceiling a user may raise it to. */
  maxConcurrentActors: 3,
  maxConcurrentActorsCeiling: 4,
  /** Provider calls one actor may spend. The mission's own budget stays the global ceiling. */
  providerCallsPerActor: 6,
  /** How much an agent reads per turn, and how long that read reserves it for. */
  claimBatch: 8,
  claimLeaseMs: 120_000,
});
