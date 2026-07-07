import { Hono } from 'hono';
import type { Bindings } from '../../types';
import { Layout } from './ui';

export const stats = new Hono<{ Bindings: Bindings }>();

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

interface PlanStatRow {
  name: string;
  cnt: number;
  pax: number;
  amount: number;
}

interface AgencyStatRow {
  name: string;
  cnt: number;
  pax: number;
  amount: number;
}

stats.get('/', async (c) => {
  const monthParam = c.req.query('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentJstMonth();
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const lastDay = daysInMonth(year, monthNum);
  const from = `${month}-01`;
  const to = `${month}-${pad2(lastDay)}`;

  const [planStatsResult, agencyStatsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.name AS name, COUNT(*) AS cnt, SUM(b.party_size) AS pax, SUM(b.total_amount) AS amount
       FROM bookings b
       JOIN plans p ON p.id = b.plan_id
       WHERE b.status = 'confirmed' AND b.date BETWEEN ?1 AND ?2
       GROUP BY b.plan_id
       ORDER BY amount DESC`
    ).bind(from, to).all<PlanStatRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(a.name, '自社') AS name, COUNT(*) AS cnt, SUM(b.party_size) AS pax, SUM(b.total_amount) AS amount
       FROM bookings b
       LEFT JOIN agencies a ON a.id = b.agency_id
       WHERE b.status = 'confirmed' AND b.date BETWEEN ?1 AND ?2
       GROUP BY b.agency_id
       ORDER BY amount DESC`
    ).bind(from, to).all<AgencyStatRow>()
  ]);

  const planStats = planStatsResult.results;
  const agencyStats = agencyStatsResult.results;

  const planTotal = planStats.reduce(
    (acc, r) => ({ cnt: acc.cnt + r.cnt, pax: acc.pax + r.pax, amount: acc.amount + r.amount }),
    { cnt: 0, pax: 0, amount: 0 }
  );
  const agencyTotal = agencyStats.reduce(
    (acc, r) => ({ cnt: acc.cnt + r.cnt, pax: acc.pax + r.pax, amount: acc.amount + r.amount }),
    { cnt: 0, pax: 0, amount: 0 }
  );

  const prev = shiftMonth(year, monthNum, -1);
  const next = shiftMonth(year, monthNum, 1);
  const prevMonth = `${prev.year}-${pad2(prev.month)}`;
  const nextMonth = `${next.year}-${pad2(next.month)}`;

  return c.html(
    <Layout title="集計">
      <h1>
        {year}年{monthNum}月の集計
      </h1>
      <p>
        <a href={`/admin/stats?month=${prevMonth}`}>&laquo; 前月</a>{' '}
        <a href={`/admin/stats?month=${nextMonth}`}>次月 &raquo;</a>
      </p>

      <h2>プラン別</h2>
      <table>
        <thead>
          <tr>
            <th>プラン</th>
            <th>件数</th>
            <th>人数</th>
            <th>金額</th>
          </tr>
        </thead>
        <tbody>
          {planStats.map((r) => (
            <tr>
              <td>{r.name}</td>
              <td>{r.cnt}件</td>
              <td>{r.pax}名</td>
              <td>{r.amount}円</td>
            </tr>
          ))}
          <tr>
            <td>合計</td>
            <td>{planTotal.cnt}件</td>
            <td>{planTotal.pax}名</td>
            <td>{planTotal.amount}円</td>
          </tr>
        </tbody>
      </table>

      <h2>代理店別</h2>
      <table>
        <thead>
          <tr>
            <th>経路</th>
            <th>件数</th>
            <th>人数</th>
            <th>金額</th>
          </tr>
        </thead>
        <tbody>
          {agencyStats.map((r) => (
            <tr>
              <td>{r.name}</td>
              <td>{r.cnt}件</td>
              <td>{r.pax}名</td>
              <td>{r.amount}円</td>
            </tr>
          ))}
          <tr>
            <td>合計</td>
            <td>{agencyTotal.cnt}件</td>
            <td>{agencyTotal.pax}名</td>
            <td>{agencyTotal.amount}円</td>
          </tr>
        </tbody>
      </table>

      <h2>CSVエクスポート</h2>
      <form method="get" action="/admin/stats/export.csv">
        <label>
          開始日: <input type="date" name="from" value={from} />
        </label>{' '}
        <label>
          終了日: <input type="date" name="to" value={to} />
        </label>{' '}
        <button type="submit">CSVダウンロード</button>
      </form>
    </Layout>
  );
});
