export function useDownloadModal() {
  const open = useState('hane-download-modal', () => false);

  function show() {
    open.value = true;
  }

  function hide() {
    open.value = false;
  }

  return { open, show, hide };
}
