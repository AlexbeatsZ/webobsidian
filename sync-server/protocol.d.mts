import type { SyncManifest } from '../server/src/contracts/fileSync.js';
export const prefix: string;
export const defaultPort: number;
export const hashPattern: RegExp;
export const idPattern: RegExp;
export function validPath(value: unknown): value is string;
export function validateManifest(value: unknown): asserts value is SyncManifest;
