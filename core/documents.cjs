const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function parseDocument(file) {
  const ext = path.extname(file).toLowerCase();
  const bytes = fs.readFileSync(file);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('Sources are limited to 25 MB.');
  if (ext === '.txt' || ext === '.md') return { text: bytes.toString('utf8'), locations: [{ page: 1, text: bytes.toString('utf8') }], coverage: 'Text file read' };
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: bytes });
    return { text: result.value, locations: [{ page: null, text: result.value }], coverage: result.messages.length ? 'Text extracted; check tables and formatting' : 'Text extracted; page positions unavailable' };
  }
  if (ext === '.pdf') {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdf.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
    const locations = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      locations.push({ page, text: content.items.map(item => item.str || '').join(' ') });
    }
    const text = locations.map(item => `[Page ${item.page}]\n${item.text}`).join('\n\n');
    if (text.length > 250000) throw new Error('This source exceeds the 250,000-character local review limit. Split it into smaller parts.');
    return { text, locations, coverage: locations.every(item => item.text.trim()) ? `${locations.length} text pages read; check table layout` : 'Some pages have no selectable text; scans need OCR or manual entry' };
  }
  throw new Error('Choose a text, Markdown, DOCX, or text-based PDF file.');
}

async function stageDocument(file, root) {
  const parsed = await parseDocument(file);
  if (parsed.text.length > 250000) throw new Error('This source exceeds the 250,000-character local review limit. Split it into smaller parts.');
  const id = randomUUID();
  const directory = path.join(root, 'sources', id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = path.basename(file);
  fs.copyFileSync(file, path.join(directory, name));
  fs.writeFileSync(path.join(directory, 'parsed.json'), JSON.stringify({ ...parsed, name, id, parserVersion: 1 }), { mode: 0o600 });
  return { id, name, ...parsed, parserVersion: 1 };
}

module.exports = { parseDocument, stageDocument };
