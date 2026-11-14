/** Native identity is independent of the responsive workspace layout. */
export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /\bWebObsidianAndroid\b/.test(navigator.userAgent);
}
export function isMacOS(): boolean {
  return typeof window !== 'undefined' && window.webobsidianDesktop
    ? window.webobsidianDesktop.platform === 'darwin'
    : typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}
export const Platform = {
  get isDesktop() { return typeof window !== 'undefined' && !!window.webobsidianDesktop; },
  get isDesktopApp() { return this.isDesktop; },
  get isMobile() { return isAndroid(); },
  get isMobileApp() { return isAndroid(); },
  get isAndroidApp() { return isAndroid(); },
  get isMacOS() { return isMacOS(); },
  get isWin() { return typeof navigator !== 'undefined' && /Win/.test(navigator.platform); },
  get isLinux() { return !isAndroid() && typeof navigator !== 'undefined' && /Linux/.test(navigator.platform); },
  get isPhone() { return isAndroid() && !/Tablet/.test(navigator.userAgent) && /Mobile/.test(navigator.userAgent); },
  get isTablet() { return isAndroid() && !this.isPhone; },
  isIosApp: false, isSafari: false, resourcePathPrefix: '',
};

export function appVersion(): string {
  if (typeof window !== 'undefined' && window.webobsidianDesktop?.version) return window.webobsidianDesktop.version;
  const android = typeof navigator !== 'undefined' && /WebObsidianAndroid\/([^\s]+)/.exec(navigator.userAgent);
  return android ? android[1] : typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'development';
}
