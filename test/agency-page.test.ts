import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM, AGENCY_1 } from './fixtures';
import { createBooking } from '../src/core/booking';

const TOKEN = 'test-agency-token-0123456789abcdef';
const D = '2026-08-01';

function form(data: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  };
}

const bookingForm = (over: Record<string, string> = {}) => form({
  plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
  customer_name: '代理店経由の客', customer_phone: '090-1111-2222',
  num_adults: '2', num_children: '0', notes: '', ...over
});

describe('agency page', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('有効トークンで空き状況とフォームが表示される', async () => {
    const res = await app.request(`/a/${TOKEN}`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト代理店');
    expect(html).toContain('プランA');
    expect(html).toContain(`action="/a/${TOKEN}/bookings"`);
  });

  it('無効トークン・無効化された代理店は404', async () => {
    expect((await app.request('/a/wrong-token', {}, env)).status).toBe(404);
    await env.DB.prepare(`UPDATE agencies SET active = 0 WHERE id = ?`).bind(AGENCY_1).run();
    expect((await app.request(`/a/${TOKEN}`, {}, env)).status).toBe(404);
  });

  it('リクエストモードの代理店の予約は requested で登録され、在庫を押さえる', async () => {
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?ok=requested`);
    const row = await env.DB.prepare(
      `SELECT status, agency_id, created_by, payment_method, total_amount FROM bookings WHERE customer_name = '代理店経由の客'`
    ).first<{ status: string; agency_id: number; created_by: string; payment_method: string; total_amount: number }>();
    expect(row).toEqual({ status: 'requested', agency_id: AGENCY_1, created_by: 'agency', payment_method: 'invoice', total_amount: 16000 });
    // 在庫を押さえている: 同時間帯の連動プランは不可
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }))).ok).toBe(false);
  });

  it('即時確定モードなら confirmed で登録される', async () => {
    await env.DB.prepare(`UPDATE agencies SET booking_mode = 'realtime' WHERE id = ?`).bind(AGENCY_1).run();
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?ok=created`);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE customer_name = '代理店経由の客'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('confirmed');
  });

  it('埋まっている枠には error=unavailable', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '先客' }));
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?error=unavailable`);
  });

  it('自店の予約だけが一覧に見える', async () => {
    await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: 2, customerName: '自社の客' }));
    const html = await (await app.request(`/a/${TOKEN}`, {}, env)).text();
    expect(html).toContain('代理店経由の客');
    expect(html).not.toContain('自社の客');
  });

  it('自店の予約をキャンセルできる。自社の予約はキャンセルできない', async () => {
    await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    const own = await env.DB.prepare(`SELECT id FROM bookings WHERE customer_name = '代理店経由の客'`).first<{ id: number }>();
    const other = await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: 2, customerName: '自社の客' }));
    if (!other.ok) throw new Error('setup failed');

    let res = await app.request(`/a/${TOKEN}/bookings/${own!.id}/cancel`, form({}), env);
    expect(res.status).toBe(302);
    const cancelled = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(own!.id).first<{ status: string }>();
    expect(cancelled?.status).toBe('cancelled');

    res = await app.request(`/a/${TOKEN}/bookings/${other.bookingId}/cancel`, form({}), env);
    const untouched = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(other.bookingId).first<{ status: string }>();
    expect(untouched?.status).toBe('confirmed');
  });

  it('人数合計0は error=invalid', async () => {
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm({ num_adults: '0', num_children: '0' }), env);
    expect(res.headers.get('location')).toContain('error=invalid');
  });
});
