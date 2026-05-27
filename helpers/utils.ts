/**
 * Generate a 33-character alphanumeric fingerprint for terminal auth.
 */
export function generateFingerprint(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 33; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a UUIDv7 (time-ordered UUID) for ActionIds.
 * Format: 8-4-4-4-12 hex chars with version 7 in the 3rd segment.
 */
export function generateUUIDv7(): string {
  const timestamp = BigInt(Date.now());
  const mostSigBits = ((timestamp << 16n) & 0xFFFFFFFFFFFF0000n) | (0x7n << 12n);
  const leastSigBits = (BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) * BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))) & 0xFFFFFFFFFFFF0FFFn;
  const toHex = (n: bigint, digits: number) => n.toString(16).padStart(digits, '0');
  const hiStr = toHex(mostSigBits, 16);
  const loStr = toHex(leastSigBits, 16);
  return `${hiStr.slice(0, 8)}-${hiStr.slice(8, 12)}-${hiStr.slice(12, 16)}-${loStr.slice(0, 4)}-${loStr.slice(4, 16)}`;
}

/**
 * Format current UTC time as ISO string suitable for API payloads.
 */
export function formatDateTime(): string {
  return new Date().toISOString();
}

/**
 * Get ISO date string for N hours ago (used in ticket overview queries).
 */
export function getFromDate(hoursAgo: number = 1): string {
  const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return d.toISOString();
}
