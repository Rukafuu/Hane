<script setup lang="ts">
import {
  PhEye as Eye, PhEyeSlash as EyeSlash, PhWarningCircle as WarningCircle
} from "@phosphor-icons/vue";

const { login, user } = useAuth();
const { show: showToast } = useToast();
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const submitting = ref(false);
const errors = reactive<{ email?: string; password?: string }>({});

useSeoMeta({ title: 'Entrar no Hane' });

if (user.value) {
  await navigateTo('/');
}

function validate() {
  errors.email = email.value.trim() ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) ? undefined : 'Informe um e-mail válido.') : 'Digite seu e-mail.';
  errors.password = password.value.length >= 8 ? undefined : 'A senha precisa ter ao menos 8 caracteres.';
  return !errors.email && !errors.password;
}

async function submit() {
  if (!validate()) return;
  submitting.value = true;
  await new Promise((resolve) => setTimeout(resolve, 650));
  login(email.value.trim());
  submitting.value = false;
  showToast(`Bem-vindo de volta, ${user.value?.name ?? 'você'}`);
  await navigateTo('/');
}

function recoverPassword() {
  showToast('A recuperação de senha chega junto com o app — ainda não existe no protótipo');
}
</script>

<template>
  <AuthShell mode="login">
    <h1 class="auth-head">Entrar no Hane</h1>
    <p class="auth-sub">Acesse sua conta para acompanhar lançamentos e preferências.</p>

    <form class="auth-form" novalidate @submit.prevent="submit">
      <div class="field">
        <label for="login-email">E-mail</label>
        <input
          id="login-email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="voce@exemplo.com"
          :aria-invalid="!!errors.email"
          :aria-describedby="errors.email ? 'login-email-error' : undefined"
        />
        <p v-if="errors.email" id="login-email-error" class="field-error">
          <WarningCircle /> {{ errors.email }}
        </p>
      </div>

      <div class="field">
        <div class="field-row">
          <label for="login-password">Senha</label>
          <button type="button" class="btn-quiet field-hint" @click="recoverPassword">Esqueci minha senha</button>
        </div>
        <input
          id="login-password"
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="Mínimo de 8 caracteres"
          :aria-invalid="!!errors.password"
          :aria-describedby="errors.password ? 'login-password-error' : undefined"
        />
        <p v-if="errors.password" id="login-password-error" class="field-error">
          <WarningCircle /> {{ errors.password }}
        </p>
      </div>

      <label class="checkbox-field">
        <input type="checkbox" checked />
        <span>Manter minha sessão neste navegador</span>
      </label>

      <button type="submit" class="btn btn-primary btn-lg auth-submit" :disabled="submitting">
        {{ submitting ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>

    <p class="auth-switch">
      Ainda não tem conta?
      <NuxtLink to="/cadastro">Criar conta grátis</NuxtLink>
    </p>
  </AuthShell>
</template>

<style scoped>
.field { position: relative; }
.field-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.field-row label { flex: 1; }
.field-row button { padding: 0; font-size: 12px; font-weight: 600; }
.field input[type='password'],
.field input[type='text'] { padding-right: 48px; }
</style>
