const DATABASE_NAME = 'hane-onboarding';
const STORE_NAME = 'permissions';
const KEY = 'local-workspace';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle() {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(handle) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(handle, KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function permissionFor(handle) {
  const existing = await handle.queryPermission({ mode: 'read' });
  return existing === 'granted' ? existing : handle.requestPermission({ mode: 'read' });
}

export async function loadLocalWorkspace() {
  if (!('indexedDB' in window) || !('showDirectoryPicker' in window)) return { supported: false, name: null, granted: false };
  const handle = await readHandle();
  if (!handle) return { supported: true, name: null, granted: false };
  const granted = await handle.queryPermission({ mode: 'read' }) === 'granted';
  return { supported: true, name: handle.name, granted };
}

export async function requestLocalWorkspace() {
  if (!('showDirectoryPicker' in window)) throw new Error('Este navegador não suporta a escolha de pasta local.');
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  if (await permissionFor(handle) !== 'granted') throw new Error('A leitura da pasta não foi autorizada.');
  await saveHandle(handle);
  return { supported: true, name: handle.name, granted: true };
}
