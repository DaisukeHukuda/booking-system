import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin price calendar', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('期間指定で日別単価を一括登録できる', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}/prices`, form({
      from: '2026-08-10', to: '2026-08-12', price_adult: '9500', price_child: '5000'
    }, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM price_overrides WHERE plan_id = ?`).bind(PLAN_A).first<{ n: number }>();
    expect(n?.n).toBe(3);
    const page = await (await app.request(`/admin/plans/${PLAN_A}/prices`, { headers: { cookie } }, env)).text();
    expect(page).toContain('2026-08-10');
    expect(page).toContain('9500');
  });

  it('同じ日への再登録は上書き（重複しない）', async () => {
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9500', price_child: '5000' }, cookie), env);
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9000', price_child: '4500' }, cookie), env);
    const rows = await env.DB.prepare(`SELECT price_adult FROM price_overrides WHERE plan_id = ? AND date = '2026-08-10'`).bind(PLAN_A).all<{ price_adult: number }>();
    expect(rows.results).toEqual([{ price_adult: 9000 }]);
  });

  it('削除できる', async () => {
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9500', price_child: '5000' }, cookie), env);
    const res = await app.request(`/admin/plans/${PLAN_A}/prices/delete`, form({ date: '2026-08-10' }, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM price_overrides`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('上書き日の予約は自動計算・スナップショットに反映される', async () => {
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9500', price_child: '5000' }, cookie), env);
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-10',
      customer_name: '特別料金の客', customer_phone: '', num_adults: '2', num_children: '1',
      total_amount: '', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    const row = await env.DB.prepare(`SELECT total_amount, price_adult FROM bookings WHERE customer_name = '特別料金の客'`)
      .first<{ total_amount: number; price_adult: number }>();
    expect(row).toEqual({ total_amount: 9500 * 2 + 5000, price_adult: 9500 });
  });

  it('30日超の期間は error=invalid', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}/prices`, form({
      from: '2026-08-01', to: '2026-10-01', price_adult: '9500', price_child: '5000'
    }, cookie), env);
    expect(res.headers.get('location')).toContain('error=invalid');
  });
});
