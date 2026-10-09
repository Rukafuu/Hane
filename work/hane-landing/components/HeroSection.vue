<script setup lang="ts">
import {
  PhDownload as Download, PhUserPlus as UserPlus, PhShieldCheck as ShieldCheck
} from "@phosphor-icons/vue";

const { show: showDownload } = useDownloadModal();
</script>

<template>
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy-col">
        <span class="hero-badge"><i class="dot" /> Local-first · seus dados ficam na sua máquina</span>
        <h1 class="hero-title">
          Uma equipe de <span class="accent">agentes de IA</span> que trabalha no seu computador, sob o seu comando
        </h1>
        <p class="hero-copy">
          O Hane é um orquestrador local de agentes de IA para desktop. Você descreve o
          objetivo; agentes especialistas planejam, executam e revisam com evidências —
          dentro de um orçamento explícito e sempre com a sua aprovação antes de qualquer
          ação importante.
        </p>
        <div class="hero-ctas">
          <button class="btn btn-primary btn-lg" @click="showDownload">
            <Download />
            Baixar para Windows
          </button>
          <NuxtLink to="/cadastro" class="btn btn-ghost btn-lg">
            <UserPlus />
            Criar conta
          </NuxtLink>
        </div>
        <p class="hero-note">
          <ShieldCheck />
          Sem cartão de crédito · sua chave de API fica no cofre do sistema
        </p>
      </div>
      <ProductMock />
    </div>
  </section>
</template>
