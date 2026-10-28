import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { operationNames, type OperationName } from '@webobsidian/markdown-core';
import { operationContract } from '../operations/contract.js';
import { addMcpContext, callOperation, nativeReview } from '../services/operations.js';
import { mcpContext, mcpSelectionSchema } from '../services/mcpContext.js';
import type { McpContextItem } from '../contracts.js';

export const operationsRouter = Router();
operationsRouter.get('/tools', (_req, res) => res.json({ tools: operationNames.map(name => ({ name, description: operationContract[name].description })) }));
operationsRouter.post('/call', asyncHandler(async (req, res) => {
  const input = z.object({ name: z.enum(operationNames), arguments: z.unknown().optional() }).parse(req.body);
  const send = async () => {
    if (res.destroyed) return;
    const result = await callOperation(input.name as OperationName, input.arguments);
    if (input.name !== 'obsidian_get_context' || !('queued_context' in result) || !('vault' in result)) { res.json(result); return; }
    const delivered = result as { vault: string; queued_context: McpContextItem[] };
    const finished = await new Promise<boolean>((resolve, reject) => {
      res.once('finish', () => resolve(true));
      res.once('close', () => resolve(res.writableFinished));
      try { res.json(result); } catch (error) { reject(error); }
    });
    if (finished) await mcpContext.consume(delivered.vault, delivered.queued_context).catch(error => {
      console.error('MCP context consumption failed; pending context retained:', error);
    });
  };
  if (input.name === 'obsidian_get_context') await mcpContext.deliver(send);
  else await send();
}));
operationsRouter.get('/context', asyncHandler(async (_req, res) => res.json(await mcpContext.list())));
operationsRouter.post('/context', asyncHandler(async (req, res) => {
  const input = z.object({ clientId: z.string().uuid(), path: z.string().min(1).max(1024), version: z.number().int().min(0).optional(),
    selections: z.array(mcpSelectionSchema).max(20).default([]) }).strict().parse(req.body);
  res.json(await addMcpContext(input));
}));
operationsRouter.patch('/context/:id', asyncHandler(async (req, res) => {
  const { pinned } = z.object({ pinned: z.boolean() }).strict().parse(req.body);
  res.json(await mcpContext.change(z.string().uuid().parse(req.params.id), pinned));
}));
operationsRouter.delete('/context/:id', asyncHandler(async (req, res) => res.json(await mcpContext.change(z.string().uuid().parse(req.params.id)))));
operationsRouter.get('/reviews', asyncHandler(async (_req, res) => res.json({ proposals: await nativeReview.list() })));
operationsRouter.get('/reviews/:id', asyncHandler(async (req, res) => res.json(await nativeReview.read(z.string().uuid().parse(req.params.id)))));
// Native local review actions are deliberately absent from operationContract/MCP.
operationsRouter.post('/reviews/:id/decide', asyncHandler(async (req, res) => {
  const input = z.object({ clientId: z.string().uuid(), decision: z.enum(['accepted', 'rejected']),
    hunkId: z.string().max(50).optional(), recover: z.boolean().default(false) }).parse(req.body);
  res.json(await nativeReview.decide(z.string().uuid().parse(req.params.id), input.clientId, input.decision, input.hunkId, input.recover));
}));
operationsRouter.use((error: unknown, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: '无效操作参数：' + error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ') }); }
  else next(error);
});
