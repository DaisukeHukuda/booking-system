import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, SLOT_PM } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

describe('admin ledger', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
    await createBooking(env.DB, makeBooking({ customerName: '期間内の客', numAdults: 3 }));
    const c = await createBooking(env.DB, makeBooking({ slotTypeId: SLOT_PM, customerName: '取消の客' }));
    if (c.ok) await cancelBooking(env.DB, c.bookingId);
    await createBooking(env.DB, makeBooking({ date: '2026-10-01', customerName: '期間外の客' }));
  });

  it('期間指定で一覧とサマリー（件数・人数）が表示される', async () => {
    const html = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env)).text();
    expect(html).toContain('期間内の客');
    expect(html).not.toContain('期間外の客');
    expect(html).toContain('1件');
    expect(html).toContain('3名');
  });

  it('取消・否認は既定で非表示、include_cancelled=1で表示', async () => {
    const base = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env)).text();
    expect(base).not.toContain('取消の客');
    const all = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31&include_cancelled=1', { headers: { cookie } }, env)).text();
    expect(all).toContain('取消の客');
  });

  it('CSVエクスポートへのリンクが同じ期間で張られる', async () => {
    const html = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env)).text();
    expect(html).toContain('/admin/stats/export.csv?from=2026-08-01&amp;to=2026-08-31');
  });

  it('期間未指定は今日から30日間で200', async () => {
    expect((await app.request('/admin/ledger', { headers: { cookie } }, env)).status).toBe(200);
  });
});
