import { z } from 'zod';

export const AutomationSchema = z.object({
  version: z.literal(1).default(1),
  commands: z.array(z.object({
    id: z.string().regex(/^user:[a-zA-Z0-9][a-zA-Z0-9:_-]*$/).max(160),
    name: z.string().min(1).max(200), code: z.string().max(262144), enabled: z.boolean().default(true),
  }).strict()).max(256).default([]),
  templates: z.object({
    folder: z.string().max(4096).default(''),
    bindings: z.array(z.object({ id: z.string().regex(/^template:[a-zA-Z0-9][a-zA-Z0-9:_-]*$/),
      name: z.string().min(1), path: z.string().min(1) }).strict()).max(256).default([]),
    folderRules: z.array(z.object({ folder: z.string(), template: z.string().min(1) }).strict()).max(128).default([]),
  }).strict().default({}),
}).strict().superRefine((value, ctx) => {
  const ids = [...value.commands, ...value.templates.bindings].map(c => c.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate command ID' });
  const paths = [value.templates.folder, ...value.templates.bindings.map(item => item.path),
    ...value.templates.folderRules.flatMap(rule => [rule.folder, rule.template])];
  if (paths.some(value => value.startsWith('/') || value.includes('\\') || value.includes(':') ||
      value.split('/').some(part => part === '..' || part === '.')))
    ctx.addIssue({ code: 'custom', message: 'Use Vault-relative paths without parent traversal' });
  if ([...value.templates.bindings.map(item => item.path), ...value.templates.folderRules.map(rule => rule.template)]
      .some(value => !/\.(md|markdown)$/i.test(value))) ctx.addIssue({ code: 'custom', message: 'Template paths must address Markdown files' });
}).default({});
export type AutomationSettings = z.infer<typeof AutomationSchema>;
