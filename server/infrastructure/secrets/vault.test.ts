import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DevFileVault, InMemoryVault, SafeStorageVault } from './index';
test('AES round-trip, dev restart, foreign keys and tampering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-vault-'));
  try {
    const dev = new DevFileVault(dir);
    const memory = new InMemoryVault();
    const plain = 'password-cookie-token-秘密';
    for (const vault of [dev, memory]) {
      assert.equal(vault.isAvailable(), true);
      const blob = vault.encrypt(plain);
      assert.equal(vault.decrypt(blob), plain);
      assert.equal(blob.includes(Buffer.from(plain)), false);
      assert.notDeepEqual(blob, vault.encrypt(plain));
      const changed = Buffer.from(blob); changed[changed.length - 1] ^= 1;
      assert.throws(() => vault.decrypt(changed));
    }
    const blob = dev.encrypt(plain);
    assert.equal(new DevFileVault(dir).decrypt(blob), plain);
    assert.throws(() => memory.decrypt(blob));
    assert.throws(() => dev.decrypt(memory.encrypt(plain)));
    assert.throws(() => new InMemoryVault().decrypt(memory.encrypt(plain)));
    assert.equal(fs.readFileSync(path.join(dir, '.dev-secret-key')).length, 32);
    fs.writeFileSync(path.join(dir, '.dev-secret-key'), 'invalid');
    assert.equal(dev.isAvailable(), false);
    assert.throws(() => dev.encrypt(plain));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('safeStorage rejects unavailable encryption, basic_text and foreign blobs', () => {
  let available = true; let backend = 'dpapi'; let calls = 0;
  const vault = new SafeStorageVault({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: value => { calls++; return Buffer.from(value).reverse(); },
    decryptString: value => Buffer.from(value).reverse().toString(),
  });
  const blob = vault.encrypt('secret');
  assert.equal(vault.decrypt(blob), 'secret');
  assert.throws(() => vault.decrypt(new InMemoryVault().encrypt('secret')));
  available = false;
  assert.equal(vault.isAvailable(), false);
  assert.throws(() => vault.encrypt('secret'));
  assert.throws(() => vault.decrypt(blob));
  backend = 'basic_text'; available = true;
  assert.equal(vault.isAvailable(), false);
  assert.throws(() => vault.encrypt('secret'));
  assert.equal(calls, 1);
});