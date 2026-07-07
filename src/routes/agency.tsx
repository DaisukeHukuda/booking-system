import { Hono } from 'hono';
import type { Child } from 'hono/jsx';
import { getAvailability } from '../core/availability';
import { createBooking, cancelBookingForAgency } from '../core/booking';
import { sendBookingNotification } from '../core/notify';
import type { Bindings, PaymentMethod } from '../types';
import { BOOKING_STATUS_LABELS, BOOKING_BADGE_CLASSES } from './admin/ui';

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

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body class="agency">
        <div class="agency-hero">
          <div class="inner">
            <span class="eyebrow">Sup! Sup! — Lake SUP Tours</span>
            <div class="for">{props.agencyName}様専用 予約ページ</div>
            <h1>空き確認とご予約</h1>
          </div>
        </div>
        <main class="agency-page">{props.children}</main>
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
  const operatingCombos = new Set<string>();
  for (const av of availability) {
    byPlanSlotDate.set(`${av.planId}|${av.slotTypeId}|${av.date}`, av);
    operatingCombos.add(`${av.planId}|${av.slotTypeId}`);
  }

  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');

  return c.html(
    <AgencyLayout title={`${a.name}様専用 予約ページ`} agencyName={a.name}>
      <p class="agency-note">
        ご不明な点はお電話でも承ります。このページはブックマークしてご利用ください。
      </p>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <h2>
        空き状況（{formatMD(from)} 〜 {formatMD(to)}）
      </h2>
      <div class="cal-nav">
        <a class="btn" href={`/a/${token}?from=${prevFrom}`}>
          &laquo; 前の14日
        </a>
        <a class="btn" href={`/a/${token}?from=${nextFrom}`}>
          次の14日 &raquo;
        </a>
      </div>
      <div class="tbl-wrap">
        <table class="tbl grid14">
          <thead>
            <tr>
              <th>プラン / 出発時刻</th>
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
              slotTypes.filter((st) => operatingCombos.has(`${p.id}|${st.id}`)).map((st) => (
                <tr>
                  <th class="plan-name">
                    {p.name}
                    <br />
                    <span class="time">{st.start_time} 発</span>
                  </th>
                  {dates.map((d) => {
                    const av = byPlanSlotDate.get(`${p.id}|${st.id}|${d}`);
                    if (!av) return <td class="slot-cell"></td>;
                    let cellClass: string;
                    let symbol: string;
                    if (av.status === 'open') {
                      cellClass = av.remaining <= 2 ? 'last' : 'ok';
                      symbol = `残${av.remaining}`;
                    } else if (av.status === 'manual_closed') {
                      cellClass = 'off';
                      symbol = '休';
                    } else {
                      cellClass = 'ng';
                      symbol = '×';
                    }
                    return <td class={`slot-cell ${cellClass}`}>{symbol}</td>;
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div class="cal-legend">
        <span class="lg-open">
          <i></i>残席数 = ご予約可能
        </span>
        <span class="lg-linked">
          <i></i>残りわずか
        </span>
        <span class="lg-full">
          <i></i>× = 満席
        </span>
        <span class="lg-manual">
          <i></i>休 = 催行なし
        </span>
      </div>

      <h2>ご予約フォーム</h2>
      <form class="card card-pad" method="post" action={`/a/${token}/bookings`}>
        <div class="form-grid">
          <div class="field">
            <label>プラン</label>
            <select name="plan_id">
              {plans.map((p) => (
                <option value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>時間帯</label>
            <select name="slot_type_id">
              {slotTypes.map((st) => (
                <option value={st.id}>
                  {st.name}（{st.start_time}）
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>日付</label>
            <input type="date" name="date" min={today} max={maxDate} />
          </div>
          <div class="field">
            <label>大人</label>
            <input type="number" name="num_adults" min="0" value="1" />
          </div>
          <div class="field">
            <label>小人</label>
            <input type="number" name="num_children" min="0" value="0" />
          </div>
          <div class="field">
            <label>お客様のお名前</label>
            <input type="text" name="customer_name" required />
          </div>
          <div class="field">
            <label>電話</label>
            <input type="text" name="customer_phone" />
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div class="field" style="flex:1">
            <label>備考</label>
            <textarea name="notes"></textarea>
          </div>
          <button class="btn btn-primary btn-lg" type="submit">
            この内容で予約する
          </button>
        </div>
        {a.booking_mode === 'request' && (
          <p class="agency-note" style="margin:14px 0 0">
            このご予約はリクエスト制です。<strong>承認後に確定</strong>し、確定メールをお送りします。
          </p>
        )}
      </form>

      <h2>貴店のご予約一覧</h2>
      {ownBookings.length === 0 ? (
        <p>予約はまだありません</p>
      ) : (
        <div class="tbl-wrap tbl-cards">
          <table class="tbl">
            <thead>
              <tr>
                <th>参加日</th>
                <th>プラン / 時刻</th>
                <th>お客様</th>
                <th>人数</th>
                <th class="r">金額</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ownBookings.map((b) => {
                const muted = b.status === 'cancelled' || b.status === 'denied';
                return (
                  <tr class={muted ? 'row-muted' : undefined}>
                    <td data-label="参加日" class="num">
                      {b.date}
                    </td>
                    <td data-label="プラン">
                      {b.plan_name} {b.slot_name}
                    </td>
                    <td data-label="お客様">{b.customer_name}</td>
                    <td data-label="人数">
                      大{b.num_adults} 小{b.num_children}
                    </td>
                    <td data-label="金額" class="num r">
                      {b.total_amount}
                    </td>
                    <td data-label="状態">
                      <span class={`badge ${BOOKING_BADGE_CLASSES[b.status]}`}>{BOOKING_STATUS_LABELS[b.status]}</span>
                    </td>
                    <td data-label="" class="actions">
                      {(b.status === 'requested' || b.status === 'confirmed') && (
                        <form method="post" action={`/a/${token}/bookings/${b.id}/cancel`}>
                          <button class="btn btn-sm btn-danger" type="submit">
                            キャンセル
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
  await sendBookingNotification(c.env.DB, c.env, result.bookingId, status === 'requested' ? 'requested' : 'created');
  return c.redirect(`/a/${token}?${status === 'requested' ? 'ok=requested' : 'ok=created'}`);
});

agency.post('/:token/bookings/:id/cancel', async (c) => {
  const token = c.req.param('token');
  const a = await resolveAgency(c.env.DB, token);
  if (!a) return c.notFound();

  const id = parsePositiveInt(c.req.param('id'));
  const ok = id !== null && (await cancelBookingForAgency(c.env.DB, id, a.id));
  if (ok && id !== null) await sendBookingNotification(c.env.DB, c.env, id, 'cancelled');

  return c.redirect(`/a/${token}?${ok ? 'ok=cancelled' : 'error=invalid'}`);
});
