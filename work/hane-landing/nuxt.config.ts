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
        {
          name: 'description',
          content:
            'O Hane é um orquestrador local-first de agentes de IA para desktop. Você define o objetivo; agentes especialistas planejam, executam e entregam evidências — com seus dados e suas chaves sempre na sua máquina.',
        },
      ],
      link: [{ rel: 'icon', type: 'image/png', href: '/brand/hane-app-icon.png' }],
    },
  },
});
