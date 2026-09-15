// DOC-010/BACK-019/BACK-025: business-logo lifecycle. Only safe RASTER
// formats are ever accepted -- PNG, JPEG, WebP. SVG (and every other
// script-capable format) is rejected outright: an SVG file can embed
// <script>/event-handler attributes that execute when rendered inline,
// which this app must never do for user-supplied content (DOC-P01's own
// "no script execution" principle, generalized from text fields to
// binary assets).
//
// Format is determined from the file's own BYTES (the first few "magic
// number" bytes each format's spec guarantees), never from a File.type
// or filename extension -- both are just labels the browser/OS attaches
// and are trivially spoofable (a script renamed logo.png, or a File
// object with a forged .type).
//
// Everything here is pure and works identically in a browser or Node
// (no `Image`/`createImageBitmap` decode step -- that requires an actual
// browser image decoder and is a separate, UI-layer concern for
// dimension limits; this module only ever validates bytes on disk).
export const MAX_LOGO_BYTES = 1024 * 1024; // 1 MiB — BACK-019's own boundary.
export const MAX_LOGO_DIMENSION_PX = 2000; // generous print-quality cap; enforced by the browser-layer decode step (see ProApp.tsx).

export type LogoMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface LogoValidationError {
  code: 'empty' | 'too_large' | 'unsupported_format' | 'malformed_data_uri' | 'malformed_base64' | 'mime_mismatch' | 'decode_failed';
  message: string;
}

export type LogoValidationResult =
  | { ok: true; mimeType: LogoMimeType; dataUri: string }
  | { ok: false; error: LogoValidationError };

/** Sniffs the real image format from its own bytes. Returns null for
 * anything else, INCLUDING a well-formed SVG (XML text, no binary magic
 * number matches any of these -- rejected by construction, not by an
 * explicit SVG-detection branch that could be bypassed). */
export function sniffImageFormat(bytes: Uint8Array): LogoMimeType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'; // RIFF....WEBP
  }
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is available in both browsers and (as of the Node versions this
  // project targets) globalThis; storage/db.ts's own environment already
  // assumes a browser-like global scope.
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Validates raw file bytes (before any encoding) -- the path a fresh
 * upload takes. Never rejects on size AFTER checking format, or vice
 * versa in a way that leaks which check failed first for a security-
 * relevant reason; both are simple, non-sensitive UX-facing checks so
 * ordering only affects which single message is shown. */
export function validateLogoBytes(bytes: Uint8Array): LogoValidationResult {
  if (bytes.length === 0) return { ok: false, error: { code: 'empty', message: 'The selected file is empty.' } };
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, error: { code: 'too_large', message: `Logo file is ${bytes.length} bytes; the maximum is ${MAX_LOGO_BYTES} bytes (1 MiB).` } };
  }
  const mimeType = sniffImageFormat(bytes);
  if (!mimeType) {
    return { ok: false, error: { code: 'unsupported_format', message: 'Only PNG, JPEG, or WebP images are supported (checked by file content, not name or declared type).' } };
  }
  return { ok: true, mimeType, dataUri: `data:${mimeType};base64,${bytesToBase64(bytes)}` };
}

const DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Validates an already-stored/imported data URI -- the path backup
 * import (and any other "trust but verify" read of persisted data)
 * takes. Re-derives the format from the ACTUAL decoded bytes and
 * confirms it matches the URI's own declared `image/...` prefix, so a
 * hand-crafted string claiming `image/png` but containing a different
 * (or unsupported) payload is rejected rather than trusted at face value.
 */
export function parseLogoDataUri(dataUri: string): LogoValidationResult {
  const match = DATA_URI_PATTERN.exec(dataUri.trim());
  if (!match) {
    return { ok: false, error: { code: 'malformed_data_uri', message: 'Logo is not a well-formed PNG/JPEG/WebP data URI.' } };
  }
  const [, declaredMime, base64] = match;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return { ok: false, error: { code: 'malformed_base64', message: 'Logo data is not valid base64.' } };
  }
  const result = validateLogoBytes(bytes);
  if (!result.ok) return result;
  if (result.mimeType !== declaredMime) {
    return { ok: false, error: { code: 'mime_mismatch', message: `Declared type "${declaredMime}" does not match the file's actual content ("${result.mimeType}").` } };
  }
  return result;
}
