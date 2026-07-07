import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';

describe('admin layout', () => {
  it('ログイン後の /admin にナビゲーションが表示される', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/admin/plans"');
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('ログアウト');
  });
});
