// DOC-010/BACK-019: byte-level format sniffing, size limits, and
// data-URI round-tripping for the business-logo lifecycle. Only PNG,
// JPEG, and WebP are ever accepted; format is derived from the file's
// own bytes, never a filename or declared MIME type, and an SVG (or any
// other non-raster/script-capable payload) is rejected by construction.
import { describe, it, expect } from 'vitest';
import { sniffImageFormat, validateLogoBytes, parseLogoDataUri, bytesToBase64, base64ToBytes, MAX_LOGO_BYTES } from '../../src/domain/logo';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const SVG_TEXT = Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));

function bytes(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}
function padded(magic: number[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  out.set(magic);
  return out;
}

describe('sniffImageFormat: derives format from bytes, never from a filename or declared type', () => {
  it('recognizes a PNG magic number', () => {
    expect(sniffImageFormat(bytes(PNG_MAGIC))).toBe('image/png');
  });
  it('recognizes a JPEG magic number', () => {
    expect(sniffImageFormat(bytes(JPEG_MAGIC))).toBe('image/jpeg');
  });
  it('recognizes a WebP (RIFF....WEBP) magic number', () => {
    expect(sniffImageFormat(bytes(WEBP_MAGIC))).toBe('image/webp');
  });
  it('returns null for SVG text, even one with an embedded <script> tag', () => {
    expect(sniffImageFormat(bytes(SVG_TEXT))).toBeNull();
  });
  it('returns null for an empty buffer', () => {
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
  });
  it('returns null for arbitrary/random bytes', () => {
    expect(sniffImageFormat(bytes([0x01, 0x02, 0x03, 0x04]))).toBeNull();
  });
});

describe('validateLogoBytes: format + size', () => {
  it('accepts a well-formed small PNG', () => {
    const result = validateLogoBytes(padded(PNG_MAGIC, 100));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe('image/png');
  });

  it('rejects an empty file', () => {
    const result = validateLogoBytes(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty');
  });

  it('rejects a file exactly 1 byte over the 1 MiB limit (BACK-019)', () => {
    const result = validateLogoBytes(padded(PNG_MAGIC, MAX_LOGO_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_large');
  });

  it('accepts a file at exactly the 1 MiB limit', () => {
    const result = validateLogoBytes(padded(PNG_MAGIC, MAX_LOGO_BYTES));
    expect(result.ok).toBe(true);
  });

  it('rejects SVG content outright, regardless of size', () => {
    const result = validateLogoBytes(bytes(SVG_TEXT));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported_format');
  });

  it('rejects a corrupt/unrecognized payload', () => {
    const result = validateLogoBytes(bytes([0xde, 0xad, 0xbe, 0xef]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported_format');
  });
});

describe('bytesToBase64 / base64ToBytes round trip exactly', () => {
  it('round-trips arbitrary bytes, including 0x00 and 0xff', () => {
    const original = bytes([0x00, 0xff, 0x10, 0x80, 0x7f, 0x01]);
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(Array.from(roundTripped)).toEqual(Array.from(original));
  });
});

describe('parseLogoDataUri: the import/read-back path, re-verified from actual content', () => {
  it('accepts a well-formed PNG data URI', () => {
    const dataUri = validateLogoBytes(padded(PNG_MAGIC, 50)) as { ok: true; dataUri: string };
    const result = parseLogoDataUri(dataUri.dataUri);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe('image/png');
  });

  it('rejects a data URI with a non-image scheme', () => {
    const result = parseLogoDataUri('data:text/plain;base64,aGVsbG8=');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed_data_uri');
  });

  it('rejects a data URI whose declared type does not match its actual bytes (spoofed MIME)', () => {
    const jpegBase64 = bytesToBase64(padded(JPEG_MAGIC, 50));
    const spoofed = `data:image/png;base64,${jpegBase64}`; // declares png, content is jpeg
    const result = parseLogoDataUri(spoofed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('mime_mismatch');
  });

  it('rejects malformed base64 content', () => {
    const result = parseLogoDataUri('data:image/png;base64,not-valid-base64!!!');
    expect(result.ok).toBe(false);
  });

  it('rejects an SVG masquerading as a data URI with an image/png declaration', () => {
    const svgBase64 = bytesToBase64(bytes(SVG_TEXT));
    const result = parseLogoDataUri(`data:image/png;base64,${svgBase64}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported_format');
  });

  it('rejects an oversized embedded payload (BACK-019, decoded from the data URI)', () => {
    const dataUri = validateLogoBytes(padded(PNG_MAGIC, MAX_LOGO_BYTES + 1));
    // validateLogoBytes itself already rejects this -- construct the URI directly to exercise parseLogoDataUri's own re-check.
    const oversizedBase64 = bytesToBase64(padded(PNG_MAGIC, MAX_LOGO_BYTES + 1));
    const result = parseLogoDataUri(`data:image/png;base64,${oversizedBase64}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_large');
    expect(dataUri.ok).toBe(false); // sanity: the same bytes are rejected at the source too
  });
});
