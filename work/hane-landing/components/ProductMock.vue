<script setup lang="ts">
import {
  PhSparkle as Sparkle, PhCode as Code, PhMagnifyingGlass as MagnifyingGlass, PhShieldCheck as ShieldCheck, PhCheck as Check, PhCrown as Crown, PhPaperPlaneRight as PaperPlaneRight, PhCircleNotch as CircleNotch
} from "@phosphor-icons/vue";

const agents = [
  { id: 'orion', name: 'Orion', role: 'Coordenador', icon: Sparkle, tone: 'lilac' },
  { id: 'byte', name: 'Byte', role: 'Engenharia', icon: Code, tone: 'blue' },
  { id: 'nova', name: 'Nova', role: 'Pesquisa', icon: MagnifyingGlass, tone: 'peach' },
  { id: 'cipher', name: 'Cipher', role: 'Segurança', icon: ShieldCheck, tone: 'mint' },
];
</script>

<template>
  <div class="mock-window" aria-hidden="true">
    <div class="mock-titlebar">
      <span class="tb-dot pink" /><span class="tb-dot amber" /><span class="tb-dot green" />
      <span class="tb-title">Hane — Equipe de Desenvolvimento</span>
      <span class="tb-live"><i /> AO VIVO</span>
    </div>
    <div class="mock-body">
      <aside class="mock-side">
        <div class="mock-side-brand"><img src="/brand/hane_mark_gradient_transparent.png" alt="" /> Hane</div>
        <div v-for="agent in agents" :key="agent.id" class="mock-agent">
          <span class="mock-avatar" :class="agent.tone"><component :is="agent.icon" weight="bold" /></span>
          <span class="mock-agent-copy"><b>{{ agent.name }}</b><small>{{ agent.role }}</small></span>
          <i class="mock-online" />
        </div>
        <div class="mock-side-foot">2/6 chamadas</div>
      </aside>
      <section class="mock-thread">
        <article class="mock-msg">
          <header><b>Orion</b><small>Coordenador</small><span class="leader"><Crown weight="fill" /> Líder</span></header>
          <p>Bom dia, equipe. Recebemos o serviço de autenticação. Vou organizar a análise antes de propor alterações.</p>
          <div class="mock-tasks">
            <div><span class="mock-task-name">Mapear arquitetura</span><span class="mock-status running">Executando</span></div>
            <div><span class="mock-task-name">Analisar documentação</span><span class="mock-status done"><Check weight="bold" /> Concluído</span></div>
            <div><span class="mock-task-name">Revisar segurança</span><span class="mock-status queued">Na fila</span></div>
          </div>
        </article>
        <article class="mock-msg">
          <header><b>Byte</b><small>Eng. de software</small></header>
          <p>Mapeamento concluído: <b>24 módulos</b> e 1 dependência circular entre sessão e usuário.</p>
        </article>
        <article class="mock-msg user">
          <small>Você · agora</small>
          <p>Aprovem a investigação, sem escrita por enquanto.</p>
        </article>
        <div class="mock-composer"><span>Pedir para a equipe…</span><span class="mock-send"><PaperPlaneRight weight="fill" /></span></div>
      </section>
      <aside class="mock-panel">
        <div class="mock-panel-head"><b>Progresso</b><span>67%</span></div>
        <div class="mock-track"><i /></div>
        <div class="mock-panel-title"><CircleNotch class="spin" /> Agentes ativos</div>
        <div class="mock-active"><i class="pulse" /> Byte · Mapeando dependências</div>
        <div class="mock-active"><i class="pulse delay" /> Cipher · Revisando segurança</div>
        <div class="mock-approval">
          <b>Pronto para revisar</b>
          <small>Revise o plano antes de liberar a próxima etapa.</small>
          <span>Revisar e aprovar</span>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.mock-window {
  border-radius: 18px;
  background: var(--raise);
  box-shadow: var(--shadow-lift);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .5);
}
.mock-titlebar {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  background: var(--raise-2);
  border-bottom: 1px solid var(--line-soft);
}
.tb-dot { width: 9px; height: 9px; border-radius: 50%; }
.tb-dot.pink { background: #e69aab; }
.tb-dot.amber { background: #dbbd7d; }
.tb-dot.green { background: #83bba5; }
.tb-title {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}
.tb-live {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--pink-deep);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .08em;
}
.tb-live i { width: 6px; height: 6px; border-radius: 50%; background: var(--pink); box-shadow: 0 0 0 3px rgba(237, 121, 154, .16); }
.mock-body {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr) 158px;
  min-height: 380px;
}
.mock-side {
  background: var(--surface);
  border-right: 1px solid var(--line-soft);
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mock-side-brand {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 6px 12px;
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 500;
}
.mock-side-brand img { width: 20px; height: 20px; }
.mock-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 6px;
  border-radius: 10px;
}
.mock-avatar {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 8px 6px 8px 6px;
  color: #54606d;
  border: 1px solid rgba(255, 255, 255, .72);
}
.mock-avatar svg { width: 13px; height: 13px; }
.mock-avatar.lilac { background: #e7e2f3; color: #776a98; }
.mock-avatar.blue { background: #dfeaf2; color: #607f96; }
.mock-avatar.peach { background: #f1e2da; color: #9c6d58; }
.mock-avatar.mint { background: #dcece6; color: #5f8a7a; }
.mock-agent-copy { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.mock-agent-copy b { font-size: 11.5px; font-weight: 600; }
.mock-agent-copy small { font-size: 9.5px; color: var(--ink-3); }
.mock-online { width: 5px; height: 5px; margin-left: auto; border-radius: 50%; background: #75b69e; box-shadow: 0 0 0 3px rgba(117, 182, 158, .12); }
.mock-side-foot {
  margin-top: auto;
  padding: 9px 6px 2px;
  border-top: 1px solid var(--line-soft);
  color: var(--ink-3);
  font-size: 9.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mock-thread {
  padding: 16px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  background: var(--raise);
}
.mock-msg {
  padding: 12px 14px;
  border-radius: 13px;
  background: var(--raise-2);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--line-soft);
}
.mock-msg header { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.mock-msg header b { font-size: 12px; font-weight: 650; }
.mock-msg header small { font-size: 10px; color: var(--ink-3); font-weight: 500; }
.mock-msg .leader {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 8.5px;
  font-weight: 650;
}
.mock-msg .leader svg { width: 9px; height: 9px; }
.mock-msg p { margin: 0; color: var(--ink-2); font-size: 11.5px; line-height: 1.55; }
.mock-msg p b { color: var(--ink); font-weight: 650; }
.mock-tasks { margin-top: 9px; border-top: 1px solid var(--line-soft); display: grid; }
.mock-tasks > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(37, 44, 56, .07); }
.mock-tasks > div:last-child { border-bottom: 0; }
.mock-task-name { font-size: 10px; font-weight: 550; color: var(--ink-2); }
.mock-status { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 6px; font-size: 8.5px; font-weight: 650; white-space: nowrap; }
.mock-status svg { width: 9px; height: 9px; }
.mock-status.running { color: var(--blue); background: var(--blue-soft); }
.mock-status.done { color: var(--green); background: var(--green-soft); }
.mock-status.queued { color: var(--amber); background: var(--amber-soft); }
.mock-msg.user {
  align-self: flex-end;
  max-width: 82%;
  background: var(--pink-soft);
  border-color: rgba(212, 113, 143, .22);
}
.mock-msg.user small { display: block; font-size: 9px; color: #a26074; margin-bottom: 3px; }
.mock-msg.user p { color: #70414f; }
.mock-composer {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-radius: 12px;
  background: var(--inset);
  box-shadow: var(--inset-shadow);
  color: var(--ink-3);
  font-size: 11px;
}
.mock-send {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--pink);
  color: #fff;
}
.mock-send svg { width: 12px; height: 12px; }
.mock-panel {
  background: var(--surface);
  border-left: 1px solid var(--line-soft);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mock-panel-head { display: flex; justify-content: space-between; align-items: center; }
.mock-panel-head b { font-size: 11px; font-weight: 650; }
.mock-panel-head span { font-size: 10px; color: var(--ink-3); font-weight: 600; font-variant-numeric: tabular-nums; }
.mock-track { height: 6px; border-radius: 6px; background: var(--inset); overflow: hidden; }
.mock-track i { display: block; width: 67%; height: 100%; background: var(--blue); border-radius: inherit; }
.mock-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  font-weight: 650;
  color: var(--ink-2);
}
.mock-panel-title svg { width: 12px; height: 12px; color: var(--blue); }
.mock-active { display: flex; align-items: center; gap: 7px; font-size: 9.5px; color: var(--ink-2); font-weight: 500; }
.mock-active i { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); }
.mock-active i.pulse { animation: pulse 1.6s ease-in-out infinite; }
.mock-active i.pulse.delay { animation-delay: .5s; background: var(--green); }
.mock-approval {
  margin-top: auto;
  padding: 11px;
  border-radius: 12px;
  background: #f8edf1;
  border: 1px solid rgba(212, 113, 143, .2);
  display: grid;
  gap: 4px;
}
.mock-approval b { font-size: 10.5px; font-weight: 650; }
.mock-approval small { font-size: 9px; color: #795f67; line-height: 1.4; }
.mock-approval span {
  margin-top: 6px;
  display: grid;
  place-items: center;
  height: 26px;
  border-radius: 8px;
  background: var(--pink);
  color: #fff;
  font-size: 9.5px;
  font-weight: 650;
}
.spin { animation: spin 1.4s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { opacity: .35; } }

@media (max-width: 640px) {
  .mock-body { grid-template-columns: 130px minmax(0, 1fr); }
  .mock-panel { display: none; }
}
</style>
