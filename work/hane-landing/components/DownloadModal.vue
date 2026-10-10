<script setup lang="ts">
import {
  PhX as X, PhRocketLaunch as RocketLaunch, PhEnvelopeSimple as EnvelopeSimple, PhCheckCircle as CheckCircle
} from "@phosphor-icons/vue";

const { open, hide } = useDownloadModal();
const { show: showToast } = useToast();

const email = ref('');
const error = ref('');
const joined = ref(false);
const overlay = ref<HTMLElement | null>(null);
let lastFocused: HTMLElement | null = null;

function focusables() {
  if (!overlay.value) return [];
  return [...overlay.value.querySelectorAll<HTMLElement>('button, input, [href], select, textarea')].filter((el) => !el.hasAttribute('disabled'));
}

watch(open, async (isOpen) => {
  if (isOpen) {
    email.value = '';
    error.value = '';
    joined.value = false;
    lastFocused = document.activeElement as HTMLElement | null;
    await nextTick();
    overlay.value?.focus();
  } else {
    lastFocused?.focus();
  }
});

function submit() {
  const value = email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    error.value = 'Digite um e-mail válido para entrar na lista.';
    return;
  }
  const list = JSON.parse(localStorage.getItem('hane-waitlist') ?? '[]');
  if (!list.includes(value)) list.push(value);
  localStorage.setItem('hane-waitlist', JSON.stringify(list));
  error.value = '';
  joined.value = true;
  showToast('Você entrou na lista de lançamento');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    hide();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === overlay.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        ref="overlay"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-modal-title"
        tabindex="-1"
        @keydown="onKeydown"
        @click.self="hide"
      >
        <div class="modal-card">
          <button class="modal-close" aria-label="Fechar" @click="hide">
            <X size="18" />
          </button>
          <span class="modal-icon"><RocketLaunch weight="duotone" size="26" /></span>
          <h3 id="download-modal-title">O Hane ainda está em desenvolvimento</h3>
          <p>
            O núcleo de orquestração já funciona no terminal — mas o app para desktop
            ainda está sendo forjado. Deixe seu e-mail e avisamos quando o primeiro
            instalador estiver disponível.
          </p>
          <form v-if="!joined" class="modal-form" @submit.prevent="submit">
            <label class="field">
              <span>Seu e-mail</span>
              <input
                v-model="email"
                type="email"
                placeholder="voce@exemplo.com"
                autocomplete="email"
                :aria-invalid="!!error"
              />
            </label>
            <p v-if="error" class="field-error" role="alert">{{ error }}</p>
            <button type="submit" class="btn btn-primary btn-lg modal-submit">
              <EnvelopeSimple />
              Avise-me no lançamento
            </button>
          </form>
          <div v-else class="modal-joined">
            <CheckCircle weight="fill" size="20" />
            <span>Pronto! Você entrou na lista de lançamento.</span>
          </div>
          <small class="modal-note">
            Sem spam: um e-mail só no lançamento, e seus dados ficam neste navegador.
          </small>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(32, 38, 49, .5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal-card {
  position: relative;
  width: min(480px, 100%);
  padding: 34px 30px 26px;
  border-radius: 20px;
  background: var(--raise);
  box-shadow: var(--shadow-lift);
  text-align: center;
}
.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--ink-3);
}
.modal-close:hover { color: var(--pink-text); background: rgba(255, 255, 255, .6); }
.modal-icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
  border-radius: 16px;
  background: var(--pink-soft);
  color: var(--pink-text);
}
.modal-card h3 {
  margin: 0 0 10px;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -.01em;
}
.modal-card > p {
  margin: 0 0 22px;
  color: var(--ink-2);
  font-size: 14.5px;
  line-height: 1.62;
}
.modal-form { display: grid; gap: 12px; }
.modal-form .field { display: grid; gap: 6px; text-align: left; }
.modal-form .field span {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.modal-form input {
  height: 48px;
  padding: 0 15px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--inset-shadow);
  font-size: 14.5px;
  color: var(--ink);
}
.modal-form input:focus { outline: 2px solid rgba(216, 101, 135, .65); outline-offset: 1px; }
.modal-form input[aria-invalid='true'] { border-color: rgba(162, 89, 89, .6); }
.field-error {
  margin: -4px 0 0;
  color: var(--red);
  font-size: 12.5px;
  font-weight: 500;
  text-align: left;
}
.modal-submit { width: 100%; }
.modal-joined {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 15px;
  border-radius: 12px;
  background: var(--green-soft);
  color: var(--green);
  font-size: 14px;
  font-weight: 600;
}
.modal-note {
  display: block;
  margin-top: 18px;
  color: var(--ink-3);
  font-size: 12px;
}
.modal-enter-active, .modal-leave-active { transition: opacity .2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .modal-card { transition: transform .22s ease; }
.modal-enter-from .modal-card { transform: translateY(10px) scale(.98); }
</style>
