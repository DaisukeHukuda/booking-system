import { Hono } from 'hono';
import { getAvailability } from '../../core/availability';
import type { Bindings, SlotAvailability } from '../../types';
import { Layout } from './ui';

export const calendar = new Hono<{ Bindings: Bindings }>();

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
