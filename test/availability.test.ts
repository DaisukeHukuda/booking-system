import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getAvailability } from '../src/core/availability';
import { seedBasic, PLAN_A, PLAN_B, PLAN_C, PLAN_D, SLOT_AM, SLOT_PM, CAP_A } from './fixtures';

const D = '2026-08-01';

async function insertBooking(planId: number, date: string, slotTypeId: number, partySize: number, status = 'confirmed'): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO bookings (plan_id, date, slot_type_id, status, customer_name, party_size, created_by, created_at)
     VALUES (?, ?, ?, ?, 'テスト', ?, 'admin', '2026-07-07T00:00:00.000Z')`
  ).bind(planId, date, slotTypeId, status, partySize).run();
  return res.meta.last_row_id;
}

function slot(avail: Awaited<ReturnType<typeof getAvailability>>, planId: number, date: string, slotTypeId: number) {
  const found = avail.find((a) => a.planId === planId && a.date === date && a.slotTypeId === slotTypeId);
  if (!found) throw new Error(`slot not found: plan=${planId} ${date} slot=${slotTypeId}`);
  return found;
}

describe('getAvailability', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('予約なし: 全プラン・全時間帯が open で残席=定員', async () => {
    const avail = await getAvailability(env.DB, D, D);
    expect(avail).toHaveLength(9); // plan_slots 9行分
    const a = slot(avail, PLAN_A, D, SLOT_AM);
    expect(a.status).toBe('open');
    expect(a.remaining).toBe(CAP_A);
  });

  it('コース連動: プランAに予約1件で、同時間帯のB・Cが linked_closed になり原因プランが分かる', async () => {
    await insertBooking(PLAN_A, D, SLOT_AM, 2);
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_A, D, SLOT_AM).status).toBe('open'); // A自体は定員まで受付可
    expect(slot(avail, PLAN_A, D, SLOT_AM).remaining).toBe(CAP_A - 2);
    expect(slot(avail, PLAN_B, D, SLOT_AM).status).toBe('linked_closed');
    expect(slot(avail, PLAN_B, D, SLOT_AM).blockingPlanIds).toEqual([PLAN_A]);
    expect(slot(avail, PLAN_C, D, SLOT_AM).status).toBe('linked_closed');
    // リソースを共有しないプランDは影響なし
    expect(slot(avail, PLAN_D, D, SLOT_AM).status).toBe('open');
    // 午後便は影響なし
    expect(slot(avail, PLAN_B, D, SLOT_PM).status).toBe('open');
  });

  it('満席: 定員ちょうどまで予約が入ると full', async () => {
    await insertBooking(PLAN_A, D, SLOT_AM, CAP_A);
    const avail = await getAvailability(env.DB, D, D);
    const a = slot(avail, PLAN_A, D, SLOT_AM);
    expect(a.status).toBe('full');
    expect(a.remaining).toBe(0);
  });

  it('キャンセル済み予約は無視される（自動オープン）', async () => {
    const id = await insertBooking(PLAN_A, D, SLOT_AM, 2);
    await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = '2026-07-07T01:00:00.000Z' WHERE id = ?`).bind(id).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_B, D, SLOT_AM).status).toBe('open');
    expect(slot(avail, PLAN_A, D, SLOT_AM).remaining).toBe(CAP_A);
  });

  it('全プラン向け手動クローズ（plan_id = NULL）で対象時間帯の全プランが manual_closed', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, NULL, '休業', '2026-07-07T00:00:00.000Z')`
    ).bind(D, SLOT_AM).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_A, D, SLOT_AM).status).toBe('manual_closed');
    expect(slot(avail, PLAN_D, D, SLOT_AM).status).toBe('manual_closed');
    expect(slot(avail, PLAN_A, D, SLOT_PM).status).toBe('open');
  });

  it('プラン指定の手動クローズは対象プランのみ manual_closed', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, ?, 'メンテ', '2026-07-07T00:00:00.000Z')`
    ).bind(D, SLOT_AM, PLAN_A).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_A, D, SLOT_AM).status).toBe('manual_closed');
    expect(slot(avail, PLAN_B, D, SLOT_AM).status).toBe('open');
  });

  it('無効化されたプランは結果に含まれない', async () => {
    await env.DB.prepare(`UPDATE plans SET active = 0 WHERE id = ?`).bind(PLAN_D).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(avail.filter((a) => a.planId === PLAN_D)).toHaveLength(0);
  });

  it('日付範囲: 3日分を要求すると日数分の結果が返る', async () => {
    const avail = await getAvailability(env.DB, '2026-08-01', '2026-08-03');
    expect(avail).toHaveLength(9 * 3);
  });
});
