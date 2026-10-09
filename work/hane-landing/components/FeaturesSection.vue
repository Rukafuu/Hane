<script setup lang="ts">
import {
  PhHardDrive as HardDrive, PhKey as Key, PhGauge as Gauge, PhScroll as Scroll, PhUserCheck as UserCheck, PhPlugs as Plugs
} from "@phosphor-icons/vue";

const features = [
  {
    icon: HardDrive,
    tone: '',
    title: 'Local-first de verdade',
    text: 'Missões, resultados e trilha de auditoria vivem num SQLite na sua máquina. O provedor de IA recebe apenas o contexto da tarefa em execução — nada de fila, conta ou histórico na nuvem de terceiros.',
  },
  {
    icon: Key,
    tone: 'tone-blue',
    title: 'Suas chaves, seu cofre',
    text: 'A chave da API fica no Gerenciador de Credenciais do Windows e é resolvida uma única vez por missão, só em memória. Nunca em disco, nunca em .env, nunca no banco de dados.',
  },
  {
    icon: Gauge,
    tone: 'tone-green',
    title: 'Orçamento por missão',
    text: 'Você define um limite explícito de chamadas de modelo. O Hane verifica o orçamento antes de cada requisição; se acabar, a missão para e pede sua atenção em vez de gastar escondido.',
  },
  {
    icon: Scroll,
    tone: 'tone-amber',
    title: 'Auditoria imutável',
    text: 'Cada transição de estado e cada chamada de provedor viram um registro permanente e verificável. Você sabe exatamente o que aconteceu, quando e por quê.',
  },
  {
    icon: UserCheck,
    tone: '',
    title: 'Aprovação humana obrigatória',
    text: 'Agente nenhum executa ação consequente sozinho. Escrever arquivos, rodar comandos ou acionar serviços externos só acontece atrás de um checkpoint de aprovação explícito — feito para você.',
  },
  {
    icon: Plugs,
    tone: 'tone-blue',
    title: 'Provedor à sua escolha',
    text: 'Qualquer API compatível com OpenAI entra como adaptador — OpenRouter, por exemplo. Você traz a chave, escolhe o modelo e pode trocar quando quiser. Sem lock-in de modelo.',
  },
];
</script>

<template>
  <section id="diferenciais" class="section">
    <div class="container">
      <div class="section-head-center">
        <p class="section-eyebrow">Diferenciais</p>
        <h2 class="section-title">Feito para quem não abre mão do controle</h2>
        <p class="section-lead">
          A maioria das ferramentas de agentes pede acesso total e confia em promessas.
          O Hane foi desenhado ao contrário: cada poder vem com um freio visível.
        </p>
      </div>
      <div class="feature-grid">
        <article v-for="feature in features" :key="feature.title" class="feature-card">
          <span class="feature-icon" :class="feature.tone">
            <component :is="feature.icon" />
          </span>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.text }}</p>
        </article>
      </div>
    </div>
  </section>
</template>
