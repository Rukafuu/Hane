import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ProfileError } from './local-auth.js';

export const AVATAR_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxPixels: 16_000_000, maxDimension: 8192, outputSize: 256, maxFrames: 120 });
export function imageFormat(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'webp';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())) return 'gif';
  return null;
}
export async function processAvatar(bytes, limits = AVATAR_LIMITS) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > limits.maxBytes || !imageFormat(bytes)) throw new ProfileError(400, 'Use uma imagem PNG, JPEG, WebP ou GIF de até 5 MB.');
  try {
    const animated = imageFormat(bytes) === 'gif';
    const image = sharp(bytes, { limitInputPixels: limits.maxPixels, failOn: 'warning', animated });
    const meta = await image.metadata();
    const frames = meta.pages ?? 1, frameHeight = meta.pageHeight ?? meta.height;
    if (!['png','jpeg','webp','gif'].includes(meta.format) || !meta.width || !frameHeight || Math.max(meta.width,frameHeight) > limits.maxDimension || meta.width * frameHeight * frames > limits.maxPixels || frames > (limits.maxFrames ?? AVATAR_LIMITS.maxFrames) || (!animated && frames > 1)) throw new Error('limits');
    // Decodes pixels, auto-orients and re-encodes; no original bytes or metadata survive.
    // GIF frames and their timing survive the same central crop, in animated WebP.
    const output = await (frames === 1 ? image.rotate() : image).resize(limits.outputSize,limits.outputSize,{fit:'cover',position:'centre'}).webp({quality:85}).toBuffer();
    if (output.length > limits.maxBytes) throw new Error('output limits');
    return output;
  } catch { throw new ProfileError(400, 'Não foi possível ler a imagem. Use até 16 megapixels no total, 8192 px por lado e 120 quadros para GIF.'); }
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
