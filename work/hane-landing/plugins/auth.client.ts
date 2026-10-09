export default defineNuxtPlugin(() => {
  const { load } = useAuth();
  load();
});
