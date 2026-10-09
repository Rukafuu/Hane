<script setup lang="ts">
import {
  PhHouseLine as HouseLine
} from "@phosphor-icons/vue";

const { show: showDownload } = useDownloadModal();
</script>

<template>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <img src="/brand/hane_logo_primary_transparent.png" alt="Hane" />
          <p>
            Orquestrador local-first de agentes de IA. Seus dados, suas chaves e sua
            máquina — os agentes apenas trabalham para você.
          </p>
        </div>
        <div class="footer-col">
          <h4>Produto</h4>
          <ul>
            <li><NuxtLink to="/#o-que-e">O que é o Hane</NuxtLink></li>
            <li><NuxtLink to="/#diferenciais">Diferenciais</NuxtLink></li>
            <li><NuxtLink to="/#como-funciona">Como funciona</NuxtLink></li>
            <li><button @click="showDownload">Baixar o app</button></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Conta</h4>
          <ul>
            <li><NuxtLink to="/entrar">Entrar</NuxtLink></li>
            <li><NuxtLink to="/cadastro">Criar conta</NuxtLink></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Origem</h4>
          <ul>
            <li><span class="footer-static">Núcleo CLI open source</span></li>
            <li><span class="footer-static">SQLite + Credential Manager</span></li>
            <li><span class="footer-static">Providers compatíveis com OpenAI</span></li>
          </ul>
        </div>
      </div>
      <div class="footer-base">
        <span>© 2026 Hane. Todos os direitos reservados.</span>
        <span class="local-badge"><HouseLine /> Local-first · sem rastreadores</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer-static {
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 500;
}
</style>
