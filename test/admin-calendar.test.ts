import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, SLOT_AM } from './fixtures';
import { createBooking } from '../src/core/booking';

describe('admin calendar', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('月を指定してカレンダーが表示され、前後の月へのリンクがある', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=2026-08', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('2026年8月');
    expect(html).toContain('month=2026-07');
    expect(html).toContain('month=2026-09');
    expect(html).toContain('href="/admin/day/2026-08-01"');
    expect(html).toContain('href="/admin/day/2026-08-31"');
  });

  it('予約が入っている日に人数が表示される', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_A, numAdults: 3 }));
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=2026-08', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('3名');
  });

  it('手動クローズした時間帯は st-manual で表示される', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES ('2026-08-02', ?, NULL, '休業', '2026-07-07T00:00:00.000Z')`
    ).bind(SLOT_AM).run();
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=2026-08', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('s-manual');
  });

  it('month指定なしでも200で表示される（当月）', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('年');
  });

  it('不正なmonthは当月にフォールバックする', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=garbage', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
  });
});
