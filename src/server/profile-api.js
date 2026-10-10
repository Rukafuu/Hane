import { DEFAULT_UI_ORIGINS } from './ui-origins.js';
import { LocalProfileAuth, ProfileError, validatePassword } from '../profile/local-auth.js';
import { AVATAR_LIMITS, loadAvatar, removeAvatar, saveAvatar } from '../profile/avatar.js';
import { validateProfileFields } from '../storage/sqlite-profile-store.js';

function respond(response, status, payload) {
  response.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  response.end(JSON.stringify(payload));
}
function readBody(request, max = 16384) {
  return new Promise((resolve,reject) => {
    const chunks=[]; let size=0;
    const cleanup=()=>{request.off('data',data);request.off('end',end);request.off('error',error);request.off('aborted',aborted);};
    const error=e=>{cleanup();reject(e);};
    const aborted=()=>error(new ProfileError(400,'Envio interrompido.'));
    const data=chunk=>{size+=chunk.length;if(size>max){cleanup();request.resume();reject(new ProfileError(413,'Arquivo ou formulário maior que o limite permitido.'));}else chunks.push(chunk);};
    const end=()=>{cleanup();resolve(Buffer.concat(chunks));};
    request.on('data',data);request.once('end',end);request.once('error',error);request.once('aborted',aborted);
  });
}
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ProfileError(415, 'Use JSON neste formulário.');
  try { const value = JSON.parse((await readBody(request)).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch (e) { if (e instanceof ProfileError) throw e; throw new ProfileError(400, 'Formulário inválido.'); }
}
export function createProfileApi({ store, allowedOrigins = DEFAULT_UI_ORIGINS, now, sessionMs, closeStreams = () => {}, avatarLimits = AVATAR_LIMITS }) {
  const auth = new LocalProfileAuth({store,now,sessionMs});
  const origins = new Set(allowedOrigins);
  function publicProfile(profile) { return { ...profile, avatarUrl:profile.avatarPath ? `/api/profile/avatar?v=${encodeURIComponent(profile.avatarPath)}` : null }; }
  function checkOrigin(request, response) {
    let host;
    try { host = new URL(`http://${request.headers.host}`).hostname; } catch { host = ''; }
    if (!['localhost','127.0.0.1','[::1]'].includes(host)) { respond(response,403,{error:'Host local inválido.'}); return false; }
    const origin = request.headers.origin;
    // A page at an attacker-controlled hostname cannot use DNS rebinding or CSRF.
    const localOrigin = `http://${request.headers.host}`;
    if (origin && origin !== localOrigin && !origins.has(origin)) { respond(response,403,{error:'Origem não autorizada.'}); return false; }
    if (request.method === 'OPTIONS') { respond(response,403,{error:'Acesso entre origens indisponível.'}); return false; }
    if (!['GET','HEAD'].includes(request.method) && request.headers['x-hane-request'] !== '1') { respond(response,403,{error:'Requisição local explícita obrigatória.'}); return false; }
    return true;
  }
  async function handle(request,response) {
    const pathname = new URL(request.url,'http://127.0.0.1').pathname;
    if (!checkOrigin(request,response)) return true;
    response.setHeader('cache-control','no-store');
    response.setHeader('x-content-type-options','nosniff');
    const profile = store.get(); const authenticated = auth.authenticated(request);
    const requireSession = () => { if (!auth.authenticated(request)) throw new ProfileError(401,'A sessão foi encerrada. Desbloqueie novamente.'); };
    try {
      if (pathname === '/api/profile/session' && request.method === 'GET') {
        respond(response,200,{ exists:Boolean(profile), authenticated, passwordEnabled:profile?.passwordEnabled ?? false, recoveryAvailable:profile?.recoveryAvailable ?? false, profile:authenticated && profile ? publicProfile(profile) : null, limits:avatarLimits }); return true;
      }
      if (pathname === '/api/profile' && request.method === 'POST') {
        if (profile) throw new ProfileError(409,'Já existe um perfil local nesta instalação.');
        const body = await readJson(request); validateProfileFields(body);
        if (body.passwordEnabled !== undefined && typeof body.passwordEnabled !== 'boolean') throw new ProfileError(400,'Informe o estado da proteção.');
        let verifier = null;
        if (body.passwordEnabled === true) { if (body.password !== body.confirmPassword) throw new ProfileError(400,'As senhas precisam ser iguais.'); verifier = await auth.hash(body.password); }
        if (store.get()) throw new ProfileError(409,'Já existe um perfil local nesta instalação.');
        const recovery = verifier ? auth.newRecoveryCode() : null;
        const created = store.create(body,verifier,recovery?.verifier); auth.issue(response);
        respond(response,201,{profile:publicProfile(created),...(recovery?{recoveryCode:recovery.code}:{})}); return true;
      }
      if (pathname === '/api/profile/unlock' && request.method === 'POST') {
        if (!profile) throw new ProfileError(404,'Crie seu perfil primeiro.');
        const body = await readJson(request); await auth.verify(body.password);
        auth.issue(response); respond(response,200,{profile:publicProfile(store.get())}); return true;
      }
      if (pathname === '/api/profile/recover' && request.method === 'POST') {
        const body=await readJson(request);
        const expected=auth.verifyRecovery(body.code);
        if(body.password!==body.confirmPassword)throw new ProfileError(400,'As senhas precisam ser iguais.');
        validatePassword(body.password);
        const verifier=await auth.hash(body.password);const recovery=auth.newRecoveryCode();
        if(!store.recoverPassword(expected,verifier,recovery.verifier))throw new ProfileError(401,'Código de recuperação inválido ou indisponível.');
        auth.lock(response);closeStreams();
        respond(response,200,{locked:true,recoveryCode:recovery.code});return true;
      }
      // All real runtime APIs are protected once a local profile exists, not just profile forms.
      if (profile && !authenticated) throw new ProfileError(401,'Seu Hane está bloqueado. Desbloqueie para continuar.');
      if (!pathname.startsWith('/api/profile')) return false;
      if (!profile) throw new ProfileError(404,'Perfil não encontrado.');
      if (pathname === '/api/profile' && request.method === 'GET') { respond(response,200,{profile:publicProfile(profile),dataDirectory:store.dataDirectory,databasePath:store.databasePath}); return true; }
      if (pathname === '/api/profile' && request.method === 'PATCH') { const body = await readJson(request); requireSession(); respond(response,200,{profile:publicProfile(store.update(body))}); return true; }
      if (pathname === '/api/profile/onboarding' && request.method === 'POST') {
        const body = await readJson(request); requireSession(); if (body.completed !== undefined && typeof body.completed !== 'boolean') throw new ProfileError(400,'Etapa inválida.');
        respond(response,200,{profile:publicProfile(store.advance(body.step,body.completed===true))}); return true;
      }
      if (pathname === '/api/profile/password' && request.method === 'POST') {
        const body = await readJson(request);
        if (typeof body.enabled !== 'boolean') throw new ProfileError(400,'Informe o estado da proteção.');
        // Re-authenticate even for an already unlocked session.
        if (profile.passwordEnabled) await auth.verify(body.currentPassword);
        let verifier = null;
        if (body.enabled) { if (body.password !== body.confirmPassword) throw new ProfileError(400,'As senhas precisam ser iguais.'); verifier = await auth.hash(body.password); }
        const recovery=verifier?auth.newRecoveryCode():null;
        requireSession(); store.setPassword(verifier,recovery?.verifier); auth.lock(response); closeStreams(); auth.issue(response);
        respond(response,200,{profile:publicProfile(store.get()),...(recovery?{recoveryCode:recovery.code}:{})}); return true;
      }
      if (pathname === '/api/profile/recovery-code' && request.method === 'POST') {
        const body=await readJson(request);requireSession();
        if(!profile.passwordEnabled)throw new ProfileError(409,'Ative a senha local para gerar um código de recuperação.');
        const expected=store.secret().verifier;await auth.verify(body.currentPassword);requireSession();
        const recovery=auth.newRecoveryCode();
        if(!store.rotateRecovery(expected,recovery.verifier))throw new ProfileError(409,'A proteção mudou. Tente novamente.');
        respond(response,200,{profile:publicProfile(store.get()),recoveryCode:recovery.code});return true;
      }
      if (pathname === '/api/profile/lock' && request.method === 'POST') { auth.lock(response); closeStreams(); respond(response,200,{locked:true}); return true; }
      if (pathname === '/api/profile/export' && request.method === 'GET') {
        const { id, displayName, email, createdAt, updatedAt, onboardingCompleted } = profile;
        respond(response,200,{version:1,profile:{id,displayName,email,createdAt,updatedAt,onboardingCompleted}}); return true;
      }
      if (pathname === '/api/profile/avatar' && request.method === 'GET') {
        const bytes = await loadAvatar(store.dataDirectory,profile.avatarPath).catch(()=>{throw new ProfileError(404,'Foto não encontrada.');});
        requireSession(); response.writeHead(200,{'content-type':'image/webp','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"});response.end(bytes);return true;
      }
      if (pathname === '/api/profile/avatar' && request.method === 'POST') {
        if (!['image/png','image/jpeg','image/webp','image/gif'].includes(request.headers['content-type'])) throw new ProfileError(415,'Use PNG, JPEG, WebP ou GIF.');
        const reference = await saveAvatar(store.dataDirectory,await readBody(request,avatarLimits.maxBytes),avatarLimits);
        try { if (!auth.authenticated(request)) throw new ProfileError(401,'A sessão foi encerrada. Desbloqueie novamente.'); const old = store.get().avatarPath; store.setAvatar(reference); await removeAvatar(store.dataDirectory,old).catch(()=>{}); } catch(e) { await removeAvatar(store.dataDirectory,reference);throw e; }
        // New photo is committed first; old files are removed only after replacement.
        respond(response,200,{profile:publicProfile(store.get())});return true;
      }
      if (pathname === '/api/profile/avatar' && request.method === 'DELETE') { store.setAvatar(null);await removeAvatar(store.dataDirectory,profile.avatarPath).catch(()=>{});respond(response,200,{profile:publicProfile(store.get())});return true; }
      throw new ProfileError(404,'Rota de perfil não encontrada.');
    } catch (error) {
      const status = error instanceof ProfileError ? error.status : error instanceof TypeError ? 400 : 500;
      respond(response,status,{error:status === 500 ? 'Não foi possível salvar os dados locais. Tente novamente.' : error.message});return true;
    }
  }
  return { handle, authenticated:request=>!store.get() || auth.authenticated(request) };
}
