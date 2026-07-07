import type { BookingResult, NewBooking } from '../types';

function nowIso(): string {
  return new Date().toISOString();
}

// 予約可能条件（WHERE句の断片）。スペック4章の①〜④に対応。
// excludeBookingId は予約変更時に「自分自身の予約」を人数・リソース判定から除外するために使う。
function slotOpenCond(
  v: { planId: number; date: string; slotTypeId: number; partySize: number },
  excludeBookingId: number | null
): { sql: string; params: (string | number | null)[] } {
  const ex = excludeBookingId;
  return {
    sql: `
      EXISTS (SELECT 1 FROM plan_slots ps JOIN plans p ON p.id = ps.plan_id
              WHERE ps.plan_id = ? AND ps.slot_type_id = ? AND ps.active = 1 AND p.active = 1)
      AND NOT EXISTS (SELECT 1 FROM slot_closures sc
              WHERE sc.date = ? AND sc.slot_type_id = ? AND (sc.plan_id IS NULL OR sc.plan_id = ?))
      AND (SELECT COALESCE(SUM(b.party_size), 0) FROM bookings b
              WHERE b.plan_id = ? AND b.date = ? AND b.slot_type_id = ? AND b.status = 'confirmed'
                AND (? IS NULL OR b.id != ?)) + ?
          <= (SELECT ps.capacity FROM plan_slots ps WHERE ps.plan_id = ? AND ps.slot_type_id = ?)
      AND NOT EXISTS (SELECT 1 FROM bookings b
              JOIN plan_resources pr_o ON pr_o.plan_id = b.plan_id
              JOIN plan_resources pr_m ON pr_m.resource_id = pr_o.resource_id
              WHERE pr_m.plan_id = ? AND b.date = ? AND b.slot_type_id = ? AND b.status = 'confirmed'
                AND b.plan_id != ? AND (? IS NULL OR b.id != ?))`,
    params: [
      v.planId, v.slotTypeId,
      v.date, v.slotTypeId, v.planId,
      v.planId, v.date, v.slotTypeId, ex, ex, v.partySize, v.planId, v.slotTypeId,
      v.planId, v.date, v.slotTypeId, v.planId, ex, ex
    ]
  };
}

export async function createBooking(db: D1Database, nb: NewBooking): Promise<BookingResult> {
  const cond = slotOpenCond(nb, null);
  const res = await db.prepare(
    `INSERT INTO bookings (plan_id, date, slot_type_id, agency_id, status, customer_name, customer_phone,
                           party_size, total_amount, payment_method, payment_status, notes, created_by, created_at)
     SELECT ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?
     WHERE ${cond.sql}`
  ).bind(
    nb.planId, nb.date, nb.slotTypeId, nb.agencyId ?? null, nb.customerName, nb.customerPhone ?? '',
    nb.partySize, nb.totalAmount, nb.paymentMethod, nb.notes ?? '', nb.createdBy, nowIso(),
    ...cond.params
  ).run();

  if (res.meta.changes !== 1) return { ok: false, reason: 'slot_unavailable' };
  return { ok: true, bookingId: res.meta.last_row_id };
}

export interface BookingChange {
  planId: number;
  date: string;
  slotTypeId: number;
  partySize: number;
  totalAmount?: number;
  notes?: string;
}

// 変更後の枠の空き条件（自分自身を除外して評価）をWHERE句に含めた1文のUPDATE。
// 条件を満たさなければ meta.changes = 0 で元の行は無変更のまま残る。
export async function changeBooking(db: D1Database, bookingId: number, ch: BookingChange): Promise<BookingResult> {
  const cond = slotOpenCond(ch, bookingId);
  const res = await db.prepare(
    `UPDATE bookings
     SET plan_id = ?, date = ?, slot_type_id = ?, party_size = ?,
         total_amount = COALESCE(?, total_amount), notes = COALESCE(?, notes)
     WHERE id = ? AND status = 'confirmed' AND ${cond.sql}`
  ).bind(
    ch.planId, ch.date, ch.slotTypeId, ch.partySize,
    ch.totalAmount ?? null, ch.notes ?? null,
    bookingId, ...cond.params
  ).run();

  if (res.meta.changes !== 1) return { ok: false, reason: 'slot_unavailable' };
  return { ok: true, bookingId };
}

export async function cancelBooking(db: D1Database, bookingId: number): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'confirmed'`
  ).bind(nowIso(), bookingId).run();
  return res.meta.changes === 1;
}
