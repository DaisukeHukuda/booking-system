import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, AGENCY_1 } from './fixtures';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin agencies', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('一覧に代理店名・専用リンク・モードが表示される', async () => {
    const res = await app.request('/admin/agencies', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト代理店');
    expect(html).toContain('/a/test-agency-token-0123456789abcdef');
    expect(html).toContain('リクエスト');
  });

  it('代理店を作成でき、32文字以上のトークンが発行される', async () => {
    const res = await app.request('/admin/agencies', form({
      name: 'ホテル金谷', email: 'kanaya@example.com', booking_mode: 'realtime'
    }, cookie), env);
    expect(res.status).toBe(302);
    const row = await env.DB.prepare(`SELECT token, booking_mode, active, email FROM agencies WHERE name = 'ホテル金谷'`)
      .first<{ token: string; booking_mode: string; active: number; email: string }>();
    expect(row?.token.length).toBeGreaterThanOrEqual(32);
    expect(row?.booking_mode).toBe('realtime');
    expect(row?.active).toBe(1);
  });

  it('編集でモード・有効フラグを変更できる', async () => {
    const res = await app.request(`/admin/agencies/${AGENCY_1}`, form({
      name: 'テスト代理店', email: 'agency@example.com', booking_mode: 'realtime', notes: ''
      // active チェックなし = 無効化
    }, cookie), env);
    expect(res.status).toBe(302);
    const row = await env.DB.prepare(`SELECT booking_mode, active FROM agencies WHERE id = ?`).bind(AGENCY_1)
      .first<{ booking_mode: string; active: number }>();
    expect(row).toEqual({ booking_mode: 'realtime', active: 0 });
  });

  it('トークンを再発行すると値が変わる', async () => {
    const before = await env.DB.prepare(`SELECT token FROM agencies WHERE id = ?`).bind(AGENCY_1).first<{ token: string }>();
    const res = await app.request(`/admin/agencies/${AGENCY_1}/reissue`, form({}, cookie), env);
    expect(res.status).toBe(302);
    const after = await env.DB.prepare(`SELECT token FROM agencies WHERE id = ?`).bind(AGENCY_1).first<{ token: string }>();
    expect(after?.token).not.toBe(before?.token);
    expect(after?.token.length).toBeGreaterThanOrEqual(32);
  });

  it('名前が空の作成は error=invalid', async () => {
    const res = await app.request('/admin/agencies', form({ name: '', email: '', booking_mode: 'request' }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=invalid');
  });
});
