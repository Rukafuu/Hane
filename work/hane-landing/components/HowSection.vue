<script setup lang="ts">
const steps = [
  {
    title: 'Você descreve o objetivo',
    text: 'Uma frase basta. O objetivo vira uma missão com ciclo de vida próprio: planejamento, execução, revisão — ou sua atenção, se algo travar.',
    cli: { prompt: '$', command: 'hane run "Resuma os riscos de migrar para ESM"', flag: '--provider openrouter' },
  },
  {
    title: 'Agentes especialistas trabalham',
    text: 'O planner delimita o plano, o executor produz o resultado com evidências e o reviewer verifica limitações. Tudo dentro do orçamento de chamadas que você definiu.',
  },
  {
    title: 'Você revisa e aprova',
    text: 'Veredito, evidências e próximos passos ficam registrados na trilha de auditoria. Nenhuma ação consequente acontece sem o seu ok explícito.',
  },
];
</script>

<template>
  <section id="como-funciona" class="section section-raise">
    <div class="container">
      <div class="section-head-center">
        <p class="section-eyebrow">Como funciona</p>
        <h2 class="section-title">Do objetivo ao veredito em três passos</h2>
        <p class="section-lead">
          O mesmo ciclo vale para o app de desktop e para o CLI que já existe hoje —
          a missão inteira cabe em um comando.
        </p>
      </div>
      <div class="steps">
        <article v-for="(step, index) in steps" :key="step.title" class="step-card">
          <span class="step-number">{{ index + 1 }}</span>
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
          <div v-if="step.cli" class="cli-line">
            <code><span class="prompt">{{ step.cli.prompt + ' ' }}</span>{{ step.cli.command }}<span class="flag">{{ step.cli.flag }}</span></code>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
