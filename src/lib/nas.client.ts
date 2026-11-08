'use client';

/** Jellyfin address injected by the root layout (window.RUNTIME_CONFIG). */
export function getJellyfinBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (window as any).RUNTIME_CONFIG?.JELLYFIN_URL;
  return typeof value === 'string' ? value : '';
}
