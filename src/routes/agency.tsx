import { Hono } from 'hono';
import type { Child } from 'hono/jsx';
import { getAvailability } from '../core/availability';
import { createBooking, cancelBookingForAgency } from '../core/booking';
import type { Bindings, PaymentMethod } from '../types';
import { BOOKING_STATUS_LABELS } from './admin/ui';

export const agency = new Hono<{ Bindings: Bindings }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_SHOWN = 14;
const MAX_FUTURE_DAYS = 60;

const OK_MESSAGES: Record<string, string> = {
  created: '予約を登録しました',
  requested: '予約リクエストを送信しました。承認後に確定します',
  cancelled: 'キャンセルしました'
};

const ERROR_MESSAGES: Record<string, string> = {
  unavailable: 'この枠は直前に埋まりました',
  invalid: '入力内容に誤りがあります'
};

const PAGE_STYLE = `
  body { font-family: sans-serif; margin: 0; padding: 0; }
  header { background: #f4f4f4; border-bottom: 1px solid #ccc; padding: 0.5rem 1rem; }
  main { padding: 1rem; }
  table { border-collapse: collapse; margin-bottom: 1rem; }
  table th, table td { border: 1px solid #ccc; padding: 0.25rem 0.5rem; text-align: center; }
  .msg-ok { color: green; }
  .msg-error { color: red; }
  .note { color: #7f5a00; }
`;

interface AgencyRow {
  id: number;
  name: string;
  token: string;
  email: string | null;
  booking_mode: 'realtime' | 'request';
  active: number;
  notes: string;
}

interface AgencyBookingRow {
  id: number;
  date: string;
  slot_type_id: number;
  status: 'requested' | 'confirmed' | 'cancelled' | 'denied';
  customer_name: string;
  num_adults: number;
  num_children: number;
  total_amount: number;
  plan_name: string;
  slot_name: string;
  start_time: string;
}

