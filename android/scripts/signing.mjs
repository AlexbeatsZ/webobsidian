import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(android, '.signing');
await mkdir(directory, { recursive: true });
const key = path.join(directory, 'release.p12');
try { await access(key); console.log('Existing local release key retained.'); process.exit(0); } catch {}
const password = randomBytes(32).toString('hex');
const result = spawnSync('keytool', ['-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-storepass', password,
  '-keypass', password, '-alias', 'webobsidian', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000',
  '-dname', 'CN=WebObsidian Personal, O=AlexbeatsZ'], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Project-local release signing key creation failed');
await writeFile(path.join(directory, 'release.properties'), `storeFile=.signing/release.p12\nstorePassword=${password}\nkeyAlias=webobsidian\nkeyPassword=${password}\n`, { mode: 0o600 });
console.log('Signing material saved only under ignored android/.signing; retain for future in-place updates.');
