// Shared deterministic QA-port contract, extracted without the private app runner.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

export function djb2(value) {
  let hash = 5381;
  for (const byte of Buffer.from(value, 'utf8')) {
    hash = (Math.imul(hash, 33) + byte) >>> 0;
  }
  return hash;
}

export function normalizeSlug(value) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new Error('QA_SLUG must be 1-63 lowercase ASCII letters, digits or hyphens.');
  }
  return value;
}

export function portsForSlug(slug) {
  const offset = djb2(normalizeSlug(slug)) % 500;
  return { backend: 8200 + offset, frontend: 4400 + offset };
}
