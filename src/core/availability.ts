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

export async function getAvailability(db: D1Database, from: string, to: string): Promise<SlotAvailability[]> {
  const [planSlots, closures, booked, planResources] = await Promise.all([
    db.prepare(
      `SELECT ps.plan_id AS planId, ps.slot_type_id AS slotTypeId, ps.capacity
       FROM plan_slots ps JOIN plans p ON p.id = ps.plan_id
       WHERE ps.active = 1 AND p.active = 1`
    ).all<{ planId: number; slotTypeId: number; capacity: number }>(),
    db.prepare(
      `SELECT date, slot_type_id AS slotTypeId, plan_id AS planId
       FROM slot_closures WHERE date BETWEEN ?1 AND ?2`
    ).bind(from, to).all<{ date: string; slotTypeId: number; planId: number | null }>(),
    db.prepare(
      `SELECT plan_id AS planId, date, slot_type_id AS slotTypeId, SUM(party_size) AS booked
       FROM bookings WHERE status = 'confirmed' AND date BETWEEN ?1 AND ?2
       GROUP BY plan_id, date, slot_type_id`
    ).bind(from, to).all<{ planId: number; date: string; slotTypeId: number; booked: number }>(),
    db.prepare(`SELECT plan_id AS planId, resource_id AS resourceId FROM plan_resources`)
      .all<{ planId: number; resourceId: number }>()
  ]);

  const resourcesByPlan = new Map<number, number[]>();
  for (const pr of planResources.results) {
    const list = resourcesByPlan.get(pr.planId) ?? [];
    list.push(pr.resourceId);
    resourcesByPlan.set(pr.planId, list);
  }

  const bookedByPlanSlot = new Map<string, number>();
  const plansBookedInSlot = new Map<string, number[]>();
  for (const b of booked.results) {
    bookedByPlanSlot.set(`${b.planId}|${b.date}|${b.slotTypeId}`, b.booked);
    const key = `${b.date}|${b.slotTypeId}`;
    const list = plansBookedInSlot.get(key) ?? [];
    list.push(b.planId);
    plansBookedInSlot.set(key, list);
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
      let status: SlotStatus;
      let blockingPlanIds: number[] = [];

      if (globalClosures.has(`${date}|${ps.slotTypeId}`) || planClosures.has(`${date}|${ps.slotTypeId}|${ps.planId}`)) {
        status = 'manual_closed';
      } else {
        const myResources = new Set(resourcesByPlan.get(ps.planId) ?? []);
        const others = (plansBookedInSlot.get(`${date}|${ps.slotTypeId}`) ?? []).filter(
          (pid) => pid !== ps.planId && (resourcesByPlan.get(pid) ?? []).some((r) => myResources.has(r))
        );
        if (others.length > 0) {
          status = 'linked_closed';
          blockingPlanIds = others;
        } else if (bookedCount >= ps.capacity) {
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
        capacity: ps.capacity,
        booked: bookedCount,
        remaining: Math.max(0, ps.capacity - bookedCount),
        blockingPlanIds
      });
    }
  }
  return out;
}
