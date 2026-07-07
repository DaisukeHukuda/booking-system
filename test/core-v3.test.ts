import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBooking, getEffectivePrices } from '../src/core/booking';
import { getAvailability } from '../src/core/availability';
import { isBeforeDeadline } from '../src/core/deadline';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM } from './fixtures';

// 2026-08-01は土曜、2026-08-03は月曜
const SAT = '2026-08-01';
const MON = '2026-08-03';

describe('週末定員', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
    await env.DB.prepare(`UPDATE plan_slots SET capacity_weekend = 12 WHERE plan_id = ? AND slot_type_id = ?`)
      .bind(PLAN_B, SLOT_AM).run();
  });

  it('土曜は週末定員が効く（基本4→12）', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, date: SAT, numAdults: 10 }))).ok).toBe(true);
    const avail = await getAvailability(env.DB, SAT, SAT);
    const b = avail.find((a) => a.planId === PLAN_B && a.slotTypeId === SLOT_AM)!;
    expect(b.capacity).toBe(12);
    expect(b.remaining).toBe(2);
  });

  it('平日は基本定員のまま', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, date: MON, numAdults: 10 }))).ok).toBe(false);
    const avail = await getAvailability(env.DB, MON, MON);
    expect(avail.find((a) => a.planId === PLAN_B && a.slotTypeId === SLOT_AM)?.capacity).toBe(4);
  });

  it('日別上書きは週末定員より優先される', async () => {
    await env.DB.prepare(`INSERT INTO capacity_overrides (date, plan_id, slot_type_id, capacity) VALUES (?, ?, ?, 2)`)
      .bind(SAT, PLAN_B, SLOT_AM).run();
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, date: SAT, numAdults: 3 }))).ok).toBe(false);
  });

  it('capacity_weekend未設定のプランは土日も基本定員（回帰）', async () => {
    const avail = await getAvailability(env.DB, SAT, SAT);
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.capacity).toBe(6);
  });
});

describe('有効単価（料金カレンダー）', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('上書きがなければプラン単価', async () => {
    expect(await getEffectivePrices(env.DB, PLAN_A, SAT)).toEqual({ priceAdult: 8000, priceChild: 4000 });
  });

  it('上書きがあればその日だけ差し替わる', async () => {
    await env.DB.prepare(`INSERT INTO price_overrides (date, plan_id, price_adult, price_child) VALUES (?, ?, 9500, 5000)`)
      .bind(SAT, PLAN_A).run();
    expect(await getEffectivePrices(env.DB, PLAN_A, SAT)).toEqual({ priceAdult: 9500, priceChild: 5000 });
    expect(await getEffectivePrices(env.DB, PLAN_A, MON)).toEqual({ priceAdult: 8000, priceChild: 4000 });
  });

  it('存在しないプランはnull', async () => {
    expect(await getEffectivePrices(env.DB, 999, SAT)).toBeNull();
  });
});

describe('締切判定', () => {
  it('deadline_daysがnullなら常に予約可', () => {
    expect(isBeforeDeadline('2026-08-01', null, null, Date.parse('2026-08-01T23:00:00+09:00'))).toBe(true);
  });

  it('2日前18:00締切: 直前はNG・締切前はOK', () => {
    const d = '2026-08-10';
    expect(isBeforeDeadline(d, 2, '18:00', Date.parse('2026-08-08T17:59:00+09:00'))).toBe(true);
    expect(isBeforeDeadline(d, 2, '18:00', Date.parse('2026-08-08T18:01:00+09:00'))).toBe(false);
    expect(isBeforeDeadline(d, 2, '18:00', Date.parse('2026-08-09T10:00:00+09:00'))).toBe(false);
  });

  it('time省略時は23:59', () => {
    expect(isBeforeDeadline('2026-08-10', 0, null, Date.parse('2026-08-10T23:58:00+09:00'))).toBe(true);
    expect(isBeforeDeadline('2026-08-10', 0, null, Date.parse('2026-08-11T00:01:00+09:00'))).toBe(false);
  });
});
