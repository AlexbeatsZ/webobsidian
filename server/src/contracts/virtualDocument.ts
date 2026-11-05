import { z } from 'zod';

export const VIRTUAL_DOCUMENT_FILE = '.virtual-document.json';
export const virtualSourcePath = z.string().min(1).max(1000).refine(value =>
  !value.startsWith('/') && !value.includes('\\') && !/[\x00-\x1f:*?"<>|#]/.test(value) &&
  value.split('/').every(part => !!part && !part.startsWith('.') && part !== '..') && /\.(md|markdown|pdf)$/i.test(value),
  '来源必须是此文件夹内的 Markdown 或 PDF 相对路径');
export const virtualManifestSchema = z.object({
  version: z.literal(1), title: z.string().trim().min(1).max(200),
  streams: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), title: z.string().trim().min(1).max(100),
    files: z.array(virtualSourcePath).min(1).max(2000),
  }).strict()).min(1).max(16),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.streams.map(stream => stream.id)).size !== manifest.streams.length)
    context.addIssue({ code: 'custom', message: '阅读分组 ID 必须唯一' });
  for (const stream of manifest.streams) if (new Set(stream.files.map(file => file.normalize('NFC').toLowerCase())).size !== stream.files.length)
    context.addIssue({ code: 'custom', message: '同一阅读分组不能重复包含来源' });
});
export type VirtualManifest = z.infer<typeof virtualManifestSchema>;

export interface VirtualSource {
  path: string; title: string; kind: 'markdown' | 'pdf'; size: number;
  headings: { text: string; level: number }[];
  missing?: boolean;
}
export interface VirtualDocument {
  path: string; title: string; revision: string;
  streams: { id: string; title: string; files: VirtualSource[] }[];
}
