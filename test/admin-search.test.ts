import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_D, SLOT_PM } from './fixtures';
import { createBooking } from '../src/core/booking';

describe('admin search', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
    await createBooking(env.DB, makeBooking({ customerName: '山田花子', customerPhone: '090-1111-2222' }));
    await createBooking(env.DB, makeBooking({ planId: PLAN_D, date: '2026-09-10', customerName: '佐藤次郎', customerPhone: '080-3333-4444' }));
    await createBooking(env.DB, makeBooking({ slotTypeId: SLOT_PM, customerName: '鈴木リクエスト', status: 'requested' }));
  });

  it('検索条件なしはフォームのみ（結果なし）', async () => {
    const res = await app.request('/admin/search', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('検索');
    expect(html).not.toContain('山田花子');
  });

  it('氏名の部分一致で検索できる', async () => {
    const html = await (await app.request('/admin/search?q=山田', { headers: { cookie } }, env)).text();
    expect(html).toContain('山田花子');
    expect(html).not.toContain('佐藤次郎');
  });

  it('電話番号の部分一致で検索できる', async () => {
    const html = await (await app.request('/admin/search?q=3333', { headers: { cookie } }, env)).text();
    expect(html).toContain('佐藤次郎');
    expect(html).not.toContain('山田花子');
  });

  it('期間とプランで絞り込める', async () => {
    const html = await (await app.request('/admin/search?from=2026-09-01&to=2026-09-30', { headers: { cookie } }, env)).text();
    expect(html).toContain('佐藤次郎');
    expect(html).not.toContain('山田花子');
    const html2 = await (await app.request(`/admin/search?plan_id=${PLAN_A}`, { headers: { cookie } }, env)).text();
    expect(html2).toContain('山田花子');
    expect(html2).not.toContain('佐藤次郎');
  });

  it('状態で絞り込める', async () => {
    const html = await (await app.request('/admin/search?status=requested', { headers: { cookie } }, env)).text();
    expect(html).toContain('鈴木リクエスト');
    expect(html).not.toContain('山田花子');
  });
});
