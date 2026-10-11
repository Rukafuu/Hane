import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_RUNTIME_EVENTS, actorPresenceFromEvents, avatarStateFromActorEvent } from "../src/avatar-runtime.js";
import {
  ACTOR_TASK_STATUS_LABELS,
  activeActorCount,
  activeActorsLabel,
  actorConversationRows,
  actorEvidenceRows,
  actorWorkPoints,
} from "../src/workspace-evidence.js";

// The vocabulary HaneAvatar renders (BEHAVIOURS in src/HaneAvatar.jsx). An
// adapter that returns a state outside it silently falls back to `idle`, which
// is how a working teammate ends up drawn asleep.
const RENDERED_STATES = new Set(["idle", "thinking", "working", "waiting", "blocked", "done", "error"]);

const ana = "0f0f0f0f-1111-4111-8111-111111111111";
const beto = "0f0f0f0f-2222-4222-8222-222222222222";

test("every avatar state an actor event can produce is one the renderer draws", () => {
  for (const [type, state] of Object.entries(AVATAR_RUNTIME_EVENTS)) {
    assert.equal(RENDERED_STATES.has(state), true, `${type} maps to "${state}", which HaneAvatar has no behaviour for`);
  }
  assert.equal(Object.hasOwn(AVATAR_RUNTIME_EVENTS, "agent.started"), false, "the reserved fiction names are gone");
});

test("an actor event speaks for one teammate, in either shape the server sends", () => {
  assert.equal(avatarStateFromActorEvent({ type: "actor_started", actorId: ana, taskId: "t1" }), "working");
  assert.equal(avatarStateFromActorEvent({ type: "actor_message", actorId: ana, toAgentId: beto }), "thinking");
  assert.equal(avatarStateFromActorEvent({ type: "actor_task_completed", actorId: ana, taskId: "t1" }), "done");
  assert.equal(avatarStateFromActorEvent({ type: "actor_refused", actorId: ana, reason: "provider_budget_exhausted" }), "blocked");

  // The stored row nests what the broadcast flattens; both must read the same.
  assert.equal(avatarStateFromActorEvent({ type: "actor_stopped", actorId: ana, ordinal: 4, payload: { taskId: "t1", status: "failed", reason: "turn_failed" } }), "error");
  assert.equal(avatarStateFromActorEvent({ type: "actor_stopped", actorId: ana, status: "ready", reason: "lease_expired" }), "waiting");

  // A mission-level refusal names no teammate, so it is not anybody's face.
  assert.equal(avatarStateFromActorEvent({ type: "actor_refused", actorId: null, reason: "no_runnable_task" }), null);
  assert.equal(avatarStateFromActorEvent({ type: "run_finished", actorId: ana, task: {} }), null);
  assert.equal(avatarStateFromActorEvent(null), null);
});

test("presence folds a trail to the last thing said about each teammate", () => {
  const presence = actorPresenceFromEvents([
    { type: "actor_started", actorId: ana, ordinal: 2, taskId: "t1" },
    { type: "actor_started", actorId: beto, ordinal: 3, taskId: "t2" },
    { type: "actor_task_completed", actorId: ana, ordinal: 6, taskId: "t1", payload: { taskId: "t1" } },
    { type: "actor_state_committed", actorId: ana, ordinal: 7, payload: { key: "task:t1", revision: 1 } },
  ]);
  assert.deepEqual(presence, {
    [ana]: { agentId: ana, state: "working", taskId: "t1", ordinal: 7 },
    [beto]: { agentId: beto, state: "working", taskId: "t2", ordinal: 3 },
  });

  // Out of order in, ordered by ordinal inside: a client that reconnects and
  // reads the catch-up after a live event must land on the same face.
  const scrambled = actorPresenceFromEvents([
    { type: "actor_task_completed", actorId: ana, ordinal: 9, payload: { taskId: "t1" } },
    { type: "actor_started", actorId: ana, ordinal: 8, taskId: "t1" },
  ]);
  assert.equal(scrambled[ana].state, "done");
  assert.equal(scrambled[ana].ordinal, 9);
});

test("nothing that did not happen is present", () => {
  assert.deepEqual(actorPresenceFromEvents([]), {});
  assert.deepEqual(actorEvidenceRows([]), []);
  assert.deepEqual(actorPresenceFromEvents([{ type: "provider_retry", actorId: ana, ordinal: 1 }]), {});
});

test("the work list shows the tasks the plan booked, not a fixed band", () => {
  const payload = {
    missionId: "m",
    counts: { total: 3, pending: 1, ready: 0, running: 1, completed: 1, failed: 0, blocked: 0 },
    actors: [
      { agentId: ana, name: "Ana", tasks: [{ id: "t1", title: "Ler o módulo", status: "completed", note: null, attempts: 1, resultKey: "task:t1" }] },
      { agentId: beto, name: "Beto", tasks: [
        { id: "t2", title: "Rodar os testes", status: "running", note: null, attempts: 2, resultKey: null },
        { id: "t4", title: "Escrever o relatório", status: "pending", note: null, attempts: 0, resultKey: null },
      ] },
    ],
  };
  const points = actorWorkPoints(payload);
  assert.deepEqual(points.map((point) => [point.id, point.label, point.agentName]), [
    [`${ana}:t1`, "concluída", "Ana"],
    [`${beto}:t2`, "em execução", "Beto"],
    [`${beto}:t4`, "na fila", "Beto"],
  ]);
  assert.equal(points[1].attempts, 2);
  assert.equal(activeActorCount(payload), 1);
  assert.equal(activeActorsLabel(activeActorCount(payload)), "1 ator ativo");
  assert.equal(activeActorsLabel(3), "3 atores ativos");
  assert.equal(activeActorsLabel(0), null, "an idle crew is not labelled as a count");

  // The store's own words are the labels; a status the backend invents later is
  // shown verbatim rather than turned into a guess.
  assert.equal(ACTOR_TASK_STATUS_LABELS.blocked, "bloqueada");
  assert.deepEqual(actorWorkPoints({ actors: null }), []);
});

