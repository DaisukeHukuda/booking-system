import { Hono } from 'hono';
import type { Bindings, BookingStatus, PaymentMethod } from '../../types';
import { Layout, BOOKING_STATUS_LABELS, BOOKING_BADGE_CLASSES, PAYMENT_LABELS } from './ui';
import { todayJst } from './util';

export const lists = new Hono<{ Bindings: Bindings }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface SearchRow {
  id: number;
  plan_id: number;
  date: string;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string;
  num_adults: number;
  num_children: number;
  total_amount: number;
  payment_method: PaymentMethod;
  plan_name: string;
  slot_name: string;
  agency_name: string | null;
}

function parsePositiveInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

lists.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const planIdParam = c.req.query('plan_id') ?? '';
  const statusParam = c.req.query('status') ?? '';

  const hasSearch = q !== '' || from !== '' || to !== '' || planIdParam !== '' || statusParam !== '';

  const planId = parsePositiveInt(planIdParam);
  const status = statusParam !== '' && statusParam in BOOKING_STATUS_LABELS ? (statusParam as BookingStatus) : null;

  let rows: SearchRow[] = [];
  if (hasSearch) {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q !== '') {
      conditions.push('(b.customer_name LIKE ? OR b.customer_phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (DATE_RE.test(from)) {
      conditions.push('b.date >= ?');
      params.push(from);
    }
    if (DATE_RE.test(to)) {
      conditions.push('b.date <= ?');
      params.push(to);
    }
    if (planId !== null) {
      conditions.push('b.plan_id = ?');
      params.push(planId);
    }
    if (status !== null) {
      conditions.push('b.status = ?');
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await c.env.DB.prepare(
      `SELECT b.*, p.name AS plan_name, st.name AS slot_name, a.name AS agency_name
       FROM bookings b
       JOIN plans p ON p.id = b.plan_id
       JOIN slot_types st ON st.id = b.slot_type_id
       LEFT JOIN agencies a ON a.id = b.agency_id
       ${where}
       ORDER BY b.date DESC, b.id DESC
       LIMIT 200`
    ).bind(...params).all<SearchRow>();
    rows = result.results;
  }

  const plansResult = await c.env.DB.prepare('SELECT id, name FROM plans WHERE active = 1 ORDER BY sort_order, id').all<{
    id: number;
    name: string;
  }>();
  const plans = plansResult.results;

  return c.html(
    <Layout title="予約検索" active="/admin/search">
      <div class="page-head">
        <span class="eyebrow">Search</span>
        <h1>予約検索</h1>
      </div>
      <form class="card card-pad" method="get" action="/admin/search">
        <div class="form-grid">
          <div class="field">
            <label>氏名・電話</label>
            <input type="text" name="q" value={q} placeholder="氏名または電話番号の一部" />
          </div>
          <div class="field">
            <label>期間（から）</label>
            <input type="date" name="from" value={from} />
          </div>
          <div class="field">
            <label>期間（まで）</label>
            <input type="date" name="to" value={to} />
          </div>
          <div class="field">
            <label>プラン</label>
            <select name="plan_id">
              <option value="">すべて</option>
              {plans.map((p) => (
                <option value={p.id} selected={planId === p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label>状態</label>
            <select name="status">
              <option value="">すべて</option>
              {Object.entries(BOOKING_STATUS_LABELS).map(([key, label]) => (
                <option value={key} selected={status === key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <button class="btn btn-primary btn-lg" type="submit">
            検索
          </button>
        </div>
      </form>

      {hasSearch &&
        (rows.length === 0 ? (
          <p>該当する予約がありません</p>
        ) : (
          <div class="tbl-wrap tbl-cards">
            <table class="tbl">
              <thead>
                <tr>
                  <th>参加日</th>
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
                {rows.map((b) => {
                  const muted = b.status === 'cancelled' || b.status === 'denied';
                  return (
                    <tr class={muted ? 'row-muted' : undefined}>
                      <td data-label="参加日">
                        <a href={`/admin/day/${b.date}`}>{b.date}</a>
                      </td>
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
                          <a class="btn btn-sm" href={`/admin/bookings/${b.id}/edit`}>
                            変更
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </Layout>
  );
});

interface LedgerRow {
  id: number;
  plan_id: number;
  date: string;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string;
  num_adults: number;
  num_children: number;
  total_amount: number;
  payment_method: PaymentMethod;
  plan_name: string;
  slot_name: string;
  agency_name: string | null;
}

interface TodayRow {
  id: number;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string;
  num_adults: number;
  num_children: number;
  notes: string;
  plan_name: string;
  slot_type_id: number;
  slot_name: string;
  slot_start_time: string;
  agency_name: string | null;
}

function addDaysJst(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

lists.get('/ledger', async (c) => {
  const fromParam = c.req.query('from') ?? '';
  const toParam = c.req.query('to') ?? '';
  const includeCancelled = c.req.query('include_cancelled') === '1';

  const from = DATE_RE.test(fromParam) ? fromParam : todayJst();
  const to = DATE_RE.test(toParam) ? toParam : addDaysJst(from, 30);

  const statusFilter = includeCancelled ? '' : `AND b.status IN ('confirmed', 'requested')`;

  const result = await c.env.DB.prepare(
    `SELECT b.*, p.name AS plan_name, st.name AS slot_name, a.name AS agency_name
     FROM bookings b
     JOIN plans p ON p.id = b.plan_id
     JOIN slot_types st ON st.id = b.slot_type_id
     LEFT JOIN agencies a ON a.id = b.agency_id
     WHERE b.date BETWEEN ? AND ?
     ${statusFilter}
     ORDER BY b.date ASC, st.sort_order ASC, b.id ASC`
  ).bind(from, to).all<LedgerRow>();
  const rows = result.results;

  const summary = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(num_adults + num_children), 0) AS people, COALESCE(SUM(total_amount), 0) AS amount
     FROM bookings
     WHERE date BETWEEN ? AND ? AND status IN ('confirmed', 'requested')`
  ).bind(from, to).first<{ cnt: number; people: number; amount: number }>();

  return c.html(
    <Layout title="予約台帳" active="/admin/ledger">
      <div class="page-head">
        <span class="eyebrow">Ledger List</span>
        <h1>予約台帳</h1>
      </div>
      <form class="card card-pad" method="get" action="/admin/ledger">
        <div class="form-grid">
          <div class="field">
            <label>期間（から）</label>
            <input type="date" name="from" value={from} />
          </div>
          <div class="field">
            <label>期間（まで）</label>
            <input type="date" name="to" value={to} />
          </div>
          <div class="field">
            <label>
              <input type="checkbox" name="include_cancelled" value="1" checked={includeCancelled} /> 取消・否認も表示
            </label>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <button class="btn btn-primary btn-lg" type="submit">
            表示
          </button>
          <a class="btn btn-sm" href={`/admin/stats/export.csv?from=${from}&to=${to}`}>
            CSVダウンロード
          </a>
        </div>
      </form>

      <p>
        {summary?.cnt ?? 0}件・{summary?.people ?? 0}名・{summary?.amount ?? 0}円
      </p>

      {rows.length === 0 ? (
        <p>該当する予約がありません</p>
      ) : (
        <div class="tbl-wrap tbl-cards">
          <table class="tbl">
            <thead>
              <tr>
                <th>参加日</th>
                <th>時間帯</th>
                <th>プラン</th>
                <th>顧客</th>
                <th>電話</th>
                <th>人数</th>
                <th class="r">金額</th>
                <th>支払</th>
                <th>経路</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const muted = b.status === 'cancelled' || b.status === 'denied';
                return (
                  <tr class={muted ? 'row-muted' : undefined}>
                    <td data-label="参加日">
                      <a href={`/admin/day/${b.date}`}>{b.date}</a>
                    </td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
});

lists.get('/today', async (c) => {
  const today = todayJst();

  const result = await c.env.DB.prepare(
    `SELECT b.id, b.status, b.customer_name, b.customer_phone, b.num_adults, b.num_children, b.notes,
            p.name AS plan_name, st.id AS slot_type_id, st.name AS slot_name, st.start_time AS slot_start_time,
            a.name AS agency_name
     FROM bookings b
     JOIN plans p ON p.id = b.plan_id
     JOIN slot_types st ON st.id = b.slot_type_id
     LEFT JOIN agencies a ON a.id = b.agency_id
     WHERE b.date = ? AND b.status IN ('confirmed', 'requested')
     ORDER BY st.sort_order, st.id, b.created_at`
  ).bind(today).all<TodayRow>();
  const rows = result.results;

  const groups: { slotTypeId: number; slotName: string; startTime: string; totalPax: number; rows: TodayRow[] }[] = [];
  const groupByKey = new Map<number, (typeof groups)[number]>();
  for (const row of rows) {
    let group = groupByKey.get(row.slot_type_id);
    if (!group) {
      group = { slotTypeId: row.slot_type_id, slotName: row.slot_name, startTime: row.slot_start_time, totalPax: 0, rows: [] };
      groupByKey.set(row.slot_type_id, group);
      groups.push(group);
    }
    group.totalPax += row.num_adults + row.num_children;
    group.rows.push(row);
  }

  return c.html(
    <Layout title="本日の台帳" active="/admin/today">
      <div class="page-head">
        <span class="eyebrow">Today</span>
        <h1>本日の台帳</h1>
        <span class="sub">
          {today}　<a href={`/admin/day/${today}`}>日別詳細へ</a>
        </span>
        <div class="header-actions">
          <button class="btn no-print" onclick="window.print()" type="button">
            印刷
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p>本日の予約はありません</p>
      ) : (
        groups.map((g) => (
          <div class="card card-pad" style="margin-bottom:16px">
            <h2>
              {g.slotName} {g.startTime}{' '}
              <span class="muted small">
                {g.rows.length}件・{g.totalPax}名
              </span>
            </h2>
            {g.rows.map((b) => (
              <div class="roster-row" style="border-bottom:1px dotted var(--line-soft); padding:10px 0">
                <div style="font-size:18px; font-weight:700">
                  {b.customer_name}
                  {b.status === 'requested' && (
                    <>
                      {' '}
                      <span class={`badge ${BOOKING_BADGE_CLASSES[b.status]}`}>{BOOKING_STATUS_LABELS[b.status]}</span>
                    </>
                  )}
                </div>
                <div class="muted small">
                  電話: {b.customer_phone}　人数: 大{b.num_adults} 小{b.num_children}　プラン: {b.plan_name}　経路: {b.agency_name ?? '自社'}
                </div>
                {b.notes && <div class="muted small">備考: {b.notes}</div>}
              </div>
            ))}
          </div>
        ))
      )}
    </Layout>
  );
});
