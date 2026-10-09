<script setup lang="ts">
import {
  PhUsersThree as UsersThree, PhFileText as FileText, PhUserCheck as UserCheck, PhHardDrive as HardDrive, PhKey as Key, PhScroll as Scroll
} from "@phosphor-icons/vue";
</script>

<template>
  <section id="o-que-e" class="section section-raise">
    <div class="container">
      <p class="section-eyebrow">O que é o Hane</p>
      <h2 class="section-title">Não é mais um chatbot.<br>É uma equipe com papéis, evidências e dono.</h2>
      <p class="section-lead">
        Cada missão no Hane vira um ciclo com três papéis — quem planeja, quem executa e
        quem revisa. Os agentes só devolvem evidência estruturada: não mudam o ciclo da
        missão, não executam ferramentas e não gastam além do orçamento definido por você.
      </p>

      <div class="about-grid">
        <article class="about-card">
          <p class="about-kicker">Papéis, não promessas</p>
          <h3>Planner, Executor e Reviewer</h3>
          <p>
            O <code>planner</code> cria um plano delimitado; o <code>executor</code> produz o
            trabalho com evidências; o <code>reviewer</code> registra verificação, limitações
            e um veredito. Responsabilidade clara em cada etapa.
          </p>
        </article>
        <article class="about-card">
          <p class="about-kicker">Evidência estruturada</p>
          <h3>Resultado auditável, não achismo</h3>
          <p>
            Toda chamada de modelo vira um registro na trilha de auditoria da missão. Você
            vê o que foi pedido, o que foi respondido e por quê — sem caixa-preta.
          </p>
        </article>
        <article class="about-card">
          <p class="about-kicker">Humano no ciclo</p>
          <h3>Nada consequente sem sua aprovação</h3>
          <p>
            Antes de qualquer ação com efeito — escrever, executar, publicar, enviar — o
            Hane exige um checkpoint explícito de aprovação humana. Sempre.
          </p>
        </article>
      </div>

      <div class="about-facts">
        <span class="fact"><HardDrive /> Dados da missão em <b>SQLite local</b></span>
        <span class="fact"><Key /> Chave de API no <b>Cofre do Windows</b></span>
        <span class="fact"><Scroll /> <b>Trilha de auditoria</b> imutável</span>
        <span class="fact"><UsersThree /> <b>3 papéis</b> por missão</span>
        <span class="fact"><FileText /> Inferência via <b>provedor que você escolher</b></span>
      </div>
    </div>
  </section>
</template>
