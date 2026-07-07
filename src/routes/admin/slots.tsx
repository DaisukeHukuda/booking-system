import { Hono } from 'hono';
import { getAvailability } from '../../core/availability';
import type { Bindings, SlotAvailability } from '../../types';
import { Layout } from './ui';
import { todayJst } from './util';

export const slots = new Hono<{ Bindings: Bindings }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_SHOWN = 14;

const OK_MESSAGES: Record<string, string> = {
  capacity: '定員を更新しました',
  closed: 'クローズしました',
  unclosed: 'クローズを解除しました'
};

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function parsePositiveInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatMD(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

slots.get('/', async (c) => {
  const fromParam = c.req.query('from');
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : todayJst();
  const to = shiftDate(from, DAYS_SHOWN - 1);
  const okParam = c.req.query('ok');

  const dates: string[] = [];
  for (let i = 0; i < DAYS_SHOWN; i++) dates.push(shiftDate(from, i));

  const [availability, plansResult, slotTypesResult, planClosuresResult] = await Promise.all([
    getAvailability(c.env.DB, from, to),
    c.env.DB.prepare('SELECT id, name FROM plans WHERE active = 1 ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>(),
    c.env.DB.prepare('SELECT id, name, start_time FROM slot_types ORDER BY sort_order, id').all<{
      id: number;
      name: string;
      start_time: string;
    }>(),
    c.env.DB.prepare(
      `SELECT date, slot_type_id AS slotTypeId, plan_id AS planId
       FROM slot_closures WHERE date BETWEEN ?1 AND ?2 AND plan_id IS NOT NULL`
    ).bind(from, to).all<{ date: string; slotTypeId: number; planId: number }>()
  ]);

  const plans = plansResult.results;
  const slotTypes = slotTypesResult.results;

  const byPlanSlotDate = new Map<string, SlotAvailability>();
  const operatingCombos = new Set<string>();
  for (const av of availability) {
    byPlanSlotDate.set(`${av.planId}|${av.slotTypeId}|${av.date}`, av);
    operatingCombos.add(`${av.planId}|${av.slotTypeId}`);
  }

  const planClosureSet = new Set<string>();
  for (const cl of planClosuresResult.results) {
    planClosureSet.add(`${cl.date}|${cl.slotTypeId}|${cl.planId}`);
  }

  const prevFrom = shiftDate(from, -DAYS_SHOWN);
  const nextFrom = shiftDate(from, DAYS_SHOWN);
  const pageUrl = `/admin/slots?from=${from}`;

  return c.html(
    <Layout title="予約枠" active="/admin/slots">
      <div class="page-head">
        <span class="eyebrow">Slots</span>
        <h1>予約枠</h1>
        <span class="sub">
          {formatMD(from)} 〜 {formatMD(to)}
        </span>
      </div>
      <div class="cal-nav">
        <a class="btn" href={`/admin/slots?from=${prevFrom}`}>
          &laquo; 前の14日
        </a>
        <a class="btn" href={`/admin/slots?from=${nextFrom}`}>
          次の14日 &raquo;
        </a>
      </div>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}

      <div class="tbl-wrap">
        <table class="tbl grid14">
          <thead>
            <tr>
              <th>プラン / 時間帯</th>
              {dates.map((d) => {
                const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
                const dowClass = weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : '';
                return (
                  <th class={`day${dowClass}`}>
                    {formatMD(d)}
                    <span class="dow">{WEEKDAY_LABELS[weekday]}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {plans.map((p) =>
              slotTypes
                .filter((st) => operatingCombos.has(`${p.id}|${st.id}`))
                .map((st) => (
                  <tr>
                    <th class="plan-name">
                      {p.name}
                      <br />
                      <span class="time">{st.name}</span>
                    </th>
                    {dates.map((d) => {
                      const av = byPlanSlotDate.get(`${p.id}|${st.id}|${d}`);
                      if (!av) return <td class="slot-cell"></td>;
                      const isManualClosed = av.status === 'manual_closed';
                      const hasPlanClosure = planClosureSet.has(`${d}|${st.id}|${p.id}`);
                      return (
                        <td class={`slot-cell${isManualClosed ? ' off' : ''}`}>
                          <div class="slot-cell-inner">
                            <span class="n">{av.booked}名</span>
                            <form class="cap-form" method="post" action="/admin/capacity">
                              <input type="hidden" name="date" value={d} />
                              <input type="hidden" name="plan_id" value={p.id} />
                              <input type="hidden" name="slot_type_id" value={st.id} />
                              <input type="hidden" name="back" value={pageUrl} />
                              <input type="number" name="capacity" min="0" value={av.capacity} />
                              <button class="btn btn-sm" type="submit">
                                変更
                              </button>
                            </form>
                            {hasPlanClosure ? (
                              <form method="post" action="/admin/slots/unclose">
                                <input type="hidden" name="date" value={d} />
                                <input type="hidden" name="plan_id" value={p.id} />
                                <input type="hidden" name="slot_type_id" value={st.id} />
                                <input type="hidden" name="from" value={from} />
                                <button class="btn btn-sm" type="submit">
                                  解除
                                </button>
                              </form>
                            ) : (
                              !isManualClosed && (
                                <form method="post" action="/admin/slots/close">
                                  <input type="hidden" name="date" value={d} />
                                  <input type="hidden" name="plan_id" value={p.id} />
                                  <input type="hidden" name="slot_type_id" value={st.id} />
                                  <input type="hidden" name="from" value={from} />
                                  <button class="btn btn-sm" type="submit">
                                    休
                                  </button>
                                </form>
                              )
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

slots.post('/close', async (c) => {
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const from = typeof form.from === 'string' && DATE_RE.test(form.from) ? form.from : todayJst();

  if (!DATE_RE.test(date) || planId === null || slotTypeId === null) {
    return c.redirect(`/admin/slots?from=${from}&error=invalid`);
  }

  await c.env.DB.prepare(
    `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, ?, '予約枠ページから', ?)`
  ).bind(date, slotTypeId, planId, new Date().toISOString()).run();

  return c.redirect(`/admin/slots?from=${from}&ok=closed`);
});

slots.post('/unclose', async (c) => {
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const from = typeof form.from === 'string' && DATE_RE.test(form.from) ? form.from : todayJst();

  if (!DATE_RE.test(date) || planId === null || slotTypeId === null) {
    return c.redirect(`/admin/slots?from=${from}&error=invalid`);
  }

  await c.env.DB.prepare(
    `DELETE FROM slot_closures WHERE date = ? AND slot_type_id = ? AND plan_id = ?`
  ).bind(date, slotTypeId, planId).run();

  return c.redirect(`/admin/slots?from=${from}&ok=unclosed`);
});
