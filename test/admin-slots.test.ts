import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';
import { getAvailability } from '../src/core/availability';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin slots matrix', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('マトリクスに定員入力と予約数が表示される', async () => {
    const res = await app.request('/admin/slots?from=2026-08-01', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('プランA');
    expect(html).toContain('value="6"');   // 基本定員
    expect(html).toContain('8/1');
    expect(html).toContain('from=2026-07-18'); // 前の14日
    expect(html).toContain('from=2026-08-15'); // 次の14日
  });

  it('backパラメータ付きの定員変更で予約枠ページに戻る', async () => {
    const res = await app.request('/admin/capacity', form({
      date: '2026-08-01', plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM),
      capacity: '3', back: '/admin/slots?from=2026-08-01'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/slots?from=2026-08-01&ok=capacity');
    const html = await (await app.request('/admin/slots?from=2026-08-01', { headers: { cookie } }, env)).text();
    expect(html).toContain('value="3"');
  });

  it('クローズ/解除がトグルできる', async () => {
    let res = await app.request('/admin/slots/close', form({
      date: '2026-08-02', plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), from: '2026-08-01'
    }, cookie), env);
    expect(res.status).toBe(302);
    let avail = await getAvailability(env.DB, '2026-08-02', '2026-08-02');
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.status).toBe('manual_closed');
    const html = await (await app.request('/admin/slots?from=2026-08-01', { headers: { cookie } }, env)).text();
    expect(html).toContain('/admin/slots/unclose');
    res = await app.request('/admin/slots/unclose', form({
      date: '2026-08-02', plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), from: '2026-08-01'
    }, cookie), env);
    expect(res.status).toBe(302);
    avail = await getAvailability(env.DB, '2026-08-02', '2026-08-02');
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.status).toBe('open');
  });

  it('未ログインは302', async () => {
    expect((await app.request('/admin/slots', {}, env)).status).toBe(302);
  });
});
