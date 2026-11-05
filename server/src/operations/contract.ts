import { z } from 'zod';
const point = z.object({ line: z.number().int().min(1), ch: z.number().int().min(0) });
const notePath = z.string().min(1).max(1024);
const proposalOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('edit'), path: notePath, base_revision: z.string().min(1),
    edits: z.array(z.object({ from: point, to: point, expected_text: z.string().max(1024 * 1024), replacement: z.string().max(1024 * 1024) })).min(1).max(200) }).strict(),
  z.object({ kind: z.literal('create'), path: notePath, content: z.string().max(1024 * 1024) }).strict(),
  z.object({ kind: z.literal('rename'), path: notePath, to: notePath, base_revision: z.string().min(1) }).strict(),
]);
export const operationContract = {
  obsidian_get_context: { description: 'Read user-queued MCP context first: explicit selections with captured source positions/revisions, or page paths without body text. Successfully delivered unpinned items are removed; pinned items remain. Otherwise read the last local note/selection. Also returns the full text of the notes the user selected as standing instructions (standing_instructions); follow them. Call at the start of each user request and for here/this requests.',
    schema: z.object({ nearby_lines: z.number().int().min(0).max(100).default(12) }) },
  obsidian_list_files: { description: 'List saved visible VaultCatalog file metadata, paginated; no full Vault body scan.',
    schema: z.object({ path: z.string().default(''), type: z.enum(['all', 'text', 'attachment', 'markdown']).default('all'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }) },
  obsidian_search: { description: 'Use the native indexed Markdown search and its field/tag query syntax. Saved index scope and body limits apply. Read returned files before editing; unsaved drafts are not globally indexed.',
    schema: z.object({ query: z.string().trim().min(1).max(500), path: z.string().default(''), max_results: z.number().int().min(1).max(100).default(20), mode: z.enum(['literal', 'pinyin']).default('literal') }) },
  obsidian_read_file: { description: 'Read a bounded range with full-content revision. Connected editor buffers take precedence. Conflicting drafts fail. Lines are 1-based, columns UTF-16 0-based. Hidden/config files are excluded.',
    schema: z.object({ path: z.string().min(1).max(1024), start_line: z.number().int().min(1).default(1), line_count: z.number().int().min(1).max(2000).default(200) }) },
  obsidian_find_targets: { description: 'Find Vault-global reference targets in the saved index: equations (eq-), headings (heading-), code-, callout-, table-, html- and range- blocks. Query matches ID, label, numbered-formula TeX and path. Link a result with [[^id]] and embed it with ![[^id]]. Pass id to check one exact ID instead: status missing means the ID is free to define; resolved/ambiguous list where it is used. Unsaved drafts are not indexed.',
    schema: z.object({ query: z.string().trim().max(500).default(''), id: z.string().trim().min(1).max(256).optional(),
      kind: z.enum(['all', 'heading', 'equation', 'code', 'callout', 'table', 'html', 'range']).default('all'),
      path: z.string().default(''), limit: z.number().int().min(1).max(100).default(30) }) },
  obsidian_propose_changes: { description: 'Submit ONE Markdown note operation for local human review, never direct write: edit with path/base_revision/edits, create with a new path/content, or rename with path/to/base_revision from a fresh read. Create never overwrites; rename preserves content and requires saved source. Same request_id is idempotent only for identical input. Delete, folders and multiple-operation groups are unsupported. Never bypass local approval via another tool; do not poll continuously. Content must follow the standing instruction notes returned by obsidian_get_context.',
    schema: z.object({ request_id: z.string().min(1).max(128), title: z.string().max(200).default('候选修改'), operations: z.array(proposalOperation).length(1) }).strict() },
  obsidian_get_change_status: { description: 'Read persistent proposal decisions, conflict/recovery state and current expected revision after local review. No remote accept/recover tool exists.',
    schema: z.object({ proposal_id: z.string().uuid() }) },
};
