/**
 * 豆包视频 main_url / qAAB token 解密（移植自 ihmily/doubao-nomark）。
 * 纯 Node crypto，零 Electron 依赖，可供 CLI / 主进程共用。
 */
import { createDecipheriv, createHash } from 'node:crypto';

/** nomark 固定 salt（与上游 video_crypto.QAAB_SALT 一致）。 */
export const QAAB_SALT = Buffer.from(
  '4dd4c2e6b83162090e52b3c7a6733ba4' +
    '1cb2462b829ab58a196b39db57177524' +
    'f49baf7f08e8d68d26a72e37c1a95a2f' +
    '1f05a51892aef2949732b62a38aadd58',
  'hex',
);

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

function decodeBase64Loose(value: string): Buffer | null {
  const text = String(value || '').trim();
  const variants = [
    text,
    text.replace(/\$/g, '_').replace(/@/g, '/').replace(/#/g, '.'),
    text.replace(/\$/g, '+').replace(/@/g, '/').replace(/#/g, '='),
  ];
  const seen = new Set<string>();
  for (const candidate of variants) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    let normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    if (pad) normalized += '='.repeat(4 - pad);
    try {
      return Buffer.from(normalized, 'base64');
    } catch {
      // continue
    }
  }
  return null;
}

function urlFromBytes(value: Buffer): string {
  if (!value || value.length === 0) return '';
  for (const byte of value) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) return '';
  }
  const url = value.toString('ascii').trim();
  return isHttpUrl(url) ? url : '';
}

function stripPkcs7(value: Buffer): Buffer {
  if (!value || value.length === 0) return value;
  const padding = value[value.length - 1];
  if (padding < 1 || padding > 16 || padding > value.length) return value;
  for (let i = value.length - padding; i < value.length; i += 1) {
    if (value[i] !== padding) return value;
  }
  return value.subarray(0, value.length - padding);
}

function decryptAesCbcUrl(payload: Buffer, key: Buffer, iv: Buffer): string {
  if (!payload || payload.length === 0 || payload.length % 16 !== 0) return '';
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
    return urlFromBytes(plaintext) || urlFromBytes(stripPkcs7(plaintext));
  } catch {
    return '';
  }
}

/** 解密 qAAB 开头的加密 media token。 */
export function decodeQaabToken(token: string, keySeed: string): string {
  const data = decodeBase64Loose(token);
  const seed = decodeBase64Loose(keySeed);
  if (!data || !seed || seed.length < 1) return '';

  const firstDigest = createHash('sha512').update(seed.subarray(0, 32)).digest();
  const material = createHash('sha512').update(Buffer.concat([firstDigest, QAAB_SALT])).digest();
  const key = material.subarray(0, 16);
  const iv = material.subarray(16, 32);

  const attempts: Array<{ payload: Buffer; key: Buffer; iv: Buffer }> = [];
  if (data.length >= 4 && data[0] === 0xa8 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
    attempts.push({ payload: data.subarray(4), key, iv });
    attempts.push({ payload: data.subarray(4), key: iv, iv: key });
    if (data.length > 36) {
      attempts.push({ payload: data.subarray(36), key, iv: data.subarray(20, 36) });
      attempts.push({ payload: data.subarray(36), key, iv });
    }
  } else {
    attempts.push({ payload: data, key, iv });
  }

  for (const attempt of attempts) {
    const url = decryptAesCbcUrl(attempt.payload, attempt.key, attempt.iv);
    if (url) return url;
  }
  return '';
}

/**
 * 解码 plain / Base64 包装 / qAAB 加密的 media URL。
 * 上游：decode_main_url。
 */
export function decodeMainUrl(token: string, keySeed = ''): string {
  const raw = String(token || '').trim();
  if (isHttpUrl(raw)) return raw;
  const decoded = decodeBase64Loose(raw);
  const plain = urlFromBytes(decoded || Buffer.alloc(0));
  if (plain) return plain;
  if (raw.startsWith('qAAB') && keySeed) return decodeQaabToken(raw, keySeed);
  return '';
}
