import { Hono } from 'hono';
import { getAvailability } from '../../core/availability';
import { createBooking, cancelBooking, changeBooking, approveBooking, denyBooking, getEffectivePrices } from '../../core/booking';
import { sendBookingNotification } from '../../core/notify';
import type { Bindings, BookingStatus, PaymentMethod, SlotAvailability } from '../../types';
import {
  Layout,
  STATUS_LABELS,
  STATUS_CELL_CLASSES,
  BOOKING_STATUS_LABELS,
  BOOKING_BADGE_CLASSES,
  PAYMENT_LABELS
} from './ui';
import { resolveBack, todayJst } from './util';

export const calendar = new Hono<{ Bindings: Bindings }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const OK_MESSAGES: Record<string, string> = {
  created: '予約を登録しました',
  cancelled: '予約をキャンセルしました',
  changed: '予約を変更しました',
  approved: '承認しました',
  denied: '否認しました',
  capacity: '定員を更新しました',
  requested: 'リクエストとして登録しました'
};

const ERROR_MESSAGES: Record<string, string> = {
  unavailable: 'この枠は直前に埋まりました',
  invalid: '入力内容に誤りがあります'
};

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

interface BookingRow {
  id: number;
  plan_id: number;
  date: string;
  slot_type_id: number;
  agency_id: number | null;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  num_adults: number;
  num_children: number;
  price_adult: number;
  price_child: number;
  total_amount: number;
  payment_method: PaymentMethod;
  notes: string;
  created_by: string;
  created_at: string;
  plan_name: string;
  slot_name: string;
  agency_name: string | null;
}

function currentJstMonth(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
}

function daysInMonth(year: number, month: number): number {
  // month is 1-indexed; day 0 of next month = last day of this month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { year: y, month: m };
}

function formatStartTime(startTime: string): string {
  return startTime.startsWith('0') ? startTime.slice(1) : startTime;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${y}年${m}月${d}日（${weekday}）`;
}

function formatMD(date: string): string {
  const [, m, d] = date.split('-');
  const weekday = WEEKDAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(m)}/${Number(d)}（${weekday}）`;
}

