export const AUTH_BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: 'include', cache: 'no-store' });
  if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('admin-session-expired'));
  return response;
}
