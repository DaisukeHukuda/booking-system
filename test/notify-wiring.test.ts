import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, SLOT_AM } from './fixtures';
import { createBooking } from '../src/core/booking';

const TOKEN = 'test-agency-token-0123456789abcdef';
const D = '2026-08-01';

function form(data: Record<string, string>, cookie = '') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(data).toString()
  };
}

async function logsByType(type: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_log WHERE type = ?`).bind(type).first<{ n: number }>();
  return r?.n ?? 0;
}

describe('notification wiring', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('代理店の予約リクエストで requested 通知が記録される（キー未設定なので skipped）', async () => {
    await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '通知客', customer_phone: '', num_adults: '1', num_children: '0', notes: ''
    }), env);
    expect(await logsByType('requested')).toBe(1);
    const log = await env.DB.prepare(`SELECT status FROM email_log LIMIT 1`).first<{ status: string }>();
    expect(log?.status).toBe('skipped');
  });

  it('管理画面の承認・否認で approved / denied 通知が記録される', async () => {
    const r1 = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    const r2 = await createBooking(env.DB, makeBooking({ status: 'requested', slotTypeId: 2, customerName: '否認される客' }));
    if (!r1.ok || !r2.ok) throw new Error('setup failed');
    await app.request(`/admin/bookings/${r1.bookingId}/approve`, form({ back: '/admin/requests' }, cookie), env);
    await app.request(`/admin/bookings/${r2.bookingId}/deny`, form({ back: '/admin/requests' }, cookie), env);
    expect(await logsByType('approved')).toBe(1);
    expect(await logsByType('denied')).toBe(1);
  });

  it('管理画面の新規予約とキャンセルでも created / cancelled 通知が記録される', async () => {
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '電話の客', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    expect(await logsByType('created')).toBe(1);
    const b = await env.DB.prepare(`SELECT id FROM bookings LIMIT 1`).first<{ id: number }>();
    await app.request(`/admin/bookings/${b!.id}/cancel`, form({ date: D }, cookie), env);
    expect(await logsByType('cancelled')).toBe(1);
  });

  it('email_log にエラーがあると管理画面ホームに警告が出る', async () => {
    await env.DB.prepare(
      `INSERT INTO email_log (booking_id, to_address, type, status, error, created_at)
       VALUES (NULL, 'x@example.com', 'created', 'error', 'HTTP 401', '2026-07-07T00:00:00.000Z')`
    ).run();
    const res = await app.request('/admin', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('メール送信エラー');
  });
});
