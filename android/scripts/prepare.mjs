import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { bundleServer } from '../../scripts/bundle-server.mjs';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await bundleServer(path.dirname(android), path.join(android, '.gen/server'));
const licenses = path.join(android, '.gen/server/licenses');
await mkdir(licenses, { recursive: true });
for (const file of ['NODE-LICENSE.txt', 'MOBILE-NOTICE.md']) await copyFile(path.join(android, '.runtime', file), path.join(licenses, file));

await writeFile(path.join(android, '.gen/runtime-id.txt'), randomUUID());
