import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class ProfileError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new ProfileError(400, 'Use uma senha de 8 a 128 caracteres.');
  return password;
}
export class LocalProfileAuth {
  constructor({ store, now = Date.now, sessionMs = 8 * 60 * 60 * 1000 }) {
    this.store = store; this.now = now; this.sessionMs = sessionMs; this.sessions = new Map(); this.busy = false;
  }
  async cryptoOperation(fn) {
    if (this.busy) throw new ProfileError(429, 'Uma verificação já está em andamento. Aguarde.');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  async hash(password) {
    validatePassword(password);
    return this.cryptoOperation(() => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 }));
  }
  async verify(password) {
    const secret = this.store.secret();
    if (!secret) return true;
    if (secret.blockedUntil > this.now()) throw new ProfileError(429, 'Muitas tentativas. Aguarde antes de tentar novamente.');
    let valid = false;
    if (typeof password === 'string' && password.length <= 128) valid = await this.cryptoOperation(() => argon2.verify(secret.verifier, password));
    if (!valid) { this.store.recordFailure(this.now()); throw new ProfileError(401, 'Senha incorreta.'); }
    this.store.clearFailures(); return true;
  }
  newRecoveryCode() {
    const raw=randomBytes(32).toString('hex').toUpperCase();
    return {code:raw.match(/.{8}/g).join('-'),verifier:this.digest(raw)};
  }
  verifyRecovery(code) {
    const recovery=this.store.recovery();
    if(recovery?.blockedUntil>this.now())throw new ProfileError(429,'Muitas tentativas de recuperação. Aguarde antes de tentar novamente.');
    const normalized=typeof code==='string'&&code.length<=128?code.replace(/[-\s]/g,'').toUpperCase():'';
    const candidate=this.digest(normalized);const expected=recovery?.verifier ?? '0'.repeat(64);
    const matches=timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(expected,'hex'));
    if(!recovery||!this.store.secret()||!/^([A-F0-9]{64})$/.test(normalized)||!matches){this.store.recordRecoveryFailure(this.now());throw new ProfileError(401,'Código de recuperação inválido ou indisponível.');}
    return {recoveryVerifier:recovery.verifier,passwordVerifier:this.store.secret().verifier};
  }
  cookieToken(request) {
    const cookies = (request.headers.cookie ?? '').split(';').map(c => c.trim());
    return cookies.find(c => c.startsWith('hane_session='))?.slice('hane_session='.length) ?? '';
  }
  digest(token) { return createHash('sha256').update(token).digest('hex'); }
  authenticated(request) {
    const token = this.cookieToken(request);
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const key = this.digest(token); const session = this.sessions.get(key);
    if (!session || session.expiresAt <= this.now()) { this.sessions.delete(key); return false; }
    return session.profileId === this.store.get()?.id;
  }
  issue(response) {
    for (const [key,value] of this.sessions) if (value.expiresAt <= this.now()) this.sessions.delete(key);
    if (this.sessions.size >= 20) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(this.digest(token), { profileId: this.store.get().id, expiresAt: this.now() + this.sessionMs });
    response.setHeader('set-cookie', `hane_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${Math.floor(this.sessionMs/1000)}`);
  }
  lock(response) { this.sessions.clear(); response.setHeader('set-cookie', 'hane_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); }
}
