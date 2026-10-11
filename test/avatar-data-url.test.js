import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_LIMITS } from '../src/profile/avatar.js';
import { AVATAR_MAX_BYTES, decodeAvatarDataUrl } from '../src/image-data-url.js';
import { assertAgent } from '../src/teams/agent.js';

const dataUrl = (bytes, type = 'png') => `data:image/${type};base64,${Buffer.alloc(bytes).toString('base64')}`;

test('the avatar ceiling is decided in bytes, and matches the decoder', () => {
  assert.equal(AVATAR_MAX_BYTES, AVATAR_LIMITS.maxBytes);
  assert.equal(decodeAvatarDataUrl(dataUrl(AVATAR_MAX_BYTES))?.length, AVATAR_MAX_BYTES);
  assert.equal(decodeAvatarDataUrl(dataUrl(AVATAR_MAX_BYTES + 1)), null);
});

test('the size the old character gate let through to the decoder is now refused', () => {
  const oversized = dataUrl(AVATAR_MAX_BYTES + 1_000);
  // The gate this replaced compared string length, so it accepted anything under
  // 7 000 000 characters — up to ~5 249 998 decoded bytes. This payload slipped past it
  // and only failed later, inside the image decoder, with a different message.
  assert.equal(oversized.length < 7_000_000, true);
  assert.equal(decodeAvatarDataUrl(oversized), null);
});

test('only the four allowed image types and well-formed base64 get decoded', () => {
  for (const value of [
    dataUrl(64, 'bmp'),
    'data:image/png;base64,',
    'data:image/png;base64,????',
    'data:image/png;base64,AA==AA==',
    'iVBORw0KGgo=',
    null,
    undefined,
    42,
  ]) assert.equal(decodeAvatarDataUrl(value), null, `${String(value)} must be refused`);

  assert.equal(decodeAvatarDataUrl(dataUrl(64))?.length, 64);
  for (const type of ['png', 'jpeg', 'gif', 'webp']) assert.ok(decodeAvatarDataUrl(dataUrl(64, type)));
});

test('assertAgent refuses an oversized avatar with the same message the route uses', () => {
  const base = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana', description: '', instructions: '' };
  assert.equal(assertAgent({ ...base, visual: { image: dataUrl(64) } }).visual.image, dataUrl(64));
  assert.throws(() => assertAgent({ ...base, visual: { image: dataUrl(AVATAR_MAX_BYTES + 1) } }), /Invalid avatar image/);
  assert.throws(() => assertAgent({ ...base, visual: { image: 'data:image/svg+xml;base64,aGVsbG8=' } }), /Invalid avatar image/);
});
