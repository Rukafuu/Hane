<script setup lang="ts">
import {
  PhWarningCircle as WarningCircle, PhShieldCheck as ShieldCheck
} from "@phosphor-icons/vue";

const { signup, user } = useAuth();
const { show: showToast } = useToast();

const name = ref('');
const email = ref('');
const password = ref('');
const terms = ref(false);
const submitting = ref(false);
const errors = reactive<{ name?: string; email?: string; password?: string; terms?: string }>({});

useSeoMeta({ title: 'Criar conta no Hane' });

if (user.value) {
  await navigateTo('/');
}

function validate() {
  errors.name = name.value.trim().length >= 2 ? undefined : 'Digite seu nome.';
  errors.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) ? undefined : 'Informe um e-mail válido.';
  errors.password = password.value.length >= 8 ? undefined : 'A senha precisa ter ao menos 8 caracteres.';
  errors.terms = terms.value ? undefined : 'É preciso aceitar os termos para criar a conta.';
  return !errors.name && !errors.email && !errors.password && !errors.terms;
}

async function submit() {
  if (!validate()) return;
  submitting.value = true;
  await new Promise((resolve) => setTimeout(resolve, 750));
  signup(name.value.trim(), email.value.trim());
  submitting.value = false;
  showToast('Conta criada — bem-vindo ao Hane');
  await navigateTo('/');
}
</script>

<template>
  <AuthShell mode="signup">
    <h1 class="auth-head">Criar sua conta</h1>
    <p class="auth-sub">Leva menos de um minuto. O Hane é seu — a conta só acompanha o produto.</p>

    <form class="auth-form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="signup-name">Nome</label>
        <input
          id="signup-name"
          v-model="name"
          type="text"
          autocomplete="name"
          placeholder="Como devemos te chamar"
          :aria-invalid="!!errors.name"
        />
        <p v-if="errors.name" class="field-error"><WarningCircle /> {{ errors.name }}</p>
      </div>

      <div class="field">
        <label for="signup-email">E-mail</label>
        <input
          id="signup-email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="voce@exemplo.com"
          :aria-invalid="!!errors.email"
        />
        <p v-if="errors.email" class="field-error"><WarningCircle /> {{ errors.email }}</p>
      </div>

      <div class="field">
        <label for="signup-password">Senha</label>
        <input
          id="signup-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="Mínimo de 8 caracteres"
          :aria-invalid="!!errors.password"
        />
        <p v-if="errors.password" class="field-error"><WarningCircle /> {{ errors.password }}</p>
      </div>

      <div class="field">
        <label class="checkbox-field" :aria-invalid="!!errors.terms">
          <input v-model="terms" type="checkbox" />
          <span>Li e aceito os termos de uso e a política de privacidade do Hane.</span>
        </label>
        <p v-if="errors.terms" class="field-error"><WarningCircle /> {{ errors.terms }}</p>
      </div>

      <button type="submit" class="btn btn-primary btn-lg auth-submit" :disabled="submitting">
        {{ submitting ? 'Criando conta…' : 'Criar conta' }}
      </button>

      <ul class="auth-benefits">
        <li><ShieldCheck /> Sem cartão de crédito e sem cobrança</li>
        <li><ShieldCheck /> Seus dados de missão nunca saem da sua máquina</li>
      </ul>
    </form>

    <p class="auth-switch">
      Já tem conta?
      <NuxtLink to="/entrar">Entrar</NuxtLink>
    </p>
  </AuthShell>
</template>
