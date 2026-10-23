import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { operationNames, type OperationName } from '@webobsidian/markdown-core';
import { operationContract } from '../operations/contract.js';
import { callOperation, nativeReview } from '../services/operations.js';

export const operationsRouter = Router();
operationsRouter.get('/tools', (_req, res) => res.json({ tools: operationNames.map(name => ({ name, description: operationContract[name].description })) }));
operationsRouter.post('/call', asyncHandler(async (req, res) => {
  const input = z.object({ name: z.enum(operationNames), arguments: z.unknown().optional() }).parse(req.body);
  res.json(await callOperation(input.name as OperationName, input.arguments));
}));
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
