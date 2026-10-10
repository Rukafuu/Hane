const description =
  'O Hane é um orquestrador local-first de agentes de IA para desktop. Você define o objetivo; agentes especialistas planejam, executam e entregam evidências — com seus dados e suas chaves sempre na sua máquina.';

export default defineNuxtConfig({
  compatibilityDate: '2026-10-09',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      title: 'Hane — Agentes de IA no seu computador, sob o seu controle',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Hane' },
        { property: 'og:locale', content: 'pt_BR' },
        { property: 'og:title', content: 'Hane — Agentes de IA no seu computador, sob o seu controle' },
        { property: 'og:description', content: description },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: 'Hane — Agentes de IA no seu computador, sob o seu controle' },
        { name: 'twitter:description', content: description },
      ],
      link: [{ rel: 'icon', type: 'image/png', href: '/brand/hane_app_icon_1024.png' }],
    },
  },
});
