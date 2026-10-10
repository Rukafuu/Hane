const MUTATION_HEADERS = { 'content-type':'application/json', 'x-hane-request':'1' };
async function result(response) {
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Não foi possível acessar seu perfil local.'); error.status = response.status; throw error; }
  return data;
}
const send = (route,body,method='POST') => fetch(`/api/profile${route}`,{method,headers:MUTATION_HEADERS,body:JSON.stringify(body),credentials:'same-origin',cache:'no-store'}).then(result);
export const fetchProfileSession = () => fetch('/api/profile/session',{cache:'no-store',credentials:'same-origin'}).then(result);
export const createLocalProfile = body => send('',body);
export const updateLocalProfile = body => send('',body,'PATCH');
export const advanceProfileOnboarding = (step,completed=false) => send('/onboarding',{step,completed});
export const unlockLocalProfile = password => send('/unlock',{password});
export const lockLocalProfile = () => send('/lock',{});
export const changeLocalPassword = body => send('/password',body);
export const fetchLocalProfile = () => fetch('/api/profile',{cache:'no-store',credentials:'same-origin'}).then(result);
export const exportLocalProfile = () => fetch('/api/profile/export',{cache:'no-store',credentials:'same-origin'}).then(result);
export const removeLocalAvatar = () => fetch('/api/profile/avatar',{method:'DELETE',headers:{'x-hane-request':'1'},credentials:'same-origin'}).then(result);
export const uploadLocalAvatar = (file,type) => fetch('/api/profile/avatar',{method:'POST',headers:{'content-type':type,'x-hane-request':'1'},body:file,credentials:'same-origin'}).then(result);
export async function inspectLocalImage(file,limits={maxBytes:5*1024*1024}) {
  if (!file || file.size > limits.maxBytes) throw new Error('Escolha uma foto de até 5 MB.');
  const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
  const text = (a,b) => String.fromCharCode(...bytes.slice(a,b));
  if ([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return 'image/png';
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (text(0,4)==='RIFF' && text(8,12)==='WEBP') return 'image/webp';
  if (['GIF87a','GIF89a'].includes(text(0,6))) return 'image/gif';
  throw new Error('Use uma foto PNG, JPEG, WebP ou GIF. O conteúdo do arquivo precisa corresponder ao formato.');
}

export const recoverLocalPassword = body => send('/recover',body);
export const generateLocalRecoveryCode = currentPassword => send('/recovery-code',{currentPassword});
