import { z } from 'zod';
const point = z.object({ line: z.number().int().min(1), ch: z.number().int().min(0) });
export const operationContract = {
  obsidian_get_context: { description: 'Read the last local note/selection, cursor, nearby text, open/recent/linked notes. Use for here/this requests. Requires a connected native workspace.',
    schema: z.object({ nearby_lines: z.number().int().min(0).max(100).default(12) }) },
  obsidian_list_files: { description: 'List saved visible VaultCatalog file metadata, paginated; no full Vault body scan.',
    schema: z.object({ path: z.string().default(''), type: z.enum(['all', 'text', 'attachment', 'markdown']).default('all'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }) },
  obsidian_search: { description: 'Use the native indexed Markdown search and its field/tag query syntax. Saved index scope and body limits apply. Read returned files before editing; unsaved drafts are not globally indexed.',
    schema: z.object({ query: z.string().trim().min(1).max(500), path: z.string().default(''), max_results: z.number().int().min(1).max(100).default(20), mode: z.enum(['literal', 'pinyin']).default('literal') }) },
  obsidian_read_file: { description: 'Read a bounded range with full-content revision. Connected editor buffers take precedence. Conflicting drafts fail. Lines are 1-based, columns UTF-16 0-based. Hidden/config files are excluded.',
    schema: z.object({ path: z.string().min(1).max(1024), start_line: z.number().int().min(1).default(1), line_count: z.number().int().min(1).max(2000).default(200) }) },
  obsidian_propose_changes: { description: 'Submit ONE existing Markdown file edit for local human review, never direct write. Supply exact read revision and expected_text. Same request_id is idempotent only for identical input. Create/move/trash and multiple-file groups are unsupported. Never bypass local approval via another tool; do not poll continuously.',
    schema: z.object({ request_id: z.string().min(1).max(128), title: z.string().max(200).default('候选修改'), operations: z.array(z.object({ kind: z.literal('edit'), path: z.string().min(1).max(1024), base_revision: z.string().min(1), edits: z.array(z.object({ from: point, to: point, expected_text: z.string().max(1024 * 1024), replacement: z.string().max(1024 * 1024) })).min(1).max(200) }).strict()).length(1) }).strict() },
  obsidian_get_change_status: { description: 'Read persistent proposal decisions, conflict/recovery state and current expected revision after local review. No remote accept/recover tool exists.',
    schema: z.object({ proposal_id: z.string().uuid() }) },
};
