/** Aggregate this array in the existing nativeCommands registry. No parallel registry. */
export const OPEN_ATTACHMENT_CLEANUP = 'webobsidian:open-attachment-cleanup';
export const attachmentCleanupCommands = [{
  id: 'attachments:cleanup',
  title: '清理没有被引用的附件…',
  run: () => window.dispatchEvent(new Event(OPEN_ATTACHMENT_CLEANUP)),
}];
/** Keep old command bindings useful while suppressing duplicate plugin implementations. */
export const attachmentCleanupLegacyCommandIds = [
  'oz-clear-unused-images:clear-unused-images',
  'obsidian-plus:clear-unused-images',
] as const;
