import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_C, SLOT_AM, SLOT_PM } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

const D = '2026-08-01';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

async function setup(): Promise<number> {
  const created = await createBooking(env.DB, makeBooking({ numAdults: 2 }));
  if (!created.ok) throw new Error('setup failed');
  return created.bookingId;
}

describe('admin booking edit', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('編集フォームに現在の値が表示される', async () => {
    const id = await setup();
    const res = await app.request(`/admin/bookings/${id}/edit`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト太郎');
    expect(html).toContain('value="2"');   // party_size
    expect(html).toContain(`value="${D}"`);
  });

  it('時間帯を変更でき、変更後の日のページへリダイレクトされる', async () => {
    const id = await setup();
    const res = await app.request(`/admin/bookings/${id}`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_PM), date: D,
      num_adults: '2', num_children: '0', total_amount: '16000',
      customer_name: '変更後の名前', customer_phone: '070-9999-8888', notes: 'メモ'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=changed`);
    const row = await env.DB.prepare(`SELECT slot_type_id, customer_name, customer_phone, notes FROM bookings WHERE id = ?`)
      .bind(id).first<{ slot_type_id: number; customer_name: string; customer_phone: string; notes: string }>();
    expect(row).toEqual({ slot_type_id: SLOT_PM, customer_name: '変更後の名前', customer_phone: '070-9999-8888', notes: 'メモ' });
  });

  it('リソース競合する変更は失敗し、編集画面に error=unavailable で戻る', async () => {
    const id = await setup();
    await createBooking(env.DB, makeBooking({ planId: PLAN_C, slotTypeId: SLOT_PM, customerName: '午後の先客' }));
    const res = await app.request(`/admin/bookings/${id}`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_PM), date: D,
      num_adults: '2', num_children: '0', total_amount: '16000',
      customer_name: 'テスト太郎', customer_phone: '090-0000-0000', notes: ''
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/bookings/${id}/edit?error=unavailable`);
    const row = await env.DB.prepare(`SELECT slot_type_id FROM bookings WHERE id = ?`).bind(id).first<{ slot_type_id: number }>();
    expect(row?.slot_type_id).toBe(SLOT_AM); // 無変更
  });

  it('キャンセル済み予約の編集画面は日別ページへリダイレクト', async () => {
    const id = await setup();
    await cancelBooking(env.DB, id);
    const res = await app.request(`/admin/bookings/${id}/edit`, { headers: { cookie } }, env);
    expect(res.status).toBe(302);
  });
});
