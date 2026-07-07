export function resolveBack(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.startsWith('/admin/') ? v : fallback;
}

export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
