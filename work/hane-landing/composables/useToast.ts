let timer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  const message = useState('hane-toast-message', () => '');
  const visible = useState('hane-toast-visible', () => false);

  function show(text: string) {
    message.value = text;
    visible.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      visible.value = false;
    }, 2800);
  }

  return { message, visible, show };
}
