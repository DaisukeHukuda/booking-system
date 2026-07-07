import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBooking, cancelBooking, approveBooking, denyBooking } from '../src/core/booking';
import { getAvailability } from '../src/core/availability';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, PLAN_D, SLOT_AM, SLOT_PM, SLOT_1030 } from './fixtures';

const D = '2026-08-01';

function slot(avail: Awaited<ReturnType<typeof getAvailability>>, planId: number, slotTypeId: number) {
  const found = avail.find((a) => a.planId === planId && a.date === D && a.slotTypeId === slotTypeId);
  if (!found) throw new Error(`slot not found: plan=${planId} slot=${slotTypeId}`);
  return found;
}

describe('時間の重なり連動', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('A@09:00(120分)の予約で、重なるB@10:30がクローズし、重ならないB@13:00は空きのまま', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: SLOT_AM }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_1030, customerName: '重なり客' }))).ok).toBe(false);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_PM, customerName: '午後の客' }))).ok).toBe(true);
  });

  it('A@13:00の予約は、B@10:30(〜12:30)と重ならないので両立できる', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: SLOT_PM }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_1030, customerName: '別件' }))).ok).toBe(true);
  });

  it('空き状況にも重なり連動が反映され、原因プランが分かる', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: SLOT_AM }));
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_B, SLOT_1030).status).toBe('linked_closed');
    expect(slot(avail, PLAN_B, SLOT_1030).blockingPlanIds).toEqual([PLAN_A]);
    expect(slot(avail, PLAN_B, SLOT_PM).status).toBe('open');
    expect(slot(avail, PLAN_D, SLOT_AM).status).toBe('open'); // リソース非共有
  });

  it('リソースを共有しないプランは時間が重なっても影響しない', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_D, slotTypeId: SLOT_AM }));
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_1030, customerName: '別件' }))).ok).toBe(true);
  });
});

describe('日別定員上書き', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  async function setOverride(planId: number, slotTypeId: number, capacity: number) {
    await env.DB.prepare(
      `INSERT INTO capacity_overrides (date, plan_id, slot_type_id, capacity) VALUES (?, ?, ?, ?)`
    ).bind(D, planId, slotTypeId, capacity).run();
  }

  it('上書き定員が基本定員より小さい場合、そちらが効く', async () => {
    await setOverride(PLAN_A, SLOT_AM, 2); // 基本6 → 2
    expect((await createBooking(env.DB, makeBooking({ numAdults: 2 }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ numAdults: 1, customerName: '超過客' }))).ok).toBe(false);
  });

  it('上書き定員が基本定員より大きい場合も、そちらが効く', async () => {
    await setOverride(PLAN_B, SLOT_AM, 10); // 基本4 → 10
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, numAdults: 5 }))).ok).toBe(true);
  });

  it('空き状況の capacity/remaining に上書きが反映される', async () => {
    await setOverride(PLAN_A, SLOT_AM, 2);
    const avail = await getAvailability(env.DB, D, D);
    const a = avail.find((x) => x.planId === PLAN_A && x.slotTypeId === SLOT_AM)!;
    expect(a.capacity).toBe(2);
    expect(a.remaining).toBe(2);
  });

  it('別の日には影響しない', async () => {
    await setOverride(PLAN_A, SLOT_AM, 2);
    expect((await createBooking(env.DB, makeBooking({ date: '2026-08-02', numAdults: 5 }))).ok).toBe(true);
  });
});

describe('リクエスト予約', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('requestedで登録でき、在庫を押さえる（連動・定員とも）', async () => {
    const req = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    expect(req.ok).toBe(true);
    // 連動: 同時間帯のBは不可
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }))).ok).toBe(false);
    // 定員: A残り4に5名は不可
    expect((await createBooking(env.DB, makeBooking({ numAdults: 5, customerName: '定員客' }))).ok).toBe(false);
    // 空き状況のbookedにも含まれる
    const avail = await getAvailability(env.DB, D, D);
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.booked).toBe(2);
  });

  it('承認すると confirmed になる。confirmed の再承認は false', async () => {
    const req = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    if (!req.ok) throw new Error('setup failed');
    expect(await approveBooking(env.DB, req.bookingId)).toBe(true);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(req.bookingId).first<{ status: string }>();
    expect(row?.status).toBe('confirmed');
    expect(await approveBooking(env.DB, req.bookingId)).toBe(false);
  });

  it('否認すると denied になり、枠が即座に戻る', async () => {
    const req = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    if (!req.ok) throw new Error('setup failed');
    expect(await denyBooking(env.DB, req.bookingId)).toBe(true);
    const row = await env.DB.prepare(`SELECT status, cancelled_at FROM bookings WHERE id = ?`).bind(req.bookingId).first<{ status: string; cancelled_at: string | null }>();
    expect(row?.status).toBe('denied');
    expect(row?.cancelled_at).not.toBeNull();
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }))).ok).toBe(true);
  });

  it('requested もキャンセルできる', async () => {
    const req = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    if (!req.ok) throw new Error('setup failed');
    expect(await cancelBooking(env.DB, req.bookingId)).toBe(true);
  });

  it('confirmed の否認は false', async () => {
    const c = await createBooking(env.DB, makeBooking());
    if (!c.ok) throw new Error('setup failed');
    expect(await denyBooking(env.DB, c.bookingId)).toBe(false);
  });
});