calendar.get('/', async (c) => {
  const monthParam = c.req.query('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentJstMonth();
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const lastDay = daysInMonth(year, monthNum);
  const from = `${month}-01`;
  const to = `${month}-${pad2(lastDay)}`;
  const today = todayJst();

  const [availability, slotTypesResult, emailErrorResult] = await Promise.all([
    getAvailability(c.env.DB, from, to),
    c.env.DB.prepare('SELECT id, name, start_time FROM slot_types ORDER BY sort_order, id').all<{
      id: number;
      name: string;
      start_time: string;
    }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM email_log WHERE status = 'error'`).first<{ n: number }>()
  ]);
  const slotTypes = slotTypesResult.results;
  const emailErrorCount = emailErrorResult?.n ?? 0;

  // date|slotTypeId -> availability entries
  const bySlot = new Map<string, SlotAvailability[]>();
  for (const a of availability) {
    const key = `${a.date}|${a.slotTypeId}`;
    const list = bySlot.get(key) ?? [];
    list.push(a);
    bySlot.set(key, list);
  }

  const prev = shiftMonth(year, monthNum, -1);
  const next = shiftMonth(year, monthNum, 1);
  const prevMonth = `${prev.year}-${pad2(prev.month)}`;
  const nextMonth = `${next.year}-${pad2(next.month)}`;

  const firstDate = new Date(Date.UTC(year, monthNum - 1, 1));
  const firstWeekday = firstDate.getUTCDay(); // 0 = Sunday

  type Cell = { day: number; date: string; weekday: number } | null;
  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= lastDay; day++) {
    const date = `${month}-${pad2(day)}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    cells.push({ day, date, weekday });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return c.html(
    <Layout title="予約台帳" active="/admin">
      {emailErrorCount >= 1 && (
        <div class="banner-warn">メール送信エラーが{emailErrorCount}件あります（email_logを確認してください）</div>
      )}
      <div class="page-head">
        <span class="eyebrow">Ledger / {month}</span>
        <h1>
          {year}年{monthNum}月 予約台帳
        </h1>
        <span class="sub">タップで日別詳細へ</span>
      </div>
      <div class="cal-nav">
        <a class="btn" href={`/admin?month=${prevMonth}`}>
          &laquo; 前月
        </a>
        <a class="btn" href={`/admin?month=${nextMonth}`}>
          次月 &raquo;
        </a>
        <span class="spacer"></span>
        <a class="btn btn-primary" href={`/admin/day/${today}`}>
          今日の予約へ
        </a>
      </div>
      <div class="cal">
        {WEEKDAY_LABELS.map((w, i) => (
          <div class={`cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{w}</div>
        ))}
        {cells.map((cell) => {
          if (!cell) return <div class="cal-cell is-empty"></div>;
          const isSun = cell.weekday === 0;
          const isSat = cell.weekday === 6;
          const isToday = cell.date === today;
          return (
            <a
              class={`cal-cell${isToday ? ' is-today' : ''}`}
              href={`/admin/day/${cell.date}`}
            >
              <div class={`cal-daynum${isSun ? ' sun' : isSat ? ' sat' : ''}`}>
                {cell.day}
                <span class="dow-inline">({WEEKDAY_LABELS[cell.weekday]})</span>
                {isToday && <span class="today-label">TODAY</span>}
              </div>
              <div class="cal-slots">
                {slotTypes.map((st) => {
                  const entries = bySlot.get(`${cell.date}|${st.id}`) ?? [];
                  const totalBooked = entries.reduce((sum, e) => sum + e.booked, 0);
                  let cls: string;
                  let n: string;
                  if (entries.length === 0 || entries.every((e) => e.status === 'manual_closed')) {
                    cls = 's-manual';
                    n = '–';
                  } else if (entries.some((e) => e.status === 'open')) {
                    cls = 's-open';
                    n = `${totalBooked}名`;
                  } else if (entries.some((e) => e.status === 'linked_closed')) {
                    cls = 's-linked';
                    n = totalBooked > 0 ? `${totalBooked}名` : '–';
                  } else {
                    cls = 's-full';
                    n = `${totalBooked}名`;
                  }
                  return (
                    <div class={`cal-slot ${cls}`}>
                      <i class="dot"></i>
                      <span class="t">{formatStartTime(st.start_time)}</span>
                      <span class="n">{n}</span>
                    </div>
                  );
                })}
              </div>
            </a>
          );
        })}
      </div>
      <div class="cal-legend">
        <span class="lg-open">
          <i></i>空きあり
        </span>
        <span class="lg-full">
          <i></i>満席
        </span>
        <span class="lg-linked">
          <i></i>連動クローズ
        </span>
        <span class="lg-manual">
          <i></i>手動クローズ
        </span>
      </div>
    </Layout>
  );
});

calendar.get('/day/:date', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.redirect('/admin');

  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');
  const month = date.slice(0, 7);

  const [availability, slotTypesResult, plansResult, bookingsResult, capacityOverridesResult] = await Promise.all([
    getAvailability(c.env.DB, date, date),
    c.env.DB.prepare('SELECT id, name FROM slot_types ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>(),
    c.env.DB.prepare('SELECT id, name FROM plans WHERE active = 1 ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>(),
    c.env.DB.prepare(
      `SELECT b.*, p.name AS plan_name, st.name AS slot_name, a.name AS agency_name
       FROM bookings b
       JOIN plans p ON p.id = b.plan_id
       JOIN slot_types st ON st.id = b.slot_type_id
       LEFT JOIN agencies a ON a.id = b.agency_id
       WHERE b.date = ?
       ORDER BY st.sort_order, b.created_at`
    ).bind(date).all<BookingRow>(),
    c.env.DB.prepare('SELECT plan_id, slot_type_id, capacity FROM capacity_overrides WHERE date = ?')
      .bind(date)
      .all<{ plan_id: number; slot_type_id: number; capacity: number }>()
  ]);

  const slotTypes = slotTypesResult.results;
  const plans = plansResult.results;
  const bookings = bookingsResult.results;

  const planNameById = new Map<number, string>();
  for (const p of plans) planNameById.set(p.id, p.name);

  const byPlanSlot = new Map<string, SlotAvailability>();
  for (const a of availability) {
    byPlanSlot.set(`${a.slotTypeId}|${a.planId}`, a);
  }

  const capacityOverrideByPlanSlot = new Map<string, number>();
  for (const row of capacityOverridesResult.results) {
    capacityOverrideByPlanSlot.set(`${row.slot_type_id}|${row.plan_id}`, row.capacity);
  }

  const prevDate = shiftDate(date, -1);
  const nextDate = shiftDate(date, 1);
  const totalPax = bookings
    .filter((b) => b.status === 'confirmed' || b.status === 'requested')
    .reduce((sum, b) => sum + b.party_size, 0);
  const activeCount = bookings.filter((b) => b.status === 'confirmed' || b.status === 'requested').length;

  return c.html(
    <Layout title={date} active="/admin">
      <div class="page-head">
        <span class="eyebrow">Day / {date}</span>
        <h1>{formatDateLong(date)}</h1>
        <span class="sub">
          <a href={`/admin?month=${month}`}>&laquo; 台帳へ戻る</a>
        </span>
      </div>
      <div class="cal-nav">
        <a class="btn" href={`/admin/day/${prevDate}`}>
          &laquo; {formatMD(prevDate)}
        </a>
        <a class="btn" href={`/admin/day/${nextDate}`}>
          {formatMD(nextDate)} &raquo;
        </a>
      </div>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <h2>空き状況</h2>
      <div class="tbl-wrap">
        <table class="tbl avail">
          <thead>
            <tr>
              <th>時間帯</th>
              {plans.map((p) => (
                <th>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slotTypes.map((st) => (
              <tr>
                <th class="nowrap">{st.name}</th>
                {plans.map((p) => {
                  const a = byPlanSlot.get(`${st.id}|${p.id}`);
                  if (!a) return <td></td>;
                  const label = STATUS_LABELS[a.status];
                  const cellClass = STATUS_CELL_CLASSES[a.status];
                  const overrideCapacity = capacityOverrideByPlanSlot.get(`${st.id}|${p.id}`);
                  return (
                    <td>
                      <span class={`cell ${cellClass}`}>
                        <span class="state">{label}</span>
                        {a.status === 'open' && <span class="zan">残{a.remaining}</span>}
                        {a.status === 'full' && (
                          <span class="zan">
                            {a.booked}/{a.capacity}
                          </span>
                        )}
                        {a.status === 'linked_closed' && (
                          <span class="why">
                            原因: {a.blockingPlanIds.map((id) => planNameById.get(id) ?? '').join(',')}
                          </span>
                        )}
                        <form class="cap-form" method="post" action="/admin/capacity">
                          <input type="hidden" name="date" value={date} />
                          <input type="hidden" name="plan_id" value={p.id} />
                          <input type="hidden" name="slot_type_id" value={st.id} />
                          <label class="small">定員</label>
                          <input
                            type="number"
                            name="capacity"
                            min="0"
                            value={overrideCapacity !== undefined ? overrideCapacity : ''}
                          />
                          <button class="btn" type="submit">
                            変更
                          </button>
                        </form>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>
        予約一覧{' '}
        <span class="muted small">
          {activeCount}件・{totalPax}名
        </span>
      </h2>
      <div class="tbl-wrap tbl-cards">
        <table class="tbl">
          <thead>
            <tr>
              <th>時間帯</th>
              <th>プラン</th>
              <th>顧客</th>
              <th>電話</th>
              <th>人数</th>
              <th class="r">金額</th>
              <th>支払</th>
              <th>経路</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const muted = b.status === 'cancelled' || b.status === 'denied';
              return (
                <tr class={muted ? 'row-muted' : undefined}>
                  <td data-label="時間帯" class="num">
                    {b.slot_name}
                  </td>
                  <td data-label="プラン">{b.plan_name}</td>
                  <td data-label="顧客">{b.customer_name}</td>
                  <td data-label="電話" class="num">
                    {b.customer_phone}
                  </td>
                  <td data-label="人数">
                    大{b.num_adults} 小{b.num_children}
                  </td>
                  <td data-label="金額" class="num r">
                    {b.total_amount}
                  </td>
                  <td data-label="支払">{PAYMENT_LABELS[b.payment_method]}</td>
                  <td data-label="経路">{b.agency_name ?? '自社'}</td>
                  <td data-label="状態">
                    <span class={`badge ${BOOKING_BADGE_CLASSES[b.status]}`}>{BOOKING_STATUS_LABELS[b.status]}</span>
                  </td>
                  <td data-label="" class="actions">
                    {b.status === 'confirmed' && (
                      <>
                        <a class="btn btn-sm" href={`/admin/bookings/${b.id}/edit`}>
                          変更
                        </a>{' '}
                        <form method="post" action={`/admin/bookings/${b.id}/cancel`}>
                          <input type="hidden" name="date" value={date} />
                          <button class="btn btn-sm btn-danger" type="submit">
                            キャンセル
                          </button>
                        </form>
                      </>
                    )}
                    {b.status === 'requested' && (
                      <>
                        <form method="post" action={`/admin/bookings/${b.id}/approve`}>
                          <input type="hidden" name="back" value={`/admin/day/${date}`} />
                          <button class="btn btn-sm btn-ok" type="submit">
                            承認
                          </button>
                        </form>{' '}
                        <form method="post" action={`/admin/bookings/${b.id}/deny`}>
                          <input type="hidden" name="back" value={`/admin/day/${date}`} />
                          <button class="btn btn-sm btn-danger" type="submit">
                            否認
                          </button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>新規予約登録</h2>
      <form class="card card-pad" method="post" action="/admin/bookings">
        <input type="hidden" name="date" value={date} />
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
                <option value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>顧客名</label>
            <input type="text" name="customer_name" required />
          </div>
          <div class="field">
            <label>電話</label>
            <input type="text" name="customer_phone" />
          </div>
          <div class="field">
            <label>大人人数</label>
            <input type="number" name="num_adults" min="0" value="1" />
          </div>
          <div class="field">
            <label>小人人数</label>
            <input type="number" name="num_children" min="0" value="0" />
          </div>
          <div class="field">
            <label>
              金額 <span class="hint">空欄でプラン単価から自動計算</span>
            </label>
            <input type="number" name="total_amount" min="0" />
          </div>
          <div class="field">
            <label>支払方法</label>
            <select name="payment_method">
              {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                <option value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div class="field" style="flex:1">
            <label>備考</label>
            <textarea name="notes"></textarea>
          </div>
          <button class="btn btn-primary btn-lg" type="submit">
            登録
          </button>
        </div>
      </form>
    </Layout>
  );
});

calendar.get('/requests', async (c) => {
  const okParam = c.req.query('ok');

  const requestsResult = await c.env.DB.prepare(
    `SELECT b.*, p.name AS plan_name, st.name AS slot_name, a.name AS agency_name
     FROM bookings b
     JOIN plans p ON p.id = b.plan_id
     JOIN slot_types st ON st.id = b.slot_type_id
     LEFT JOIN agencies a ON a.id = b.agency_id
     WHERE b.status = 'requested'
     ORDER BY b.date, st.sort_order, b.created_at`
  ).all<BookingRow>();
  const requests = requestsResult.results;

  return c.html(
    <Layout title="承認待ち" active="/admin/requests">
      <div class="page-head">
        <span class="eyebrow">Requests</span>
        <h1>
          承認待ち <span class="num">{requests.length}</span>件
        </h1>
        <span class="sub">リクエスト予約は承認するまで席を確保しません</span>
      </div>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}

      {requests.length === 0 ? (
        <p>承認待ちはありません</p>
      ) : (
        <div class="tbl-wrap tbl-cards">
          <table class="tbl">
            <thead>
              <tr>
                <th>受付日時</th>
                <th>利用日 / 時間帯</th>
                <th>プラン</th>
                <th>顧客</th>
                <th>人数</th>
                <th class="r">金額</th>
                <th>経路</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((b) => (
                <tr>
                  <td data-label="受付日時" class="num">
                    {b.created_at}
                  </td>
                  <td data-label="利用日">
                    <a href={`/admin/day/${b.date}`}>{b.date}</a> {b.slot_name}
                  </td>
                  <td data-label="プラン">{b.plan_name}</td>
                  <td data-label="顧客">{b.customer_name}</td>
                  <td data-label="人数">
                    大{b.num_adults} 小{b.num_children}
                  </td>
                  <td data-label="金額" class="num r">
                    {b.total_amount}
                  </td>
                  <td data-label="経路">{b.agency_name ?? '自社'}</td>
                  <td data-label="" class="actions">
                    <form method="post" action={`/admin/bookings/${b.id}/approve`}>
                      <input type="hidden" name="back" value="/admin/requests" />
                      <button class="btn btn-sm btn-ok" type="submit">
                        承認
                      </button>
                    </form>{' '}
                    <form method="post" action={`/admin/bookings/${b.id}/deny`}>
                      <input type="hidden" name="back" value="/admin/requests" />
                      <button class="btn btn-sm btn-danger" type="submit">
                        否認
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
});

calendar.post('/bookings', async (c) => {
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  if (!DATE_RE.test(date)) return c.redirect('/admin');

  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const numAdults = parseNonNegativeInt(form.num_adults);
  const numChildren = parseNonNegativeInt(form.num_children);
  const totalAmountRaw = typeof form.total_amount === 'string' ? form.total_amount.trim() : '';
  const totalAmountInput = totalAmountRaw === '' ? null : parseNonNegativeInt(form.total_amount);
  const customerName = typeof form.customer_name === 'string' ? form.customer_name.trim() : '';
  const paymentMethod = typeof form.payment_method === 'string' ? form.payment_method : '';
  const customerPhone = typeof form.customer_phone === 'string' ? form.customer_phone : '';
  const notes = typeof form.notes === 'string' ? form.notes : '';

  if (
    planId === null ||
    slotTypeId === null ||
    numAdults === null ||
    numChildren === null ||
    numAdults + numChildren < 1 ||
    (totalAmountRaw !== '' && totalAmountInput === null) ||
    customerName === '' ||
    !(paymentMethod in PAYMENT_LABELS)
  ) {
    return c.redirect(`/admin/day/${date}?error=invalid`);
  }

  const plan = await getEffectivePrices(c.env.DB, planId, date);
  if (!plan) return c.redirect(`/admin/day/${date}?error=invalid`);

  const totalAmount = totalAmountInput ?? numAdults * plan.priceAdult + numChildren * plan.priceChild;
  const asRequest = form.as_request === '1';

  const result = await createBooking(c.env.DB, {
    planId,
    date,
    slotTypeId,
    customerName,
    customerPhone,
    numAdults,
    numChildren,
    priceAdult: plan.priceAdult,
    priceChild: plan.priceChild,
    totalAmount,
    paymentMethod: paymentMethod as PaymentMethod,
    notes,
    createdBy: 'admin',
    ...(asRequest ? { status: 'requested' as const } : {})
  });

  if (!result.ok) return c.redirect(`/admin/day/${date}?error=unavailable`);
  await sendBookingNotification(c.env.DB, c.env, result.bookingId, asRequest ? 'requested' : 'created');
  return c.redirect(`/admin/day/${date}?ok=${asRequest ? 'requested' : 'created'}`);
});

calendar.post('/bookings/:id/cancel', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  if (!DATE_RE.test(date)) return c.redirect('/admin');

  if (id === null) return c.redirect(`/admin/day/${date}?error=invalid`);

  const ok = await cancelBooking(c.env.DB, id);
  if (ok) await sendBookingNotification(c.env.DB, c.env, id, 'cancelled');
  return c.redirect(`/admin/day/${date}?${ok ? 'ok=cancelled' : 'error=invalid'}`);
});

calendar.post('/bookings/:id/approve', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  const form = await c.req.parseBody();
  const back = resolveBack(form.back, '/admin/requests');

  const ok = id !== null && (await approveBooking(c.env.DB, id));
  if (ok && id !== null) await sendBookingNotification(c.env.DB, c.env, id, 'approved');
  return c.redirect(`${back}?${ok ? 'ok=approved' : 'error=invalid'}`);
});

calendar.post('/bookings/:id/deny', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  const form = await c.req.parseBody();
  const back = resolveBack(form.back, '/admin/requests');

  const ok = id !== null && (await denyBooking(c.env.DB, id));
  if (ok && id !== null) await sendBookingNotification(c.env.DB, c.env, id, 'denied');
  return c.redirect(`${back}?${ok ? 'ok=denied' : 'error=invalid'}`);
});

calendar.post('/capacity', async (c) => {
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const capacityRaw = typeof form.capacity === 'string' ? form.capacity.trim() : '';
  const back = resolveBack(form.back, `/admin/day/${date}`);
  const okSuffix = back.includes('?') ? '&ok=capacity' : '?ok=capacity';

  if (!DATE_RE.test(date) || planId === null || slotTypeId === null) {
    return c.redirect('/admin');
  }

  if (capacityRaw === '') {
    await c.env.DB.prepare(
      `DELETE FROM capacity_overrides WHERE date = ? AND plan_id = ? AND slot_type_id = ?`
    ).bind(date, planId, slotTypeId).run();
    return c.redirect(`${back}${okSuffix}`);
  }

  const capacity = parseNonNegativeInt(capacityRaw);
  if (capacity === null) return c.redirect(`/admin/day/${date}?error=invalid`);

  await c.env.DB.prepare(
    `INSERT INTO capacity_overrides (date, plan_id, slot_type_id, capacity) VALUES (?, ?, ?, ?)
     ON CONFLICT(date, plan_id, slot_type_id) DO UPDATE SET capacity = excluded.capacity`
  ).bind(date, planId, slotTypeId, capacity).run();

  return c.redirect(`${back}${okSuffix}`);
});

calendar.get('/bookings/:id/edit', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin');

  const [booking, slotTypesResult, plansResult] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first<BookingRow>(),
    c.env.DB.prepare('SELECT id, name FROM slot_types ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>(),
    c.env.DB.prepare('SELECT id, name FROM plans WHERE active = 1 ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>()
  ]);

  if (!booking || booking.status !== 'confirmed') return c.redirect('/admin');

  const slotTypes = slotTypesResult.results;
  const plans = plansResult.results;
  const errorParam = c.req.query('error');

  return c.html(
    <Layout title="予約変更" active="/admin">
      <div class="page-head">
        <span class="eyebrow">Booking / Edit</span>
        <h1>予約変更</h1>
        <span class="sub">
          <a href={`/admin/day/${booking.date}`}>&laquo; {booking.date} に戻る</a>
        </span>
      </div>
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}
      <form class="card card-pad" method="post" action={`/admin/bookings/${booking.id}`}>
        <div class="form-grid">
          <div class="field">
            <label>日付</label>
            <input type="date" name="date" value={booking.date} />
          </div>
          <div class="field">
            <label>プラン</label>
            <select name="plan_id">
              {plans.map((p) => (
                <option value={p.id} selected={p.id === booking.plan_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>時間帯</label>
            <select name="slot_type_id">
              {slotTypes.map((st) => (
                <option value={st.id} selected={st.id === booking.slot_type_id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>顧客名</label>
            <input type="text" name="customer_name" value={booking.customer_name} required />
          </div>
          <div class="field">
            <label>電話</label>
            <input type="text" name="customer_phone" value={booking.customer_phone} />
          </div>
          <div class="field">
            <label>大人人数</label>
            <input type="number" name="num_adults" min="0" value={booking.num_adults} />
          </div>
          <div class="field">
            <label>小人人数</label>
            <input type="number" name="num_children" min="0" value={booking.num_children} />
          </div>
          <div class="field">
            <label>
              金額 <span class="hint">空欄でプラン単価から自動計算</span>
            </label>
            <input type="number" name="total_amount" min="0" value={booking.total_amount} />
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div class="field" style="flex:1">
            <label>備考</label>
            <textarea name="notes">{booking.notes}</textarea>
          </div>
          <button class="btn btn-primary btn-lg" type="submit">
            変更を保存
          </button>
        </div>
      </form>
    </Layout>
  );
});

calendar.post('/bookings/:id', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin');

  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const numAdults = parseNonNegativeInt(form.num_adults);
  const numChildren = parseNonNegativeInt(form.num_children);
  const totalAmountRaw = typeof form.total_amount === 'string' ? form.total_amount.trim() : '';
  const totalAmountInput = totalAmountRaw === '' ? null : parseNonNegativeInt(form.total_amount);
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
    (totalAmountRaw !== '' && totalAmountInput === null) ||
    customerName === ''
  ) {
    return c.redirect(`/admin/bookings/${id}/edit?error=invalid`);
  }

  let totalAmount = totalAmountInput;
  if (totalAmount === null) {
    const existing = await c.env.DB.prepare('SELECT price_adult, price_child FROM bookings WHERE id = ?')
      .bind(id)
      .first<{ price_adult: number; price_child: number }>();
    if (!existing) return c.redirect(`/admin/bookings/${id}/edit?error=invalid`);
    totalAmount = numAdults * existing.price_adult + numChildren * existing.price_child;
  }

  const result = await changeBooking(c.env.DB, id, {
    planId,
    date,
    slotTypeId,
    numAdults,
    numChildren,
    totalAmount,
    notes
  });

  if (!result.ok) return c.redirect(`/admin/bookings/${id}/edit?error=unavailable`);

  // 予約変更（このエンドポイント）はメール通知を送らない: 管理画面からの日付・人数・金額の
  // 微調整は他の操作より頻度が高く、都度通知するとノイズになるため対象外とする。

  // 連絡先（氏名・電話）は在庫判定に影響しないため、changeBooking のアトミックUPDATEとは
  // 別に更新してよい。
  await c.env.DB.prepare(`UPDATE bookings SET customer_name = ?, customer_phone = ? WHERE id = ?`)
    .bind(customerName, customerPhone, id)
    .run();

  return c.redirect(`/admin/day/${date}?ok=changed`);
});
