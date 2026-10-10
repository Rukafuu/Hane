import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ProfileError } from './local-auth.js';

export const AVATAR_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxPixels: 16_000_000, maxDimension: 8192, outputSize: 256 });
export function imageFormat(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'webp';
  return null;
}
export async function processAvatar(bytes, limits = AVATAR_LIMITS) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > limits.maxBytes || !imageFormat(bytes)) throw new ProfileError(400, 'Use uma imagem PNG, JPEG ou WebP de até 5 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: limits.maxPixels, failOn: 'warning', animated: false });
    const meta = await image.metadata();
    if (!['png','jpeg','webp'].includes(meta.format) || !meta.width || !meta.height || Math.max(meta.width,meta.height) > limits.maxDimension || (meta.pages ?? 1) > 1) throw new Error('limits');
    // Decodes pixels, auto-orients and re-encodes; no original bytes or metadata survive.
    return await image.rotate().resize(limits.outputSize,limits.outputSize,{fit:'cover',position:'centre'}).webp({quality:85}).toBuffer();
  } catch { throw new ProfileError(400, 'Não foi possível ler a imagem. Use uma foto estática de até 16 megapixels e 8192 px por lado.'); }
}
export async function saveAvatar(directory, bytes, limits) {
  const output = await processAvatar(bytes, limits);
  await mkdir(directory, { recursive:true, mode:0o700 });
  const reference = `${randomUUID()}.webp`;
  await writeFile(path.join(directory, reference), output, { flag:'wx', mode:0o600 });
  return reference;
}
export function avatarFile(directory, reference) {
  if (!/^[a-f0-9-]{36}\.webp$/.test(reference ?? '')) throw new ProfileError(404, 'Foto não encontrada.');
  return path.join(directory, reference);
}
export const loadAvatar = (directory, reference) => readFile(avatarFile(directory,reference));
export async function removeAvatar(directory, reference) { if (reference) await unlink(avatarFile(directory,reference)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
