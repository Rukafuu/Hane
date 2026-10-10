import { parentPort, workerData } from 'node:worker_threads';
try {
 const {name,data}=workerData,bytes=Buffer.from(data,'base64'),extension=name.split('.').at(-1).toLowerCase();let text='';
 if(['txt','md'].includes(extension))text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 else if(extension==='docx') {
  if(bytes.readUInt32LE(0)!==0x04034b50)throw new Error('Invalid DOCX file.');
  const {unzipSync}=await import('fflate');
  const entries=unzipSync(new Uint8Array(bytes),{filter:file=>{if(file.name!=='word/document.xml')return false;if(file.originalSize>1000000)throw new Error('Document XML exceeds its limit.');return true;}});
  const document=entries['word/document.xml'];if(!document)throw new Error('DOCX has no document text.');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(document);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Active XML declarations are not supported.');
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  const decode=value=>value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(all,key)=>{if(entities[key])return entities[key];const point=key.startsWith('#x')?parseInt(key.slice(2),16):Number(key.slice(1));return point>=0&&point<=0x10ffff?String.fromCodePoint(point):all;});
  for(const match of xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<\/w:p>/g))text+=match[1]!==undefined?decode(match[1]):match[0].includes('tab')?'\t':'\n';
 } else if(extension==='pdf') {
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid PDF file.');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {createRequire}=await import('node:module');
  const require=createRequire(import.meta.url);
  const path=await import('node:path');
  const standardFontDataUrl=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/';
  const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl,isEvalSupported:false,disableFontFace:true,useSystemFonts:false});
  const pdf=await task.promise;
  try {
   if(pdf.numPages>100)throw new Error('Document has too many pages.');
   for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();text+=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n';if(text.length>12000)throw new Error('Document text exceeds 12000 characters.');}
  }finally{await task.destroy();}
 } else throw new Error('Use TXT, Markdown, PDF or DOCX.');
 text=text.trim();if(!text||text.length>12000)throw new Error('Document must contain 1-12000 characters of selectable text.');
 parentPort.postMessage({text});
}catch(e){parentPort.postMessage({error:e.message});}
