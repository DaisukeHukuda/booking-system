import { Hono } from 'hono';
import { getAvailability } from '../../core/availability';
import { createBooking, cancelBooking } from '../../core/booking';
import type { Bindings, PaymentMethod, SlotAvailability } from '../../types';
import { Layout, STATUS_LABELS, STATUS_CLASSES, PAYMENT_LABELS } from './ui';

export const calendar = new Hono<{ Bindings: Bindings }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const OK_MESSAGES: Record<string, string> = {
  created: '予約を登録しました',
  cancelled: '予約をキャンセルしました',
  changed: '予約を変更しました'
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
  status: 'confirmed' | 'cancelled';
  customer_name: string;
  customer_phone: string;
  party_size: number;
  total_amount: number;
  payment_method: PaymentMethod;
  notes: string;
  created_by: string;
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

calendar.get('/', async (c) => {
  const monthParam = c.req.query('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentJstMonth();
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const lastDay = daysInMonth(year, monthNum);
  const from = `${month}-01`;
  const to = `${month}-${pad2(lastDay)}`;

  const [availability, slotTypesResult] = await Promise.all([
    getAvailability(c.env.DB, from, to),
    c.env.DB.prepare('SELECT id, name FROM slot_types ORDER BY sort_order, id').all<{
      id: number;
      name: string;
    }>()
  ]);
  const slotTypes = slotTypesResult.results;

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

  type Cell = { day: number; date: string } | null;
  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push({ day, date: `${month}-${pad2(day)}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  return c.html(
    <Layout title="予約台帳">
      <h1>
        {year}年{monthNum}月
      </h1>
      <p>
        <a href={`/admin?month=${prevMonth}`}>&laquo; 前月</a>{' '}
        <a href={`/admin?month=${nextMonth}`}>次月 &raquo;</a>
      </p>
      <table>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((w) => (
              <th>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr>
              {week.map((cell) => {
                if (!cell) return <td></td>;
                return (
                  <td>
                    <a href={`/admin/day/${cell.date}`}>{cell.day}</a>
                    {slotTypes.map((st) => {
                      const entries = bySlot.get(`${cell.date}|${st.id}`) ?? [];
                      let cls: string;
                      let symbol: string;
                      if (entries.length === 0) {
                        cls = 'st-manual';
                        symbol = '休';
                      } else if (entries.every((e) => e.status === 'manual_closed')) {
                        cls = 'st-manual';
                        symbol = '休';
                      } else if (entries.some((e) => e.status === 'open')) {
                        cls = 'st-open';
                        symbol = '空';
                      } else {
                        cls = 'st-full';
                        symbol = '満';
                      }
                      const totalBooked = entries.reduce((sum, e) => sum + e.booked, 0);
                      return (
                        <div class={cls}>
                          {st.name} {totalBooked > 0 ? `${totalBooked}名` : ''}
                          {symbol}
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
});

calendar.get('/day/:date', async (c) => {
  const date = c.req.param('date');
  if (!DATE_RE.test(date)) return c.redirect('/admin');

  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');
  const month = date.slice(0, 7);

  const [availability, slotTypesResult, plansResult, bookingsResult] = await Promise.all([
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
    ).bind(date).all<BookingRow>()
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

  return c.html(
    <Layout title={date}>
      <h1>{date}</h1>
      <p>
        <a href={`/admin?month=${month}`}>&laquo; カレンダーに戻る</a>
      </p>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <h2>空き状況</h2>
      <table>
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
              <td>{st.name}</td>
              {plans.map((p) => {
                const a = byPlanSlot.get(`${st.id}|${p.id}`);
                if (!a) return <td></td>;
                const label = STATUS_LABELS[a.status];
                const cls = STATUS_CLASSES[a.status];
                let extra = '';
                if (a.status === 'open') extra = ` 残${a.remaining}`;
                if (a.status === 'linked_closed') {
                  const names = a.blockingPlanIds.map((id) => planNameById.get(id) ?? '').join(',');
                  extra = `(${names})`;
                }
                return (
                  <td>
                    <span class={cls}>
                      {label}
                      {extra}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>予約一覧</h2>
      <table>
        <thead>
          <tr>
            <th>時間帯</th>
            <th>プラン</th>
            <th>顧客名</th>
            <th>電話</th>
            <th>人数</th>
            <th>金額</th>
            <th>支払方法</th>
            <th>代理店</th>
            <th>状態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr>
              <td>{b.slot_name}</td>
              <td>{b.plan_name}</td>
              <td>{b.customer_name}</td>
              <td>{b.customer_phone}</td>
              <td>{b.party_size}</td>
              <td>{b.total_amount}</td>
              <td>{PAYMENT_LABELS[b.payment_method]}</td>
              <td>{b.agency_name ?? '自社'}</td>
              <td>{b.status === 'confirmed' ? '確定' : '取消'}</td>
              <td>
                {b.status === 'confirmed' && (
                  <>
                    <a href={`/admin/bookings/${b.id}/edit`}>変更</a>{' '}
                    <form method="post" action={`/admin/bookings/${b.id}/cancel`}>
                      <input type="hidden" name="date" value={date} />
                      <button type="submit">キャンセル</button>
                    </form>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>新規予約登録</h2>
      <form method="post" action="/admin/bookings">
        <input type="hidden" name="date" value={date} />
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
              <option value={st.id}>{st.name}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          顧客名: <input type="text" name="customer_name" required />
        </label>{' '}
        <label>
          電話: <input type="text" name="customer_phone" />
        </label>{' '}
        <label>
          人数: <input type="number" name="party_size" min="1" value="1" />
        </label>{' '}
        <label>
          金額: <input type="number" name="total_amount" min="0" value="0" />
        </label>{' '}
        <label>
          支払方法:{' '}
          <select name="payment_method">
            {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
              <option value={key}>{label}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          備考: <textarea name="notes"></textarea>
        </label>{' '}
        <button type="submit">登録</button>
      </form>
    </Layout>
  );
});

calendar.post('/bookings', async (c) => {
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  if (!DATE_RE.test(date)) return c.redirect('/admin');

  const planId = parsePositiveInt(form.plan_id);
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const partySize = parsePositiveInt(form.party_size);
  const totalAmount = parseNonNegativeInt(form.total_amount);
  const customerName = typeof form.customer_name === 'string' ? form.customer_name.trim() : '';
  const paymentMethod = typeof form.payment_method === 'string' ? form.payment_method : '';
  const customerPhone = typeof form.customer_phone === 'string' ? form.customer_phone : '';
  const notes = typeof form.notes === 'string' ? form.notes : '';

  if (
    planId === null ||
    slotTypeId === null ||
    partySize === null ||
    totalAmount === null ||
    customerName === '' ||
    !(paymentMethod in PAYMENT_LABELS)
  ) {
    return c.redirect(`/admin/day/${date}?error=invalid`);
  }

  const result = await createBooking(c.env.DB, {
    planId,
    date,
    slotTypeId,
    customerName,
    customerPhone,
    partySize,
    totalAmount,
    paymentMethod: paymentMethod as PaymentMethod,
    notes,
    createdBy: 'admin'
  });

  if (!result.ok) return c.redirect(`/admin/day/${date}?error=unavailable`);
  return c.redirect(`/admin/day/${date}?ok=created`);
});

calendar.post('/bookings/:id/cancel', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  const form = await c.req.parseBody();
  const date = typeof form.date === 'string' ? form.date : '';
  if (!DATE_RE.test(date)) return c.redirect('/admin');

  if (id === null) return c.redirect(`/admin/day/${date}?error=invalid`);

  const ok = await cancelBooking(c.env.DB, id);
  return c.redirect(`/admin/day/${date}?${ok ? 'ok=cancelled' : 'error=invalid'}`);
});
