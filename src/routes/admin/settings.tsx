import { Hono } from 'hono';
import type { Bindings } from '../../types';
import { Layout } from './ui';

export const settings = new Hono<{ Bindings: Bindings }>();

const OK_MESSAGE = '保存しました';
const ERROR_MESSAGES: Record<string, string> = {
  invalid: '入力内容に誤りがあります'
};

function parseNonNegativeInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parsePositiveInt(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isValidTime(v: unknown): v is string {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
}

function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

interface ResourceRow {
  id: number;
  name: string;
  active: number;
}

interface SlotTypeRow {
  id: number;
  name: string;
  start_time: string;
  sort_order: number;
}

interface ClosureRow {
  id: number;
  date: string;
  slot_type_id: number;
  plan_id: number | null;
  reason: string | null;
}

interface PlanRow {
  id: number;
  name: string;
}

settings.get('/', async (c) => {
  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');

  const [resourcesResult, slotTypesResult, plansResult, closuresResult] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, active FROM resources ORDER BY id').all<ResourceRow>(),
    c.env.DB.prepare('SELECT id, name, start_time, sort_order FROM slot_types ORDER BY sort_order, id').all<SlotTypeRow>(),
    c.env.DB.prepare('SELECT id, name FROM plans ORDER BY sort_order, id').all<PlanRow>(),
    c.env.DB.prepare(
      `SELECT sc.id, sc.date, sc.slot_type_id, sc.plan_id, sc.reason
       FROM slot_closures sc WHERE sc.date >= ?
       ORDER BY sc.date, sc.slot_type_id`
    )
      .bind(todayJst())
      .all<ClosureRow>()
  ]);

  const resources = resourcesResult.results;
  const slotTypes = slotTypesResult.results;
  const plans = plansResult.results;
  const closures = closuresResult.results;

  const slotTypeNameById = new Map<number, string>();
  for (const st of slotTypes) slotTypeNameById.set(st.id, st.name);
  const planNameById = new Map<number, string>();
  for (const p of plans) planNameById.set(p.id, p.name);

  return c.html(
    <Layout title="設定" active="/admin/settings" narrow>
      <div class="page-head">
        <span class="eyebrow">Settings</span>
        <h1>設定</h1>
      </div>
      {okParam === '1' && <p class="msg-ok">{OK_MESSAGE}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <h2>リソース</h2>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>名前</th>
              <th>有効</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr class={r.active ? undefined : 'row-muted'}>
                <td colspan={3}>
                  <form class="form-row" method="post" action={`/admin/settings/resources/${r.id}`}>
                    <input type="text" name="name" value={r.name} required />
                    <label class="check">
                      <input type="checkbox" name="active" value="1" checked={r.active === 1} /> 有効
                    </label>
                    <button class="btn btn-sm" type="submit">
                      更新
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form class="card card-pad form-row" method="post" action="/admin/settings/resources">
        <div class="field">
          <label>名前</label>
          <input type="text" name="name" required />
        </div>
        <button class="btn btn-primary" type="submit">
          追加
        </button>
      </form>

      <h2>時間帯</h2>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>名前</th>
              <th>開始時刻</th>
              <th class="r">表示順</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {slotTypes.map((st) => (
              <tr>
                <td colspan={4}>
                  <form class="form-row" method="post" action={`/admin/settings/slot-types/${st.id}`}>
                    <input type="text" name="name" value={st.name} required />
                    <input type="text" name="start_time" value={st.start_time} placeholder="09:00" required class="w-sm" />
                    <input type="number" name="sort_order" value={st.sort_order} class="w-sm" />
                    <button class="btn btn-sm" type="submit">
                      更新
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form class="card card-pad form-row" method="post" action="/admin/settings/slot-types">
        <div class="field">
          <label>名前</label>
          <input type="text" name="name" required />
        </div>
        <div class="field">
          <label>開始時刻</label>
          <input type="text" name="start_time" placeholder="09:00" required class="w-sm" />
        </div>
        <div class="field">
          <label>表示順</label>
          <input type="number" name="sort_order" value="0" class="w-sm" />
        </div>
        <button class="btn btn-primary" type="submit">
          追加
        </button>
      </form>

      <h2>手動クローズ</h2>
      <form class="card card-pad form-row" method="post" action="/admin/settings/closures">
        <div class="field">
          <label>日付</label>
          <input type="date" name="date" required />
        </div>
        <div class="field">
          <label>時間帯</label>
          <select name="slot_type_id" required>
            {slotTypes.map((st) => (
              <option value={st.id}>{st.name}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label>プラン</label>
          <select name="plan_id">
            <option value="">全プラン</option>
            {plans.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label>理由</label>
          <input type="text" name="reason" />
        </div>
        <button class="btn btn-primary" type="submit">
          登録
        </button>
      </form>

      <div class="tbl-wrap" style="margin-top:12px">
        <table class="tbl">
          <thead>
            <tr>
              <th>日付</th>
              <th>時間帯</th>
              <th>プラン</th>
              <th>理由</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {closures.map((cl) => (
              <tr>
                <td class="num">{cl.date}</td>
                <td>{slotTypeNameById.get(cl.slot_type_id) ?? ''}</td>
                <td>{cl.plan_id === null ? '全プラン' : planNameById.get(cl.plan_id) ?? ''}</td>
                <td>{cl.reason}</td>
                <td class="actions">
                  <form method="post" action={`/admin/settings/closures/${cl.id}/delete`}>
                    <button class="btn btn-sm btn-danger" type="submit">
                      解除
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

settings.post('/resources', async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';

  if (name === '') {
    return c.redirect('/admin/settings?error=invalid');
  }

  await c.env.DB.prepare(`INSERT INTO resources (name) VALUES (?)`).bind(name).run();

  return c.redirect('/admin/settings?ok=1');
});

settings.post('/resources/:id', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const active = form.active !== undefined ? 1 : 0;

  if (id === null || name === '') {
    return c.redirect('/admin/settings?error=invalid');
  }

  await c.env.DB.prepare(`UPDATE resources SET name = ?, active = ? WHERE id = ?`).bind(name, active, id).run();

  return c.redirect('/admin/settings?ok=1');
});

settings.post('/slot-types', async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const startTime = form.start_time;
  const sortOrder = parseNonNegativeInt(form.sort_order);

  if (name === '' || !isValidTime(startTime) || sortOrder === null) {
    return c.redirect('/admin/settings?error=invalid');
  }

  await c.env.DB.prepare(`INSERT INTO slot_types (name, start_time, sort_order) VALUES (?, ?, ?)`)
    .bind(name, startTime, sortOrder)
    .run();

  return c.redirect('/admin/settings?ok=1');
});

settings.post('/slot-types/:id', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const startTime = form.start_time;
  const sortOrder = parseNonNegativeInt(form.sort_order);

  if (id === null || name === '' || !isValidTime(startTime) || sortOrder === null) {
    return c.redirect('/admin/settings?error=invalid');
  }

  await c.env.DB.prepare(`UPDATE slot_types SET name = ?, start_time = ?, sort_order = ? WHERE id = ?`)
    .bind(name, startTime, sortOrder, id)
    .run();

  return c.redirect('/admin/settings?ok=1');
});

settings.post('/closures', async (c) => {
  const form = await c.req.parseBody();
  const date = form.date;
  const slotTypeId = parsePositiveInt(form.slot_type_id);
  const planIdRaw = typeof form.plan_id === 'string' ? form.plan_id.trim() : '';
  const reason = typeof form.reason === 'string' ? form.reason : '';

  if (!isValidDate(date) || slotTypeId === null) {
    return c.redirect('/admin/settings?error=invalid');
  }

  let planId: number | null;
  if (planIdRaw === '') {
    planId = null;
  } else {
    planId = parsePositiveInt(planIdRaw);
    if (planId === null) {
      return c.redirect('/admin/settings?error=invalid');
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(date, slotTypeId, planId, reason, new Date().toISOString())
    .run();

  return c.redirect('/admin/settings?ok=1');
});

settings.post('/closures/:id/delete', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));

  if (id === null) {
    return c.redirect('/admin/settings?error=invalid');
  }

  await c.env.DB.prepare(`DELETE FROM slot_closures WHERE id = ?`).bind(id).run();

  return c.redirect('/admin/settings?ok=1');
});
