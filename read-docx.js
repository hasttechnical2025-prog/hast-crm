const fs = require('fs');
const PizZip = require('pizzip');

const path = 'C:\\Users\\anonymous\\Desktop\\rental_quote.docx';

try {
  const content = fs.readFileSync(path, 'binary');
  const zip = new PizZip(content);
  const docXml = zip.file('word/document.xml').asText();

  // Find all placeholders inside curly brackets {...}
  // Docxtemplater uses standard {...}
  // Matches {followed by non-curly-bracket characters}
  const regex = /\{([^}]+)\}/g;
  let match;
  const placeholders = new Set();

  while ((match = regex.exec(docXml)) !== null) {
    // Clean XML tags inside the placeholder if any (MS Word sometimes inserts XML formatting tags inside brackets, e.g. {<w:r...>total})
    const cleanTag = match[1].replace(/<[^>]+>/g, '').trim();
    placeholders.add(cleanTag);
  }

  console.log('--- DANH SÁCH PLACEHOLDERS PHÁT HIỆN ĐƯỢC ---');
  console.log(Array.from(placeholders).sort());
  console.log('\n--- THÔNG TIN CHI TIẾT ---');
  console.log('Tổng số placeholders phát hiện:', placeholders.size);
} catch (e) {
  console.error('Lỗi phân tích file DOCX:', e.stack);
}
