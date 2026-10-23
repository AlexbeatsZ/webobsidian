const { signAsync } = require('@electron/osx-sign');
const { execFileSync } = require('node:child_process');

// Personal sideload packages use an explicit ad-hoc signature. Never select a
// user's unrelated keychain identity or imply Developer ID/notarization.
module.exports = async function signMac(options) {
  await signAsync({
    ...options,
    identity: '-', identityValidation: false,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    gatekeeperAssess: false, strictVerify: undefined,
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', options.app], { stdio: 'inherit' });
};
