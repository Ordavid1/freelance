// Server-side check of a profile image stored as a data URL (the profile document is the only store).
// The browser re-encodes every upload to WebP (see compress-image.ts, 300 KB at most), so valid input is a
// raster image whose bytes really are what the declared type says. SVG is never accepted: it is a document
// that can carry script and external references, and is not needed for a photo or logo.

export const MAX_PROFILE_IMAGE_BYTES = 1_500_000;
const PATTERN = /^data:image\/(png|jpeg|webp|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  png: bytes => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: bytes => startsWith(bytes, [0xff, 0xd8, 0xff]),
  // RIFF <size> WEBP
  webp: bytes => startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8),
  // ISO base media: <size> 'ftyp' then a brand; AVIF stills use avif/avis (or mif1 listing avif as compatible).
  avif: bytes => startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)
    && (startsWith(bytes, [0x61, 0x76, 0x69, 0x66], 8) || startsWith(bytes, [0x61, 0x76, 0x69, 0x73], 8)
      || Buffer.from(bytes.subarray(8, 64)).includes('avif')),
};

/** True for a PNG, JPEG, WebP or AVIF data URL whose decoded bytes carry the matching signature and fit the size limit. */
export function isValidProfileImage(value: string): boolean {
  // Cheap length gate before decoding anything: base64 is 4 characters per 3 bytes.
  if (value.length > Math.ceil(MAX_PROFILE_IMAGE_BYTES / 3) * 4 + 40) return false;
  const match = PATTERN.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = Buffer.from(match[2], 'base64');
  return bytes.byteLength > 12 && bytes.byteLength <= MAX_PROFILE_IMAGE_BYTES && SIGNATURES[match[1]](bytes);
}
