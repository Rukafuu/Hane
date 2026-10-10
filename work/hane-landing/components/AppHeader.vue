<script setup lang="ts">
import {
  PhList as List, PhDownload as Download
} from "@phosphor-icons/vue";

const { user, logout } = useAuth();
const { show: showDownload } = useDownloadModal();
const { show: showToast } = useToast();

const navOpen = ref(false);

const links = [
  { href: '/#o-que-e', label: 'O que é' },
  { href: '/#diferenciais', label: 'Diferenciais' },
  { href: '/#como-funciona', label: 'Como funciona' },
  { href: '/#download', label: 'Download' },
];

function onLogout() {
  logout();
  showToast('Você saiu da sua conta');
  navOpen.value = false;
}
</script>

<template>
  <header class="site-header">
    <div class="container">
      <NuxtLink to="/" class="brand-link" aria-label="Hane — página inicial">
        <img src="/brand/hane_mark_gradient_transparent.png" alt="" width="30" height="30" />
        <span class="brand-word">Hane</span>
      </NuxtLink>

      <nav class="main-nav" :class="{ open: navOpen }" aria-label="Navegação principal">
        <NuxtLink v-for="link in links" :key="link.href" :to="link.href" @click="navOpen = false">
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="header-actions">
        <template v-if="user">
          <span class="user-chip">
            <span class="user-initial">{{ user.name.charAt(0).toUpperCase() }}</span>
            {{ user.name.split(' ')[0] }}
            <button @click="onLogout">Sair</button>
          </span>
        </template>
        <template v-else>
          <NuxtLink to="/entrar" class="btn btn-quiet">Entrar</NuxtLink>
          <button class="btn btn-primary" aria-label="Baixar o app" @click="showDownload">
            <Download />
            <span class="hide-sm">Baixar o app</span>
          </button>
        </template>
        <button
          class="nav-toggle"
          :aria-expanded="navOpen"
          :aria-label="navOpen ? 'Fechar menu' : 'Abrir menu'"
          @click="navOpen = !navOpen"
        >
          <List size="22" />
        </button>
      </div>
    </div>
  </header>
</template>
