import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

const D = '2026-08-01';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin new booking page', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('新規予約ページに日付入力付きフォームが表示される', async () => {
    const res = await app.request('/admin/new', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/admin/bookings"');
    expect(html).toContain('name="date"');
    expect(html).toContain('仮予約');
  });

  it('仮予約チェックで requested として登録され、リクエスト通知が記録される', async () => {
    const res = await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '電話の仮予約', customer_phone: '', num_adults: '2', num_children: '0',
      total_amount: '', payment_method: 'onsite_cash', notes: '', as_request: '1'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=requested`);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE customer_name = '電話の仮予約'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('requested');
    const log = await env.DB.prepare(`SELECT type FROM email_log ORDER BY id DESC LIMIT 1`).first<{ type: string }>();
    expect(log?.type).toBe('requested');
  });

  it('as_requestなしは従来どおり confirmed', async () => {
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '通常予約', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE customer_name = '通常予約'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('confirmed');
  });

  it('未ログインは302', async () => {
    expect((await app.request('/admin/new', {}, env)).status).toBe(302);
  });
});
