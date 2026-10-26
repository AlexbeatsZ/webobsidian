export interface PdfFixtureOptions {
  pages?: number | readonly string[];
  outline?: boolean;
  pageSizes?: readonly (readonly [number, number])[];
  documentScript?: string;
}

export function makePdfFixture({ pages = 6, outline = true, pageSizes = [], documentScript }: PdfFixtureOptions = {}): Buffer {
  const texts = typeof pages === 'number'
    ? Array.from({ length: Math.max(1, Math.min(1000, Math.floor(pages))) }, (_, index) =>
      `Page ${index + 1}\nneedle ${index % 2 ? 'beta' : 'alpha'} on page ${index + 1}\nShared document text`)
    : [...pages];
  if (!texts.length) throw new Error('A PDF fixture needs at least one page');
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageIds: number[] = [];
  const escape = (text: string) => text.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  for (const [index, text] of texts.entries()) {
    const pageId = objects.length + 1, contentId = pageId + 1;
    pageIds.push(pageId);
    const [width, height] = pageSizes[index] ?? [612, 792];
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = `BT /F1 20 Tf 54 ${height - 72} Td ${text.split('\n').map((line, index) => `${index ? '0 -32 Td ' : ''}(${escape(line)}) Tj`).join('\n')} ET\n`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  const target = pageIds[Math.min(1, pageIds.length - 1)];
  let extra = '';
  if (outline) {
    const root = objects.length + 1, first = root + 1, second = root + 2;
    objects.push(`<< /Type /Outlines /First ${first} 0 R /Last ${second} 0 R /Count 2 >>`);
    objects.push(`<< /Title (Chapter One) /Parent ${root} 0 R /Next ${second} 0 R /Dest [${pageIds[0]} 0 R /Fit] >>`);
    objects.push(`<< /Title (Chapter Two) /Parent ${root} 0 R /Prev ${first} 0 R /Dest (chapter-two) >>`);
    extra = ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
  }
  const action = documentScript ? ` /OpenAction << /S /JavaScript /JS (${escape(documentScript)}) >>` : '';
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${extra}${action} /Names << /Dests << /Names [(chapter-two) [${target} 0 R /Fit]] >> >> >>`;
  objects[1] = `<< /Type /Pages /Count ${texts.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.7\n', offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
