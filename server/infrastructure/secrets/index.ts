import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export type VaultKind = 'safe-storage' | 'dev-file' | 'in-memory';
export interface SecretVault {
  readonly kind: VaultKind;
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
}
export class SecretVaultError extends Error {
  constructor() { super('Secret vault unavailable or ciphertext cannot be decrypted'); }
}
/** Supplied by Electron after app.ready; server has no Electron dependency. */
export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
function wrap(kind: VaultKind, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from('plangent-v1:' + kind + '\0'), payload]);
}
function unwrap(kind: VaultKind, blob: Buffer): Buffer {
  const prefix = Buffer.from('plangent-v1:' + kind + '\0');
  if (!Buffer.isBuffer(blob) || !blob.subarray(0, prefix.length).equals(prefix)) throw new SecretVaultError();
  return blob.subarray(prefix.length);
}
export class SafeStorageVault implements SecretVault {
  readonly kind = 'safe-storage' as const;
  constructor(private readonly storage: SafeStorageAdapter) {}
  isAvailable(): boolean {
    try { return this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text'; }
    catch { return false; }
  }
  encrypt(plain: string): Buffer {
    if (!this.isAvailable()) throw new SecretVaultError();
    try { return wrap(this.kind, this.storage.encryptString(plain)); } catch { throw new SecretVaultError(); }
  }
  decrypt(blob: Buffer): string {
    if (!this.isAvailable()) throw new SecretVaultError();
    try { return this.storage.decryptString(unwrap(this.kind, blob)); } catch { throw new SecretVaultError(); }
  }
}
abstract class AesVault implements SecretVault {
  abstract readonly kind: VaultKind;
  protected abstract key(): Buffer;
  isAvailable(): boolean { try { return this.key().length === 32; } catch { return false; } }
  encrypt(plain: string): Buffer {
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return wrap(this.kind, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
    } catch { throw new SecretVaultError(); }
  }
  decrypt(blob: Buffer): string {
    try {
      const payload = unwrap(this.kind, blob);
      if (payload.length < 28) throw new SecretVaultError();
      const decipher = createDecipheriv('aes-256-gcm', this.key(), payload.subarray(0, 12));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
    } catch { throw new SecretVaultError(); }
  }
}
export class InMemoryVault extends AesVault {
  readonly kind = 'in-memory' as const;
  private readonly secretKey = randomBytes(32);
  protected key(): Buffer { return this.secretKey; }
}
export class DevFileVault extends AesVault {
  readonly kind = 'dev-file' as const;
  constructor(private readonly dataDir: string) { super(); }
  protected key(): Buffer {
    const filename = path.join(this.dataDir, '.dev-secret-key');
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(filename)) {
      try { fs.writeFileSync(filename, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const key = fs.readFileSync(filename);
    if (key.length !== 32) throw new SecretVaultError();
    return key;
  }
}
let activeVault: SecretVault | undefined;
export function configureSecretVault(vault: SecretVault): void { activeVault = vault; }
export function getSecretVault(): SecretVault {
  if (!activeVault) throw new SecretVaultError();
  return activeVault;
}