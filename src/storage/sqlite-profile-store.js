import { randomUUID } from 'node:crypto';
import { migrate } from './migrations.js';

export function validateProfileFields({ displayName, email = null } = {}) {
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) throw new TypeError('Informe um nome de 1 a 80 caracteres.');
  if (email === '') email = null;
  if (email !== null && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new TypeError('Informe um e-mail válido ou deixe em branco.');
  return { displayName: displayName.trim(), email };
}

export class SqliteProfileStore {
  constructor({ database, dataDirectory, databasePath = null }) {
    this.database = migrate(database);
    this.dataDirectory = dataDirectory; this.databasePath = databasePath;
  }
  get() {
    const row = this.database.prepare(`SELECT id, display_name AS displayName, email, avatar_path AS avatarPath,
      created_at AS createdAt, updated_at AS updatedAt, onboarding_step AS onboardingStep,
      onboarding_completed AS onboardingCompleted,
      EXISTS(SELECT 1 FROM local_profile_secrets WHERE profile_id = local_profiles.id) AS passwordEnabled,
      EXISTS(SELECT 1 FROM local_profile_recovery WHERE profile_id = local_profiles.id) AS recoveryAvailable
      FROM local_profiles WHERE installation_slot = 1`).get();
    return row ? { ...row, passwordEnabled: Boolean(row.passwordEnabled), recoveryAvailable: Boolean(row.recoveryAvailable), onboardingCompleted: Boolean(row.onboardingCompleted) } : null;
  }
  create(fields, verifier = null, recoveryVerifier = null) {
    const value = validateProfileFields(fields);
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (this.get()) throw new Error('Já existe um perfil nesta instalação.');
      const id = randomUUID();
      this.database.prepare(`INSERT INTO local_profiles (id, installation_slot, display_name, email, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)`).run(id, value.displayName, value.email, now, now);
      if (verifier) this.database.prepare('INSERT INTO local_profile_secrets (profile_id, password_verifier) VALUES (?, ?)').run(id, verifier);
      if (verifier && recoveryVerifier) this.setRecovery(recoveryVerifier);
      this.database.exec('COMMIT');
      return this.get();
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  update(fields) {
    const value = validateProfileFields(fields);
    this.database.prepare('UPDATE local_profiles SET display_name = ?, email = ?, updated_at = ? WHERE installation_slot = 1').run(value.displayName, value.email, new Date().toISOString());
    return this.get();
  }
  setAvatar(reference) {
    this.database.prepare('UPDATE local_profiles SET avatar_path = ?, updated_at = ? WHERE installation_slot = 1').run(reference, new Date().toISOString());
    return this.get();
  }
  advance(step, completed = false) {
    const current = this.get();
    if (!current || !Number.isInteger(step) || step < current.onboardingStep || step > Math.min(3, current.onboardingStep + 1) || (completed && step !== 3)) throw new TypeError('Etapa de início inválida.');
    this.database.prepare('UPDATE local_profiles SET onboarding_step = ?, onboarding_completed = ?, updated_at = ? WHERE installation_slot = 1').run(step, Number(completed || current.onboardingCompleted), new Date().toISOString());
    return this.get();
  }
  secret() { return this.database.prepare('SELECT password_verifier AS verifier, failed_attempts AS attempts, blocked_until AS blockedUntil FROM local_profile_secrets WHERE profile_id = ?').get(this.get()?.id ?? ''); }
  setPassword(verifier, recoveryVerifier = null) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const saved = this.writePassword(verifier,recoveryVerifier);this.database.exec('COMMIT');return saved; } catch(error) {this.database.exec('ROLLBACK');throw error;}
  }
  writePassword(verifier, recoveryVerifier) {
    const id = this.get()?.id;
    if (!id) throw new Error('Perfil não encontrado.');
    if (verifier) this.database.prepare(`INSERT INTO local_profile_secrets (profile_id, password_verifier) VALUES (?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET password_verifier = excluded.password_verifier, failed_attempts = 0, blocked_until = 0`).run(id, verifier);
    else this.database.prepare('DELETE FROM local_profile_secrets WHERE profile_id = ?').run(id);
    this.database.prepare('DELETE FROM local_profile_recovery WHERE profile_id = ?').run(id);
    if (verifier && recoveryVerifier) this.setRecovery(recoveryVerifier);
    this.database.prepare('UPDATE local_profiles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(),id);
    return this.get();
  }
  recovery() { return this.database.prepare('SELECT code_verifier AS verifier, failed_attempts AS attempts, blocked_until AS blockedUntil FROM local_profile_recovery WHERE profile_id = ?').get(this.get()?.id ?? ''); }
  setRecovery(verifier) {
    this.database.prepare(`INSERT INTO local_profile_recovery (profile_id,code_verifier) VALUES (?,?) ON CONFLICT(profile_id) DO UPDATE SET code_verifier=excluded.code_verifier,failed_attempts=0,blocked_until=0`).run(this.get().id,verifier);
  }
  rotateRecovery(expectedPasswordVerifier,verifier) {
    if (this.secret()?.verifier !== expectedPasswordVerifier) return false;
    this.setRecovery(verifier);return true;
  }
  recoverPassword(expected,verifier,recoveryVerifier) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if(this.recovery()?.verifier !== expected.recoveryVerifier || this.secret()?.verifier !== expected.passwordVerifier) {this.database.exec('ROLLBACK');return false;}
      this.writePassword(verifier,recoveryVerifier);this.database.exec('COMMIT');return true;
    } catch(error) {this.database.exec('ROLLBACK');throw error;}
  }
  recordRecoveryFailure(now) {
    const recovery=this.recovery();if(!recovery)return;
    const attempts=recovery.attempts+1;
    const blockedUntil=attempts>=5?now+60_000*Math.min(30,2**Math.min(5,attempts-5)):0;
    this.database.prepare('UPDATE local_profile_recovery SET failed_attempts = ?, blocked_until = ? WHERE profile_id = ?').run(attempts,blockedUntil,this.get().id);
  }
  recordFailure(now) {
    const secret = this.secret();
    const attempts = secret.attempts + 1;
    const blockedUntil = attempts >= 5 ? now + 60_000 * Math.min(30, 2 ** Math.min(5, attempts - 5)) : 0;
    this.database.prepare('UPDATE local_profile_secrets SET failed_attempts = ?, blocked_until = ? WHERE profile_id = ?').run(attempts, blockedUntil, this.get().id);
  }
  clearFailures() { this.database.prepare('UPDATE local_profile_secrets SET failed_attempts = 0, blocked_until = 0 WHERE profile_id = ?').run(this.get().id); }
}
