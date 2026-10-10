import assert from 'node:assert/strict';import test from 'node:test';
import {zipSync,strToU8} from 'fflate';
import {extractInstructionFile} from '../src/server/instruction-files-api.js';
const input=(name,bytes)=>({name,data:Buffer.from(bytes).toString('base64')});
test('TXT and Markdown extraction preserves instruction text without executing it',async()=>{
 for(const name of ['guide.txt','guide.md']){const result=await extractInstructionFile(input(name,'# Reference\nDo not execute this document.'));assert.match(result.text,/# Reference/);assert.equal(result.name,name);}
});
test('DOCX extraction reads paragraph text and ignores active or external relationships',async()=>{
 const xml='<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Alpha &amp; Beta</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>';
 const bytes=zipSync({'word/document.xml':strToU8(xml),'word/_rels/document.xml.rels':strToU8('<Relationship Target="file:///unread"/>'),'word/vbaProject.bin':strToU8('never execute')});
 const result=await extractInstructionFile(input('guide.docx',bytes));assert.equal(result.text,'Alpha & Beta\nSecond paragraph');
 const active=zipSync({'word/document.xml':strToU8('<!DOCTYPE x><w:t>Forbidden</w:t>')});await assert.rejects(extractInstructionFile(input('active.docx',active)),/Active XML/);
});
test('PDF extraction reads selectable page text',async()=>{
 const content='BT /F1 12 Tf 10 50 Td (PDF reference text) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'];
 let pdf='%PDF-1.4\n',offsets=[0];for(let n=0;n<objects.length;n++){offsets.push(Buffer.byteLength(pdf));pdf+=(n+1)+' 0 obj\n'+objects[n]+'\nendobj\n';}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 const result=await extractInstructionFile(input('guide.pdf',pdf));assert.match(result.text,/PDF reference text/);
});
test('unsupported, malformed and oversized instruction documents are refused',async()=>{
 assert.throws(()=>extractInstructionFile(input('script.js','process.exit()')),/TXT/);
 await assert.rejects(extractInstructionFile(input('fake.pdf','not a PDF')),/Invalid PDF/);
 await assert.rejects(extractInstructionFile(input('fake.docx','not DOCX')),/Invalid DOCX/);
 await assert.rejects(extractInstructionFile(input('big.txt','a'.repeat(12001))),/12000/);
});
