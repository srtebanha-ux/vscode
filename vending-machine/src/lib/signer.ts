import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface DownloadClaim {
  orderId: string;
  productId: string;
  exp: number;
}

const VERSION = 'v1';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', config.DOWNLOAD_SECRET).update(payload).digest('base64url');
}

export function issueToken(claim: Omit<DownloadClaim, 'exp'>, ttlSeconds = config.DOWNLOAD_TTL_SECONDS): string {
  const full: DownloadClaim = { ...claim, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = b64url(JSON.stringify(full));
  return `${VERSION}.${payload}.${sign(`${VERSION}.${payload}`)}`;
}

export type VerifyResult =
  | { ok: true; claim: DownloadClaim }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyToken(token: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== VERSION) return { ok: false, reason: 'malformed' };

  const expected = Buffer.from(sign(`${version}.${payload}`));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claim: DownloadClaim;
  try {
    claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DownloadClaim;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claim.orderId !== 'string' || typeof claim.productId !== 'string' || typeof claim.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (claim.exp * 1000 < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, claim };
}

export function downloadUrl(token: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/download/${token}`;
}