function AgencyLayout(props: { title: string; agencyName: string; children: Child }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{PAGE_STYLE}</style>
      </head>
      <body>
        <header>
          <strong>{props.agencyName}様専用 予約ページ</strong>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

function currentJstDate(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function formatMD(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function parsePositiveInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseNonNegativeInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function resolveAgency(db: D1Database, token: string): Promise<AgencyRow | null> {
  return db.prepare('SELECT * FROM agencies WHERE token = ? AND active = 1').bind(token).first<AgencyRow>();
}

agency.get('/:token', async (c) => {
  const token = c.req.param('token');
  const a = await resolveAgency(c.env.DB, token);
  if (!a) return c.notFound();

  const today = currentJstDate();
  const maxDate = addDays(today, MAX_FUTURE_DAYS);
  const fromParam = c.req.query('from');
  const from = clampDate(fromParam && DATE_RE.test(fromParam) ? fromParam : today, today, maxDate);
  const to = addDays(from, DAYS_SHOWN - 1);

  const prevFrom = clampDate(addDays(from, -DAYS_SHOWN), today, maxDate);
  const nextFrom = clampDate(addDays(from, DAYS_SHOWN), today, maxDate);

  const dates: string[] = [];
  for (let i = 0; i < DAYS_SHOWN; i++) dates.push(addDays(from, i));

  const [availability, plansResult, slotTypesResult, ownBookingsResult] = await Promise.all([
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
      `SELECT b.*, p.name AS plan_name, st.name AS slot_name, st.start_time
       FROM bookings b
       JOIN plans p ON p.id = b.plan_id
       JOIN slot_types st ON st.id = b.slot_type_id
       WHERE b.agency_id = ?
       ORDER BY b.date DESC, b.id DESC`
    ).bind(a.id).all<AgencyBookingRow>()
  ]);

  const plans = plansResult.results;
  const slotTypes = slotTypesResult.results;
  const ownBookings = ownBookingsResult.results;

  const byPlanSlotDate = new Map<string, (typeof availability)[number]>();
  for (const av of availability) {
    byPlanSlotDate.set(`${av.planId}|${av.slotTypeId}|${av.date}`, av);
  }

  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');

  return c.html(
    <AgencyLayout title={`${a.name}様専用 予約ページ`} agencyName={a.name}>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <h2>空き状況（{formatMD(from)} 〜 {formatMD(to)}）</h2>
      <p>
        <a href={`/a/${token}?from=${prevFrom}`}>&laquo; 前の14日</a>{' '}
        <a href={`/a/${token}?from=${nextFrom}`}>次の14日 &raquo;</a>
      </p>
      <table>
        <thead>
          <tr>
            <th>プラン</th>
            <th>時刻</th>
            {dates.map((d) => (
              <th>{formatMD(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plans.map((p) =>
            slotTypes.map((st) => (
              <tr>
                <td>{p.name}</td>
                <td>{st.name}</td>
                {dates.map((d) => {
                  const av = byPlanSlotDate.get(`${p.id}|${st.id}|${d}`);
                  if (!av) return <td></td>;
                  let symbol: string;
                  if (av.status === 'open') symbol = String(av.remaining);
                  else if (av.status === 'manual_closed') symbol = '休';
                  else symbol = '×';
                  return <td>{symbol}</td>;
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2>予約</h2>
      {a.booking_mode === 'request' && (
        <p class="note">※ご予約はリクエストとして送信され、承認後に確定します</p>
      )}
      <form method="post" action={`/a/${token}/bookings`}>
        <label>
          プラン:{' '}
          <select name="plan_id">
            {plans.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          時間帯:{' '}
          <select name="slot_type_id">
            {slotTypes.map((st) => (
              <option value={st.id}>{st.name}（{st.start_time}）</option>
            ))}
          </select>
        </label>{' '}
        <label>
          日付: <input type="date" name="date" min={today} max={maxDate} />
        </label>{' '}
        <label>
          大人人数: <input type="number" name="num_adults" min="0" value="1" />
        </label>{' '}
        <label>
          小人人数: <input type="number" name="num_children" min="0" value="0" />
        </label>{' '}
        <label>
          お客様名: <input type="text" name="customer_name" required />
        </label>{' '}
        <label>
          電話: <input type="text" name="customer_phone" />
        </label>{' '}
        <label>
          備考: <textarea name="notes"></textarea>
        </label>{' '}
        <button type="submit">予約する</button>
      </form>

      <h2>自店の予約</h2>
      {ownBookings.length === 0 ? (
        <p>予約はまだありません</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>参加日</th>
              <th>時刻</th>
              <th>プラン</th>
              <th>顧客名</th>
              <th>人数</th>
              <th>金額</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ownBookings.map((b) => (
              <tr>
                <td>{b.date}</td>
                <td>{b.slot_name}</td>
                <td>{b.plan_name}</td>
                <td>{b.customer_name}</td>
                <td>大{b.num_adults}小{b.num_children}</td>
                <td>{b.total_amount}</td>
                <td>{BOOKING_STATUS_LABELS[b.status]}</td>
                <td>
                  {(b.status === 'requested' || b.status === 'confirmed') && (
                    <form method="post" action={`/a/${token}/bookings/${b.id}/cancel`}>
                      <button type="submit">キャンセル</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AgencyLayout>
  );
});

agency.post('/:token/bookings', async (c) => {
  const token = c.req.param('token');
  const a = await resolveAgency(c.env.DB, token);
  if (!a) return c.notFound();

  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const numAdults = parseNonNegativeInt(form.num_adults);
  const numChildren = parseNonNegativeInt(form.num_children);
  const customerName = typeof form.customer_name === 'string' ? form.customer_name.trim() : '';
  const customerPhone = typeof form.customer_phone === 'string' ? form.customer_phone : '';
  const notes = typeof form.notes === 'string' ? form.notes : '';

  if (
    !DATE_RE.test(date) ||
    planId === null ||
    slotTypeId === null ||
    numAdults === null ||
    numChildren === null ||
    numAdults + numChildren < 1 ||
    customerName === ''
  ) {
    return c.redirect(`/a/${token}?error=invalid`);
  }

  const plan = await c.env.DB.prepare('SELECT price_adult, price_child FROM plans WHERE id = ?')
    .bind(planId)
    .first<{ price_adult: number; price_child: number }>();
  if (!plan) return c.redirect(`/a/${token}?error=invalid`);

  const totalAmount = numAdults * plan.price_adult + numChildren * plan.price_child;
  const status = a.booking_mode === 'request' ? 'requested' : 'confirmed';

  const result = await createBooking(c.env.DB, {
    planId,
    date,
    slotTypeId,
    agencyId: a.id,
    customerName,
    customerPhone,
    numAdults,
    numChildren,
    priceAdult: plan.price_adult,
    priceChild: plan.price_child,
    totalAmount,
    paymentMethod: 'invoice' as PaymentMethod,
    notes,
    createdBy: 'agency',
    status
  });

  if (!result.ok) return c.redirect(`/a/${token}?error=unavailable`);
  return c.redirect(`/a/${token}?${status === 'requested' ? 'ok=requested' : 'ok=created'}`);
});

agency.post('/:token/bookings/:id/cancel', async (c) => {
  const token = c.req.param('token');
  const a = await resolveAgency(c.env.DB, token);
  if (!a) return c.notFound();

  const id = parsePositiveInt(c.req.param('id'));
  const ok = id !== null && (await cancelBookingForAgency(c.env.DB, id, a.id));

  return c.redirect(`/a/${token}?${ok ? 'ok=cancelled' : 'error=invalid'}`);
});