test("the live computer reads the event trail the server wrote", () => {
  const rows = actorEvidenceRows([
    { ordinal: 3, type: "actor_started", actorId: ana, createdAt: "2026-10-11T10:00:01.000Z", payload: { taskId: "t1", title: "Ler o módulo", attempts: 1 } },
    { ordinal: 4, type: "actor_started", actorId: beto, createdAt: "2026-10-11T10:00:01.500Z", payload: { taskId: "t2", title: "Rodar os testes", attempts: 2 } },
    { ordinal: 5, type: "actor_state_committed", actorId: ana, createdAt: "2026-10-11T10:00:02.000Z", payload: { key: "task:t1", revision: 1 } },
    { ordinal: 6, type: "actor_message", actorId: beto, createdAt: "2026-10-11T10:00:02.500Z", payload: { fromAgentId: beto, toAgentId: ana, body: "Preciso do caminho do fixture.", priority: "normal" } },
    { ordinal: 7, type: "actor_refused", actorId: null, createdAt: "2026-10-11T10:00:03.000Z", payload: { reason: "pair_limit_exceeded", tasks: ["t4"] } },
    { ordinal: 8, type: "actor_stopped", actorId: beto, createdAt: "2026-10-11T10:00:04.000Z", payload: { taskId: "t2", status: "failed", reason: "turn_failed" } },
    { ordinal: 9, type: "task_created", actorId: null, payload: { objective: "Ignorada" } },
  ]);

  assert.deepEqual(rows.map((row) => [row.ordinal, row.label]), [
    [3, "começou"],
    [4, "começou"],
    [5, "estado escrito"],
    [6, "mensagem"],
    [7, "recusado"],
    [8, "falhou"],
  ]);
  assert.equal(rows[0].text, "Ler o módulo");
  assert.equal(rows[1].meta, "2ª tentativa");
  assert.equal(rows[2].text, "task:t1");
  assert.equal(rows[2].meta, "revisão 1");
  assert.equal(rows[3].agentId, beto);
  assert.equal(rows[4].meta, "este colega já enviou mensagens demais para o mesmo destino");
  assert.equal(rows[4].text, "t4");
  assert.equal(rows[5].kind, "error");

  // The body of a peer message belongs to the inbox, where the user reads it with
  // a sender and a delivery status. Here it would be decoration.
  assert.equal(JSON.stringify(rows).includes("fixture"), false);

  // A live broadcast flattens the payload; the same row still reads.
  const live = actorEvidenceRows([{ type: "actor_started", actorId: ana, ordinal: 1, taskId: "t1", title: "Ler o módulo", attempts: 1 }]);
  assert.deepEqual(live.map((row) => [row.label, row.text]), [["começou", "Ler o módulo"]]);

  assert.deepEqual(actorEvidenceRows(null), []);
});

test("the actor conversation shows only what the board holds, and the plan says who is still writing", () => {
  const crew = { actors: [
    { agentId: ana, name: "Ana", tasks: [{ id: "t1", title: "Ler o módulo", status: "completed", note: null, attempts: 1, resultKey: "task:t1" }] },
    { agentId: beto, name: "Beto", tasks: [{ id: "t2", title: "Rodar os testes", status: "running", note: null, attempts: 1, resultKey: null }] },
  ] };
  const board = { revisionOf: [
    { key: "task:t1", revision: 2, writerAgentId: ana, updatedAt: "2026-10-11T12:00:02.000Z", value: { taskId: "t1", agentId: ana, title: "Ler o módulo", content: "A fila é FIFO." } },
    { key: "task:t9", revision: 1, writerAgentId: beto, updatedAt: "2026-10-11T12:00:01.000Z", value: null },
    { key: "run:notes", revision: 1, writerAgentId: ana, updatedAt: "2026-10-11T12:00:03.000Z", value: { content: "estado que nenhuma tarefa escreveu" } },
  ] };
  const turns = actorConversationRows(crew, board);
  assert.deepEqual(turns.map((turn) => [turn.agentId, turn.title, turn.running]), [[ana, "Ler o módulo", false], [beto, "Rodar os testes", true]]);
  assert.equal(turns[0].text, "A fila é FIFO.");
  assert.equal(turns[0].revision, 2, "a second revision is not a second result");
  assert.equal(turns[0].at, "2026-10-11T12:00:02.000Z");
  assert.equal(turns[1].text, null, "a task still running has no text to invent");
  assert.equal(JSON.stringify(turns).includes("nenhuma tarefa"), false);

  // A crew the server has not answered for is not an empty crew.
  assert.deepEqual(actorConversationRows(null, null), []);
});
