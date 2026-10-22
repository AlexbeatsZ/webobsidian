export default function MatchLabel({ text, ranges = [] }: { text: string; ranges?: [number, number][] }) {
  let offset = 0;
  const children: React.ReactNode[] = [];
  for (const [a, b] of ranges) {
    const start = Math.max(offset, a),
      end = Math.min(text.length, b);
    if (end <= start) continue;
    children.push(text.slice(offset, start), <mark key={`${start}:${end}`}>{text.slice(start, end)}</mark>);
    offset = end;
  }
  children.push(text.slice(offset));
  return <>{children}</>;
}
