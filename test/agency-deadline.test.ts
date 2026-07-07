import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

const TOKEN = 'test-agency-token-0123456789abcdef';

function form(data: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  };
}

// 参加日の9999日前が締切 = 実質常に締切超過
async function setHugeDeadline() {
  await env.DB.prepare(
    `UPDATE plan_slots SET deadline_days = 9999, deadline_time = '18:00' WHERE plan_id = ? AND slot_type_id = ?`
  ).bind(PLAN_A, SLOT_AM).run();
}

describe('agency deadline', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('締切超過の枠は代理店から予約できない', async () => {
    await setHugeDeadline();
    const res = await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '締切後の客', customer_phone: '', num_adults: '1', num_children: '0', notes: ''
    }), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?error=deadline`);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('締切超過の枠は空き表で「締切」表示になる', async () => {
    await setHugeDeadline();
    const html = await (await app.request(`/a/${TOKEN}`, {}, env)).text();
    expect(html).toContain('締切');
  });

  it('締切設定がなければ従来どおり予約できる', async () => {
    const res = await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '通常の客', customer_phone: '', num_adults: '1', num_children: '0', notes: ''
    }), env);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?ok=requested`);
  });

  it('管理画面の手入力は締切後も可能（回帰）', async () => {
    await setHugeDeadline();
    const { adminCookie } = await import('./helpers');
    const cookie = await adminCookie();
    const res = await app.request('/admin/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
        customer_name: '電話の客', customer_phone: '', num_adults: '1', num_children: '0',
        total_amount: '0', payment_method: 'onsite_cash', notes: ''
      }).toString()
    }, env);
    expect(res.headers.get('location')).toBe('/admin/day/2026-08-01?ok=created');
  });
});
