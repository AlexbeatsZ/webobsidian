import { normalizeMathConfiguration, type MathConfiguration } from '@webobsidian/markdown-core';
import { api } from './api';

export interface MathPreambleSegment { source: string; tex: string }
export interface MathProfile { configuration: MathConfiguration; segments: readonly MathPreambleSegment[]; key: string }
/** No parser, watcher or settings store: those remain owned by the existing host. */
export async function prepareMathProfile(value?: Partial<MathConfiguration>): Promise<MathProfile> {
  const configuration = normalizeMathConfiguration(value);
  const segments: MathPreambleSegment[] = [];
  if (configuration.preambleFile) {
    const { content } = await api.pluginAdapter('read', configuration.preambleFile);
    segments.push({ source: configuration.preambleFile, tex: content.replace(/^\uFEFF/, '') });
  }
  if (configuration.preamble.trim()) segments.push({ source: '附加宏', tex: configuration.preamble });
  return { configuration, segments, key: JSON.stringify([configuration.packages.slice().sort(), configuration.packageOptions, segments]) };
}
