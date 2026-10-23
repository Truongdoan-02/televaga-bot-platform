const backend = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
export function assetUrl(value: string): string {
  try { const url = new URL(value); if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/uploads/')) return backend + url.pathname; }
  catch { /* Relative upload URL. */ }
  return value.startsWith('/uploads/') ? backend + value : value;
}
