// One owner for the avatar data-URL contract. Two server routes used to re-declare the
// same rule with a character ceiling (7 000 000) that did not match the byte ceiling
// (5 MiB) the image decoder enforces: a GIF of ~5.25 MB passed every string gate and was
// then refused by the decoder with a different message. Size is decided from decoded
// bytes here, so the gates cannot drift apart.
//
// Dependency-free on purpose: `sharp` and `node:fs` stay out so the domain layer
// (`src/teams/agent.js`) can import this without loading a native decoder.
// test/avatar-data-url.test.js pins AVATAR_MAX_BYTES against AVATAR_LIMITS.maxBytes.

export const AVATAR_IMAGE_TYPES = Object.freeze(['png', 'jpeg', 'gif', 'webp']);
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const DATA_URL = new RegExp(`^data:image/(${AVATAR_IMAGE_TYPES.join('|')});base64,([A-Za-z0-9+/]+={0,2})$`, 'i');

/**
 * Returns the decoded bytes of an allowed avatar data-URL, or null for anything the
 * contract refuses: wrong shape, unknown type, malformed base64, empty payload, or a
 * payload that decodes past `maxBytes`.
 */
export function decodeAvatarDataUrl(value, maxBytes = AVATAR_MAX_BYTES) {
  if (typeof value !== 'string') return null;
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const base64 = match[2];
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = (base64.length / 4) * 3 - padding;
  if (bytes < 1 || bytes > maxBytes) return null;
  return Buffer.from(base64, 'base64');
}
