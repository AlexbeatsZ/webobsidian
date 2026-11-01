import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import extract from 'extract-zip';

// Pinned official redistribution, downloaded at build time, never at app startup.
export const TUNNEL_VERSION = '0.0.19';
const digests = {
  'win32-x64': '1d0ecc3a54f2a51e27a635ac155f40fbb95df58c52cdeddf6c75532cc0bbeb25',
  'darwin-x64': 'dff97674c77cac59e6ab3d901e6cff50fb17a5784c01d8959d1f4adb3afdf4bf',
  'darwin-arm64': '2243d024b77af8ee4b4ab7a1447949e5fc8d82bcd2d51b178927f2da9e47ecfd',
  'linux-x64': '9ee9448592345a9dd1517fb79791ab54d24f051142eb92bcbe8cd355effc9142',
  'linux-arm64': '5a19e556c4a8736ab7a6fde6f0568f6e7411fa2dff21186fc15bc30e9b98a603',
};
export async function bundleTunnel(platform, arch) {
  const digest = digests[`${platform}-${arch}`];
  if (!digest) throw new Error(`Unsupported Tunnel platform: ${platform}/${arch}`);
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const directory = path.join(desktop, '.gen', 'tunnel', arch);
  const binary = path.join(directory, platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
  const marker = path.join(directory, 'version.txt');
  if (await fs.readFile(marker, 'utf8').catch(() => '') === TUNNEL_VERSION) { await fs.access(binary); return; }
  const name = `tunnel-client-v${TUNNEL_VERSION}-${platform === 'win32' ? 'windows' : platform}-${arch === 'x64' ? 'amd64' : arch}`;
  const base = `https://github.com/openai/tunnel-client/releases/download/v${TUNNEL_VERSION}/`;
  const download = async file => {
    const cached = await fs.readFile(path.join(desktop, '.gen', 'tunnel-downloads', file)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (cached) return cached;
    const response = await fetch(base + file, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Download ${file}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const archive = await download(`${name}.zip`);
  if (createHash('sha256').update(archive).digest('hex') !== digest) throw new Error('Tunnel release checksum mismatch');
  await fs.mkdir(directory, { recursive: true });
  const zip = path.join(directory, 'download.zip');
  try { await fs.writeFile(zip, archive); await extract(zip, { dir: directory }); }
  finally { await fs.rm(zip, { force: true }); }
  await fs.access(binary);
  if (platform !== 'win32') await fs.chmod(binary, 0o755);
  await fs.writeFile(path.join(directory, 'THIRD-PARTY-LICENSES.txt'), await download(`${name}-licenses.txt`));
  await fs.writeFile(marker, TUNNEL_VERSION);
  console.log(`[desktop] bundled Secure MCP Tunnel ${TUNNEL_VERSION} (${platform}/${arch})`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundleTunnel(process.platform, process.arch);
