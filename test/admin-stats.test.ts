import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_D, SLOT_PM, AGENCY_1 } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

describe('admin stats', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
    // 2026-08: confirmed(A, 大人2, 16000円, 自社) / requested(A) / cancelled(D) / confirmed(A, 代理店, 大人1小人1, 12000円)
    await createBooking(env.DB, makeBooking({ customerName: '確定1' }));
    await createBooking(env.DB, makeBooking({ slotTypeId: SLOT_PM, customerName: '承認待ち', status: 'requested' }));
    const d = await createBooking(env.DB, makeBooking({ planId: PLAN_D, date: '2026-08-02', customerName: '取消済み' }));
    if (d.ok) await cancelBooking(env.DB, d.bookingId);
    await createBooking(env.DB, makeBooking({
      date: '2026-08-03', agencyId: AGENCY_1, createdBy: 'agency',
      numAdults: 1, numChildren: 1, totalAmount: 12000, customerName: '代理店経由'
    }));
    // 対象外の月
    await createBooking(env.DB, makeBooking({ date: '2026-09-01', customerName: '来月の客' }));
  });

  it('プラン別集計: confirmedのみ・指定月のみが集計される', async () => {
    const res = await app.request('/admin/stats?month=2026-08', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // プランA: 2件(確定1+代理店経由)・4名(2+2)・28000円
    expect(html).toContain('プランA');
    expect(html).toContain('2件');
    expect(html).toContain('4名');
    expect(html).toContain('28000円');
    // プランD はconfirmedなし → 行が出ない
    expect(html).not.toContain('プランD');
  });

  it('代理店別集計: 自社と代理店が分かれる', async () => {
    const res = await app.request('/admin/stats?month=2026-08', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('テスト代理店');
    expect(html).toContain('自社');
    expect(html).toContain('12000円'); // 代理店行の金額
    expect(html).toContain('16000円'); // 自社行の金額
  });

  it('month未指定は当月にフォールバックし200', async () => {
    const res = await app.request('/admin/stats', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
  });

  it('未ログインはリダイレクト', async () => {
    const res = await app.request('/admin/stats?month=2026-08', {}, env);
    expect(res.status).toBe(302);
  });
});
