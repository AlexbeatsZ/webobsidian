/**
 * Flat line icons (Lucide set — the same icon family Obsidian uses).
 * Stroke-based, 24x24 viewBox, currentColor. Add new glyphs to PATHS as needed.
 */
import type { CSSProperties } from 'react';

import { iconPaths } from '../lib/icons';

export type IconName = keyof typeof iconPaths | string;

export default function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const path = iconPaths[name] ?? iconPaths['file'];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      dangerouslySetInnerHTML={{ __html: path }}
    />
  );
}
