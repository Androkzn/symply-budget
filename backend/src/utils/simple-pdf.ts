/**
 * Minimal single-page PDF writer (text only). Avoids Browser Rendering dependency
 * for Home Project summary exports.
 */
export function buildSimplePdf(title: string, bodyLines: string[]): Uint8Array {
  const lines = [title, '', ...bodyLines].map((l) =>
    l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  );
  const contentParts: string[] = ['BT', '/F1 12 Tf', '50 780 Td', '14 TL'];
  lines.slice(0, 48).forEach((line, i) => {
    if (i === 0) {
      contentParts.push(`/F1 16 Tf (${line}) Tj`, 'T*', '/F1 11 Tf');
    } else {
      contentParts.push(`(${line.slice(0, 95)}) Tj`, 'T*');
    }
  });
  contentParts.push('ET');
  const stream = contentParts.join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n'
  );
  objects.push(
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`
  );
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
