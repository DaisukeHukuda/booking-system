import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM } from './fixtures';
import { createBooking } from '../src/core/booking';

const D = '2026-08-01';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin requests & capacity', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('承認待ち一覧にリクエスト予約が表示される', async () => {
    await createBooking(env.DB, makeBooking({ status: 'requested', customerName: 'リクエスト客' }));
    const res = await app.request('/admin/requests', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('リクエスト客');
    expect(html).toContain('承認');
    expect(html).toContain('否認');
  });

  it('承認するとconfirmedになり、日別ページへ戻れる', async () => {
    const req = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    if (!req.ok) throw new Error('setup failed');
    const res = await app.request(`/admin/bookings/${req.bookingId}/approve`, form({ back: '/admin/requests' }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/requests?ok=approved');
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(req.bookingId).first<{ status: string }>();
    expect(row?.status).toBe('confirmed');
  });

  it('否認すると denied になり枠が戻る', async () => {
    const req = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    if (!req.ok) throw new Error('setup failed');
    const res = await app.request(`/admin/bookings/${req.bookingId}/deny`, form({ back: `/admin/day/${D}` }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=denied`);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }))).ok).toBe(true);
  });

  it('日別ページに承認待ちの行が「リクエスト」表示され、承認/否認ボタンがある', async () => {
    await createBooking(env.DB, makeBooking({ status: 'requested', customerName: 'リクエスト客' }));
    const res = await app.request(`/admin/day/${D}`, { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('リクエスト客');
    expect(html).toContain('リクエスト');
    expect(html).toContain('/approve');
    expect(html).toContain('/deny');
  });

  it('日別定員を上書きでき、空欄で上書き解除できる', async () => {
    // 上書き設定
    let res = await app.request('/admin/capacity', form({
      date: D, plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), capacity: '2'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=capacity`);
    const row = await env.DB.prepare(`SELECT capacity FROM capacity_overrides WHERE date = ? AND plan_id = ? AND slot_type_id = ?`)
      .bind(D, PLAN_A, SLOT_AM).first<{ capacity: number }>();
    expect(row?.capacity).toBe(2);
    // 日別ページに反映（残2）
    const page = await app.request(`/admin/day/${D}`, { headers: { cookie } }, env);
    expect(await page.text()).toContain('残2');
    // 空欄で解除
    res = await app.request('/admin/capacity', form({
      date: D, plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), capacity: ''
    }, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM capacity_overrides`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
