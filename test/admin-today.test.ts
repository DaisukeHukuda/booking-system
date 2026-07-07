import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, SLOT_PM } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

describe('admin today roster', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('本日の予約が時間帯見出しの下に表示され、取消は出ない', async () => {
    const d = todayJst();
    await createBooking(env.DB, makeBooking({ date: d, customerName: '本日の客', customerPhone: '090-8888-9999' }));
    const c = await createBooking(env.DB, makeBooking({ date: d, slotTypeId: SLOT_PM, customerName: '本日取消' }));
    if (c.ok) await cancelBooking(env.DB, c.bookingId);
    const html = await (await app.request('/admin/today', { headers: { cookie } }, env)).text();
    expect(html).toContain('本日の客');
    expect(html).toContain('090-8888-9999');
    expect(html).toContain('午前便');
    expect(html).not.toContain('本日取消');
  });

  it('予約ゼロの日は空メッセージ', async () => {
    const html = await (await app.request('/admin/today', { headers: { cookie } }, env)).text();
    expect(html).toContain('本日の予約はありません');
  });

  it('日別詳細へのリンクがある', async () => {
    const html = await (await app.request('/admin/today', { headers: { cookie } }, env)).text();
    expect(html).toContain(`/admin/day/${todayJst()}`);
  });
});
