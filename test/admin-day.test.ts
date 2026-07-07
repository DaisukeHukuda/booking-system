import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM, CAP_A } from './fixtures';
import { createBooking } from '../src/core/booking';

const D = '2026-08-01';

function form(data: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin day detail', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('空き状況の表と予約一覧・新規予約フォームが表示される', async () => {
    await createBooking(env.DB, makeBooking({ numAdults: 2 }));
    const res = await app.request(`/admin/day/${D}`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト太郎');
    expect(html).toContain('090-0000-0000');
    expect(html).toContain('連動クローズ');           // B/CのAM
    expect(html).toContain(`残${CAP_A - 2}`);          // AのAM残席
    expect(html).toContain('action="/admin/bookings"');
    expect(html).toContain('現地現金');
  });

  it('新規予約を登録でき、日別ページへリダイレクトされる', async () => {
    const res = await app.request('/admin/bookings', {
      ...form({
        plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
        customer_name: '電話予約の客', customer_phone: '080-1111-2222',
        party_size: '3', total_amount: '24000', payment_method: 'onsite_cash', notes: ''
      }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=created`);
    const row = await env.DB.prepare(
      `SELECT customer_name, party_size, created_by FROM bookings WHERE customer_name = '電話予約の客'`
    ).first<{ customer_name: string; party_size: number; created_by: string }>();
    expect(row?.party_size).toBe(3);
    expect(row?.created_by).toBe('admin');
  });

  it('連動クローズ枠への登録は error=unavailable で戻される', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_A }));
    const res = await app.request('/admin/bookings', {
      ...form({
        plan_id: String(PLAN_B), slot_type_id: String(SLOT_AM), date: D,
        customer_name: '無理な客', customer_phone: '', party_size: '1',
        total_amount: '0', payment_method: 'onsite_cash', notes: ''
      }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?error=unavailable`);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE customer_name = '無理な客'`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('入力不備は error=invalid で戻される', async () => {
    const res = await app.request('/admin/bookings', {
      ...form({
        plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
        customer_name: '', customer_phone: '', party_size: '2',
        total_amount: '0', payment_method: 'onsite_cash', notes: ''
      }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=invalid');
  });

  it('キャンセルできる（論理削除・取消表示）', async () => {
    const created = await createBooking(env.DB, makeBooking());
    if (!created.ok) throw new Error('setup failed');
    const res = await app.request(`/admin/bookings/${created.bookingId}/cancel`, {
      ...form({ date: D }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=cancelled`);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(created.bookingId).first<{ status: string }>();
    expect(row?.status).toBe('cancelled');
    const page = await app.request(`/admin/day/${D}`, { headers: { cookie } }, env);
    expect(await page.text()).toContain('取消');
  });

  it('不正な日付は404ではなくバリデーションエラー', async () => {
    const res = await app.request('/admin/day/2026-13-99x', { headers: { cookie } }, env);
    expect(res.status).toBe(302); // /admin へ戻す
  });
});
