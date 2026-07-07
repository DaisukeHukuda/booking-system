import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBooking, cancelBooking } from '../src/core/booking';
import { getAvailability } from '../src/core/availability';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, PLAN_D, SLOT_AM, SLOT_PM, AGENCY_1, CAP_B } from './fixtures';

const D = '2026-08-01';

describe('createBooking', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('空き枠に予約でき、行がconfirmedで保存される', async () => {
    const result = await createBooking(env.DB, makeBooking());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(result.bookingId)
      .first<{ status: string; plan_id: number; party_size: number; payment_status: string }>();
    expect(row?.status).toBe('confirmed');
    expect(row?.plan_id).toBe(PLAN_A);
    expect(row?.party_size).toBe(2);
    expect(row?.payment_status).toBe('unpaid');
  });

  it('代理店予約: agency_id と created_by が保存される', async () => {
    const result = await createBooking(env.DB, makeBooking({ agencyId: AGENCY_1, createdBy: 'agency' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await env.DB.prepare(`SELECT agency_id, created_by FROM bookings WHERE id = ?`)
      .bind(result.bookingId).first<{ agency_id: number; created_by: string }>();
    expect(row).toEqual({ agency_id: AGENCY_1, created_by: 'agency' });
  });

  it('コース連動: プランAに予約後、同時間帯のプランBは予約不可', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(true);
    const result = await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }));
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
  });

  it('コース連動: リソースが違うプランD・別時間帯のプランBは予約可能', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_D }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_PM }))).ok).toBe(true);
  });

  it('同一プランへの追加予約は定員まで可能（相乗り）、超過は不可', async () => {
    // プランB定員4: 3名 + 1名 = OK、さらに1名は超過
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: 3 }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: 1 }))).ok).toBe(true);
    const over = await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: 1 }));
    expect(over).toEqual({ ok: false, reason: 'slot_unavailable' });
    const sum = await env.DB.prepare(
      `SELECT SUM(party_size) AS n FROM bookings WHERE plan_id = ? AND date = ? AND slot_type_id = ? AND status = 'confirmed'`
    ).bind(PLAN_B, D, SLOT_AM).first<{ n: number }>();
    expect(sum?.n).toBe(CAP_B); // 定員ちょうどで止まっている
  });

  it('1件で定員超過する人数は不可', async () => {
    const result = await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: CAP_B + 1 }));
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
  });

  it('手動クローズされた枠には予約不可', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, NULL, '休業', '2026-07-07T00:00:00.000Z')`
    ).bind(D, SLOT_AM).run();
    const result = await createBooking(env.DB, makeBooking());
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
  });

  it('無効化されたプラン・催行のない時間帯には予約不可', async () => {
    await env.DB.prepare(`UPDATE plans SET active = 0 WHERE id = ?`).bind(PLAN_A).run();
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(false);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: 99 }))).ok).toBe(false);
  });
});

describe('cancelBooking', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('キャンセルすると cancelled になり cancelled_at が記録される', async () => {
    const created = await createBooking(env.DB, makeBooking());
    if (!created.ok) throw new Error('setup failed');
    expect(await cancelBooking(env.DB, created.bookingId)).toBe(true);
    const row = await env.DB.prepare(`SELECT status, cancelled_at FROM bookings WHERE id = ?`)
      .bind(created.bookingId).first<{ status: string; cancelled_at: string | null }>();
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelled_at).not.toBeNull();
  });

  it('自動オープン: プランAの予約キャンセル後、連動クローズされていたプランBに予約できる', async () => {
    const created = await createBooking(env.DB, makeBooking({ planId: PLAN_A }));
    if (!created.ok) throw new Error('setup failed');
    // クローズ確認
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B }))).ok).toBe(false);
    // キャンセル → オープン
    await cancelBooking(env.DB, created.bookingId);
    const avail = await getAvailability(env.DB, D, D);
    expect(avail.find((a) => a.planId === PLAN_B && a.slotTypeId === SLOT_AM)?.status).toBe('open');
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B }))).ok).toBe(true);
  });

  it('二重キャンセルは false', async () => {
    const created = await createBooking(env.DB, makeBooking());
    if (!created.ok) throw new Error('setup failed');
    expect(await cancelBooking(env.DB, created.bookingId)).toBe(true);
    expect(await cancelBooking(env.DB, created.bookingId)).toBe(false);
  });

  it('存在しないIDは false', async () => {
    expect(await cancelBooking(env.DB, 9999)).toBe(false);
  });
});
