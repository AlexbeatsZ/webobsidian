module.exports = async context => {
  const { bundleTunnel } = await import('./bundle-tunnel.mjs');
  const arch = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch];
  await bundleTunnel(context.electronPlatformName, arch);
};
