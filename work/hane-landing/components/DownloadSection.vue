<script setup lang="ts">
import {
  PhDownload as Download, PhMonitor as Monitor, PhHardDrive as HardDrive, PhTreeStructure as TreeStructure
} from "@phosphor-icons/vue";

const { show: showDownload } = useDownloadModal();
</script>

<template>
  <section id="download" class="section">
    <div class="container">
      <div class="download-card">
        <img
          class="download-icon"
          src="/brand/hane_app_icon_1024.png"
          alt="Ícone do aplicativo Hane"
          width="116"
          height="116"
        />
        <div class="download-copy">
          <p class="section-eyebrow">Download</p>
          <h3>Hane para Windows</h3>
          <p>
            O app de desktop está em forja — o núcleo de orquestração já roda no terminal,
            e a interface que você viu acima chega em breve. Baixe quando estiver pronto
            ou crie sua conta para acompanhar.
          </p>
          <div class="download-meta">
            <span><Monitor /> Windows 10 ou superior</span>
            <span><HardDrive /> ~180 MB</span>
            <span><TreeStructure /> Núcleo v0.1 · interface em desenvolvimento</span>
          </div>
        </div>
        <div class="download-actions">
          <button class="btn btn-primary btn-lg" @click="showDownload">
            <Download />
            Baixar o instalador
          </button>
          <NuxtLink to="/cadastro" class="btn btn-ghost">Criar conta</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
