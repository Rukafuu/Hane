<script setup lang="ts">
import {
  PhShieldCheck as ShieldCheck, PhHardDrive as HardDrive, PhKey as Key, PhUserCheck as UserCheck
} from "@phosphor-icons/vue";

defineProps<{ mode: 'login' | 'signup' }>();

const points = [
  { icon: HardDrive, text: 'Missões e auditoria ficam no seu SQLite local.' },
  { icon: Key, text: 'Sua chave de API vive no cofre do sistema, nunca em disco.' },
  { icon: UserCheck, text: 'Nenhuma ação consequente sem a sua aprovação.' },
];
</script>

<template>
  <section class="auth-page">
    <div class="container auth-grid">
      <aside class="auth-aside">
        <NuxtLink to="/" class="auth-brand">
          <img src="/brand/hane_mark_gradient_transparent.png" alt="" width="32" height="32" />
          <span>Hane</span>
        </NuxtLink>
        <h2>
          {{ mode === 'login'
            ? 'Bem-vindo de volta à sua estação de trabalho.'
            : 'Crie sua conta e comece com o controle na mão.' }}
        </h2>
        <p class="auth-aside-lead">
          O Hane orquestra agentes de IA no seu computador. A conta serve para acompanhar
          lançamentos e sincronizar preferências — seus dados de missão continuam locais.
        </p>
        <ul class="auth-points">
          <li v-for="point in points" :key="point.text">
            <span class="point-icon"><component :is="point.icon" /></span>
            <span>{{ point.text }}</span>
          </li>
        </ul>
        <p class="auth-aside-foot">
          <ShieldCheck /> Protótipo: nenhum dado é enviado para servidores.
        </p>
      </aside>

      <div class="auth-panel">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.auth-page { padding: 56px 0 84px; }
.auth-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
  gap: clamp(32px, 6vw, 80px);
  align-items: start;
}
.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 26px;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 23px;
  font-weight: 500;
  text-decoration: none;
}
.auth-aside h2 {
  margin: 0 0 14px;
  font-size: clamp(24px, 2.6vw, 31px);
  font-weight: 650;
  line-height: 1.22;
  letter-spacing: -.014em;
}
.auth-aside-lead {
  margin: 0 0 28px;
  max-width: 460px;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 1.65;
}
.auth-points {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}
.auth-points li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.55;
}
.point-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: var(--raise);
  box-shadow: var(--shadow-sm);
  color: var(--pink-deep);
}
.point-icon svg { width: 17px; height: 17px; }
.auth-aside-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid var(--line-soft);
  color: var(--ink-3);
  font-size: 12.5px;
  font-weight: 500;
}
.auth-aside-foot svg { width: 15px; height: 15px; color: var(--green); }
.auth-panel {
  padding: clamp(26px, 3vw, 36px);
  border-radius: 20px;
  background: var(--raise);
  box-shadow: var(--shadow-lift);
}

@media (max-width: 900px) {
  .auth-grid { grid-template-columns: 1fr; }
  .auth-aside { display: none; }
  .auth-panel { max-width: 460px; margin-inline: auto; width: 100%; }
}
</style>
