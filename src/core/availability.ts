import type { SlotAvailability, SlotStatus } from '../types';

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

export async function getAvailability(db: D1Database, from: string, to: string): Promise<SlotAvailability[]> {
  const [planSlots, closures, booked, planResources, overrides, slotTypes] = await Promise.all([
    db.prepare(
      `SELECT ps.plan_id AS planId, ps.slot_type_id AS slotTypeId, ps.capacity, p.duration_min AS durationMin
       FROM plan_slots ps JOIN plans p ON p.id = ps.plan_id
       WHERE ps.active = 1 AND p.active = 1`
    ).all<{ planId: number; slotTypeId: number; capacity: number; durationMin: number }>(),
    db.prepare(
      `SELECT date, slot_type_id AS slotTypeId, plan_id AS planId
       FROM slot_closures WHERE date BETWEEN ?1 AND ?2`
    ).bind(from, to).all<{ date: string; slotTypeId: number; planId: number | null }>(),
    db.prepare(
      `SELECT plan_id AS planId, date, slot_type_id AS slotTypeId, SUM(party_size) AS booked
       FROM bookings WHERE status IN ('requested', 'confirmed') AND date BETWEEN ?1 AND ?2
       GROUP BY plan_id, date, slot_type_id`
    ).bind(from, to).all<{ planId: number; date: string; slotTypeId: number; booked: number }>(),
    db.prepare(`SELECT plan_id AS planId, resource_id AS resourceId FROM plan_resources`)
      .all<{ planId: number; resourceId: number }>(),
    db.prepare(
      `SELECT date, plan_id AS planId, slot_type_id AS slotTypeId, capacity
       FROM capacity_overrides WHERE date BETWEEN ?1 AND ?2`
    ).bind(from, to).all<{ date: string; planId: number; slotTypeId: number; capacity: number }>(),
    db.prepare(`SELECT id, start_time FROM slot_types`).all<{ id: number; start_time: string }>()
  ]);

  const startMin = new Map<number, number>();
  for (const st of slotTypes.results) {
    startMin.set(st.id, toMinutes(st.start_time));
  }

  const durationByPlan = new Map<number, number>();
  for (const ps of planSlots.results) {
    durationByPlan.set(ps.planId, ps.durationMin);
  }

  const resourcesByPlan = new Map<number, number[]>();
  for (const pr of planResources.results) {
    const list = resourcesByPlan.get(pr.planId) ?? [];
    list.push(pr.resourceId);
    resourcesByPlan.set(pr.planId, list);
  }

  const bookedByPlanSlot = new Map<string, number>();
  const plansBookedInSlot = new Map<string, Array<{ planId: number; slotTypeId: number }>>();
  for (const b of booked.results) {
    bookedByPlanSlot.set(`${b.planId}|${b.date}|${b.slotTypeId}`, b.booked);
    const list = plansBookedInSlot.get(b.date) ?? [];
    list.push({ planId: b.planId, slotTypeId: b.slotTypeId });
    plansBookedInSlot.set(b.date, list);
  }

  const overrideByDatePlanSlot = new Map<string, number>();
  for (const o of overrides.results) {
    overrideByDatePlanSlot.set(`${o.date}|${o.planId}|${o.slotTypeId}`, o.capacity);
  }

  const globalClosures = new Set<string>();
  const planClosures = new Set<string>();
  for (const cl of closures.results) {
    if (cl.planId === null) globalClosures.add(`${cl.date}|${cl.slotTypeId}`);
    else planClosures.add(`${cl.date}|${cl.slotTypeId}|${cl.planId}`);
  }

  const out: SlotAvailability[] = [];
  for (const date of datesBetween(from, to)) {
    for (const ps of planSlots.results) {
      const bookedCount = bookedByPlanSlot.get(`${ps.planId}|${date}|${ps.slotTypeId}`) ?? 0;
      const cap = overrideByDatePlanSlot.get(`${date}|${ps.planId}|${ps.slotTypeId}`) ?? ps.capacity;
      let status: SlotStatus;
      let blockingPlanIds: number[] = [];

      if (globalClosures.has(`${date}|${ps.slotTypeId}`) || planClosures.has(`${date}|${ps.slotTypeId}|${ps.planId}`)) {
        status = 'manual_closed';
      } else {
        const myResources = new Set(resourcesByPlan.get(ps.planId) ?? []);
        const myStart = startMin.get(ps.slotTypeId) ?? 0;
        const myDur = ps.durationMin;
        const blockers = new Set<number>();
        for (const entry of plansBookedInSlot.get(date) ?? []) {
          if (entry.planId === ps.planId && entry.slotTypeId === ps.slotTypeId) continue;
          const shares = (resourcesByPlan.get(entry.planId) ?? []).some((r) => myResources.has(r));
          if (!shares) continue;
          const entryStart = startMin.get(entry.slotTypeId) ?? 0;
          const entryDur = durationByPlan.get(entry.planId) ?? 0;
          if (overlaps(myStart, myDur, entryStart, entryDur)) blockers.add(entry.planId);
        }
        if (blockers.size > 0) {
          status = 'linked_closed';
          blockingPlanIds = [...blockers].sort((a, b) => a - b);
        } else if (bookedCount >= cap) {
          status = 'full';
        } else {
          status = 'open';
        }
      }

      out.push({
        planId: ps.planId,
        date,
        slotTypeId: ps.slotTypeId,
        status,
        capacity: cap,
        booked: bookedCount,
        remaining: Math.max(0, cap - bookedCount),
        blockingPlanIds
      });
    }
  }
  return out;
}
