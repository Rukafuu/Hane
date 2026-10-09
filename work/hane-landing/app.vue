<template>
  <div class="page-shell">
    <AppHeader />
    <main class="page-main">
      <NuxtPage />
    </main>
    <SiteFooter />
    <DownloadModal />
    <ToastHost />
  </div>
</template>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.page-main { flex: 1; }
</style>
