import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, AGENCY_1, SLOT_PM } from './fixtures';
import { createBooking } from '../src/core/booking';

describe('admin CSV export', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('未ログインはリダイレクト', async () => {
    const res = await app.request('/admin/stats/export.csv?from=2026-08-01&to=2026-08-31', {}, env);
    expect(res.status).toBe(302);
  });

  it('CSVにヘッダ行・BOM・予約データが含まれる', async () => {
    await createBooking(env.DB, makeBooking({ agencyId: AGENCY_1, createdBy: 'agency', notes: '送迎希望' }));
    const res = await app.request('/admin/stats/export.csv?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('reservations_2026-08-01_2026-08-31.csv');
    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = body.slice(1).split('\r\n').filter((l) => l);
    expect(lines[0]).toBe('予約ID,参加日,開始時刻,時間帯,プラン,顧客名,電話,大人,小人,合計人数,大人単価,小人単価,金額,支払方法,支払状況,経路,状態,申込日時,備考');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('2026-08-01');
    expect(lines[1]).toContain('プランA');
    expect(lines[1]).toContain('テスト太郎');
    expect(lines[1]).toContain('テスト代理店');
    expect(lines[1]).toContain('現地現金');
    expect(lines[1]).toContain('確定');
    expect(lines[1]).toContain('送迎希望');
  });

  it('期間でフィルタされ、キャンセル済みも状態付きで含まれる', async () => {
    await createBooking(env.DB, makeBooking({ customerName: '期間内' }));
    await createBooking(env.DB, makeBooking({ date: '2026-08-20', slotTypeId: SLOT_PM, customerName: '期間外' }));
    const res = await app.request('/admin/stats/export.csv?from=2026-08-01&to=2026-08-10', { headers: { cookie } }, env);
    const body = await res.text();
    expect(body).toContain('期間内');
    expect(body).not.toContain('期間外');
  });

  it('カンマ・引用符を含む値はエスケープされる', async () => {
    await createBooking(env.DB, makeBooking({ customerName: '山田,"太郎"', notes: '複数\n行' }));
    const res = await app.request('/admin/stats/export.csv?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env);
    const body = await res.text();
    expect(body).toContain('"山田,""太郎"""');
  });

  it('不正な期間は集計ページへ戻す', async () => {
    const res = await app.request('/admin/stats/export.csv?from=bad&to=2026-08-31', { headers: { cookie } }, env);
    expect(res.status).toBe(302);
  });
});
