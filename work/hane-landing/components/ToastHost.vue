<script setup lang="ts">
import {
  PhCheckCircle as CheckCircle
} from "@phosphor-icons/vue";

const { message, visible } = useToast();
</script>

<template>
  <Transition name="toast">
    <div v-if="visible" class="toast-host" role="status" aria-live="polite">
      <CheckCircle weight="fill" />
      <span>{{ message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.toast-host {
  position: fixed;
  z-index: 80;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: calc(100vw - 40px);
  padding: 12px 18px;
  border-radius: 13px;
  background: #30343d;
  color: #fff;
  font-size: 13.5px;
  font-weight: 500;
  box-shadow: 0 10px 28px rgba(37, 41, 49, .28);
}
.toast-host svg {
  width: 17px;
  height: 17px;
  color: #8ad0b5;
  flex: 0 0 auto;
}
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
