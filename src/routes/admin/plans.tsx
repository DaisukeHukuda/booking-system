import { Hono } from 'hono';
import type { Bindings } from '../../types';
import { Layout } from './ui';
import { todayJst } from './util';
import { datesBetween } from '../../core/availability';

export const plans = new Hono<{ Bindings: Bindings }>();

const OK_MESSAGES: Record<string, string> = {
  created: 'プランを作成しました',
  updated: 'プランを更新しました',
  copied: 'コースを複製しました（無効状態）',
  archived: 'コースをアーカイブしました',
  restored: 'コースを復帰しました',
  '1': '料金カレンダーを更新しました'
};

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

const INVALID = Symbol('invalid');

// 空文字は null（未設定）に、非空なら妥当性を検証する。不正値は INVALID を返す。
function parseOptionalPositiveInt(v: unknown): number | null | typeof INVALID {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : INVALID;
}

function parseOptionalNonNegativeInt(v: unknown): number | null | typeof INVALID {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : INVALID;
}

function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parseOptionalTime(v: unknown): string | null | typeof INVALID {
  if (typeof v !== 'string' || v.trim() === '') return null;
  return /^\d{2}:\d{2}$/.test(v) ? v : INVALID;
}

function toIdArray(v: unknown): number[] {
  const values = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return values
    .map((x) => (typeof x === 'string' ? Number(x) : NaN))
    .filter((n) => Number.isInteger(n) && n > 0);
}

interface PlanRow {
  id: number;
  name: string;
  short_name: string;
  description: string;
  price_adult: number;
  price_child: number;
  duration_min: number;
  active: number;
  sort_order: number;
}

interface ResourceRow {
  id: number;
  name: string;
}

interface SlotTypeRow {
  id: number;
  name: string;
}

plans.get('/', async (c) => {
  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');

  const [plansResult, resourcesResult, slotTypesResult, planResourcesResult, planSlotsResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM plans ORDER BY sort_order, id').all<PlanRow>(),
    c.env.DB.prepare('SELECT id, name FROM resources ORDER BY id').all<ResourceRow>(),
    c.env.DB.prepare('SELECT id, name FROM slot_types ORDER BY sort_order, id').all<SlotTypeRow>(),
    c.env.DB.prepare('SELECT plan_id, resource_id FROM plan_resources').all<{ plan_id: number; resource_id: number }>(),
    c.env.DB.prepare('SELECT plan_id, slot_type_id, capacity FROM plan_slots WHERE active = 1').all<{
      plan_id: number;
      slot_type_id: number;
      capacity: number;
    }>()
  ]);

  const planRows = plansResult.results;
  const resourceNameById = new Map<number, string>();
  for (const r of resourcesResult.results) resourceNameById.set(r.id, r.name);
  const slotTypeNameById = new Map<number, string>();
  for (const st of slotTypesResult.results) slotTypeNameById.set(st.id, st.name);

  const resourceNamesByPlan = new Map<number, string[]>();
  for (const pr of planResourcesResult.results) {
    const list = resourceNamesByPlan.get(pr.plan_id) ?? [];
    list.push(resourceNameById.get(pr.resource_id) ?? '');
    resourceNamesByPlan.set(pr.plan_id, list);
  }

  const slotLabelsByPlan = new Map<number, string[]>();
  for (const ps of planSlotsResult.results) {
    const list = slotLabelsByPlan.get(ps.plan_id) ?? [];
    list.push(`${slotTypeNameById.get(ps.slot_type_id) ?? ''}:${ps.capacity}`);
    slotLabelsByPlan.set(ps.plan_id, list);
  }

  return c.html(
    <Layout title="プラン管理" active="/admin/plans">
      <div class="page-head">
        <span class="eyebrow">Plans</span>
        <h1>プラン管理</h1>
      </div>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <div class="tbl-wrap tbl-cards">
        <table class="tbl">
          <thead>
            <tr>
              <th>名前</th>
              <th>略称</th>
              <th class="r">大人</th>
              <th class="r">小人</th>
              <th class="r">所要</th>
              <th>リソース</th>
              <th>時間帯別定員</th>
              <th>有効</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {planRows.map((p) => (
              <tr class={p.active ? undefined : 'row-muted'}>
                <td data-label="名前">{p.name}</td>
                <td data-label="略称">{p.short_name}</td>
                <td data-label="大人" class="num r">
                  {p.price_adult}
                </td>
                <td data-label="小人" class="num r">
                  {p.price_child}
                </td>
                <td data-label="所要" class="num r">
                  {p.duration_min}分
                </td>
                <td data-label="リソース">{(resourceNamesByPlan.get(p.id) ?? []).join(' / ')}</td>
                <td data-label="定員" class="num">
                  {(slotLabelsByPlan.get(p.id) ?? []).join(' / ')}
                </td>
                <td data-label="有効">
                  <span class={`badge ${p.active ? 'st-open' : 'st-manual'}`}>{p.active ? '有効' : '無効'}</span>
                </td>
                <td data-label="" class="actions">
                  <a class="btn btn-sm" href={`/admin/plans/${p.id}/edit`}>
                    編集
                  </a>
                  <a class="btn btn-sm" href={`/admin/plans/${p.id}/prices`}>
                    料金カレンダー
                  </a>
                  <form method="post" action={`/admin/plans/${p.id}/copy`} style="display:inline">
                    <button class="btn btn-sm" type="submit">
                      複製
                    </button>
                  </form>
                  {p.active ? (
                    <form method="post" action={`/admin/plans/${p.id}/archive`} style="display:inline">
                      <button class="btn btn-sm" type="submit">
                        アーカイブ
                      </button>
                    </form>
                  ) : (
                    <form method="post" action={`/admin/plans/${p.id}/restore`} style="display:inline">
                      <button class="btn btn-sm" type="submit">
                        復帰
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>新規作成</h2>
      <form class="card card-pad" method="post" action="/admin/plans">
        <div class="form-grid">
          <div class="field">
            <label>名前</label>
            <input type="text" name="name" required />
          </div>
          <div class="field">
            <label>略称</label>
            <input type="text" name="short_name" />
          </div>
          <div class="field">
            <label>大人料金（円）</label>
            <input type="number" name="price_adult" min="0" value="0" />
          </div>
          <div class="field">
            <label>小人料金（円）</label>
            <input type="number" name="price_child" min="0" value="0" />
          </div>
          <div class="field">
            <label>所要時間（分）</label>
            <input type="number" name="duration_min" min="1" value="120" />
          </div>
          <button class="btn btn-primary" type="submit">
            作成
          </button>
        </div>
      </form>
    </Layout>
  );
});

plans.post('/', async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const shortName = typeof form.short_name === 'string' ? form.short_name.trim() : '';
  const priceAdult = parseNonNegativeInt(form.price_adult);
  const priceChild = parseNonNegativeInt(form.price_child);
  const durationMin = parsePositiveInt(form.duration_min);

  if (name === '' || priceAdult === null || priceChild === null || durationMin === null) {
    return c.redirect('/admin/plans?error=invalid');
  }

  await c.env.DB.prepare(
    `INSERT INTO plans (name, short_name, price_adult, price_child, duration_min, sort_order) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans))`
  )
    .bind(name, shortName, priceAdult, priceChild, durationMin)
    .run();

  return c.redirect('/admin/plans?ok=created');
});

plans.get('/:id/edit', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const [plan, resourcesResult, slotTypesResult, planResourcesResult, planSlotsResult] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first<PlanRow>(),
    c.env.DB.prepare('SELECT id, name FROM resources ORDER BY id').all<ResourceRow>(),
    c.env.DB.prepare('SELECT id, name FROM slot_types ORDER BY sort_order, id').all<SlotTypeRow>(),
    c.env.DB.prepare('SELECT resource_id FROM plan_resources WHERE plan_id = ?').bind(id).all<{
      resource_id: number;
    }>(),
    c.env.DB.prepare(
      'SELECT slot_type_id, capacity, capacity_weekend, deadline_days, deadline_time, active FROM plan_slots WHERE plan_id = ?'
    ).bind(id).all<{
      slot_type_id: number;
      capacity: number;
      capacity_weekend: number | null;
      deadline_days: number | null;
      deadline_time: string | null;
      active: number;
    }>()
  ]);

  if (!plan) return c.redirect('/admin/plans');

  const resources = resourcesResult.results;
  const slotTypes = slotTypesResult.results;
  const assignedResourceIds = new Set(planResourcesResult.results.map((r) => r.resource_id));
  const planSlotById = new Map<
    number,
    {
      capacity: number;
      capacity_weekend: number | null;
      deadline_days: number | null;
      deadline_time: string | null;
      active: number;
    }
  >();
  for (const ps of planSlotsResult.results) {
    planSlotById.set(ps.slot_type_id, {
      capacity: ps.capacity,
      capacity_weekend: ps.capacity_weekend,
      deadline_days: ps.deadline_days,
      deadline_time: ps.deadline_time,
      active: ps.active
    });
  }

  const errorParam = c.req.query('error');

  return c.html(
    <Layout title="プラン編集" active="/admin/plans">
      <div class="page-head">
        <span class="eyebrow">Plans / Edit</span>
        <h1>プラン編集</h1>
        <span class="sub">
          <a href="/admin/plans">&laquo; プラン一覧に戻る</a> ・ <a href={`/admin/plans/${plan.id}/prices`}>料金カレンダー</a>
        </span>
      </div>
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <form class="card card-pad" method="post" action={`/admin/plans/${plan.id}`}>
        <div class="form-grid">
          <div class="field">
            <label>名前</label>
            <input type="text" name="name" value={plan.name} required />
          </div>
          <div class="field">
            <label>略称</label>
            <input type="text" name="short_name" value={plan.short_name} />
          </div>
          <div class="field">
            <label>大人料金（円）</label>
            <input type="number" name="price_adult" min="0" value={plan.price_adult} />
          </div>
          <div class="field">
            <label>小人料金（円）</label>
            <input type="number" name="price_child" min="0" value={plan.price_child} />
          </div>
          <div class="field">
            <label>所要時間（分）</label>
            <input type="number" name="duration_min" min="1" value={plan.duration_min} />
          </div>
          <div class="field">
            <label>表示順</label>
            <input type="number" name="sort_order" min="0" value={plan.sort_order} />
          </div>
          <div class="field">
            <label>説明</label>
            <textarea name="description">{plan.description}</textarea>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px">
          <label class="check">
            <input type="checkbox" name="active" value="1" checked={plan.active === 1} /> 有効
          </label>
        </div>

        <h3>使用リソース</h3>
        <div class="form-row">
          {resources.map((r) => (
            <label class="check">
              <input type="checkbox" name="resource_ids[]" value={r.id} checked={assignedResourceIds.has(r.id)} />{' '}
              {r.name}
            </label>
          ))}
        </div>

        <h3>時間帯ごとの催行と定員</h3>
        <div class="tbl-wrap" style="max-width:820px">
          <table class="tbl">
            <thead>
              <tr>
                <th>時間帯</th>
                <th>催行</th>
                <th>定員</th>
                <th>週末定員</th>
                <th>締切（日前）</th>
                <th>締切時刻</th>
              </tr>
            </thead>
            <tbody>
              {slotTypes.map((st) => {
                const current = planSlotById.get(st.id);
                return (
                  <tr>
                    <td>{st.name}</td>
                    <td>
                      <label class="check">
                        <input
                          type="checkbox"
                          name={`slot_active_${st.id}`}
                          value="1"
                          checked={!!current && current.active === 1}
                        />{' '}
                        催行する
                      </label>
                    </td>
                    <td>
                      <input
                        type="number"
                        name={`slot_capacity_${st.id}`}
                        min="1"
                        value={current?.capacity ?? ''}
                        class="w-sm"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        name={`slot_capacity_weekend_${st.id}`}
                        min="1"
                        value={current?.capacity_weekend ?? ''}
                        placeholder="平日と同じ"
                        class="w-sm"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        name={`slot_deadline_days_${st.id}`}
                        min="0"
                        value={current?.deadline_days ?? ''}
                        class="w-sm"
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        name={`slot_deadline_time_${st.id}`}
                        value={current?.deadline_time ?? ''}
                        class="w-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div class="form-row" style="margin-top:14px">
          <button class="btn btn-primary btn-lg" type="submit">
            更新
          </button>
          <a class="btn btn-lg" href="/admin/plans">
            キャンセル
          </a>
        </div>
      </form>
    </Layout>
  );
});

plans.post('/:id', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const body = await c.req.parseBody({ all: true });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const shortName = typeof body.short_name === 'string' ? body.short_name.trim() : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const priceAdult = parseNonNegativeInt(body.price_adult);
  const priceChild = parseNonNegativeInt(body.price_child);
  const durationMin = parsePositiveInt(body.duration_min);
  const sortOrder = parseNonNegativeInt(body.sort_order);
  const active = body.active !== undefined ? 1 : 0;
  const resourceIds = toIdArray(body['resource_ids[]']);

  const slotTypesResult = await c.env.DB.prepare('SELECT id FROM slot_types').all<{ id: number }>();
  const slotTypeIds = slotTypesResult.results.map((st) => st.id);

  if (name === '' || priceAdult === null || priceChild === null || durationMin === null || sortOrder === null) {
    return c.redirect(`/admin/plans/${id}/edit?error=invalid`);
  }

  interface SlotConfig {
    capacity: number;
    capacityWeekend: number | null;
    deadlineDays: number | null;
    deadlineTime: string | null;
  }

  const slotConfigs = new Map<number, SlotConfig>();
  for (const slotTypeId of slotTypeIds) {
    if (body[`slot_active_${slotTypeId}`] !== undefined) {
      const capacity = parsePositiveInt(body[`slot_capacity_${slotTypeId}`]);
      const capacityWeekend = parseOptionalPositiveInt(body[`slot_capacity_weekend_${slotTypeId}`]);
      const deadlineDays = parseOptionalNonNegativeInt(body[`slot_deadline_days_${slotTypeId}`]);
      const deadlineTime = parseOptionalTime(body[`slot_deadline_time_${slotTypeId}`]);
      if (
        capacity === null ||
        capacityWeekend === INVALID ||
        deadlineDays === INVALID ||
        deadlineTime === INVALID
      ) {
        return c.redirect(`/admin/plans/${id}/edit?error=invalid`);
      }
      slotConfigs.set(slotTypeId, { capacity, capacityWeekend, deadlineDays, deadlineTime });
    }
  }

  const statements = [
    c.env.DB.prepare(
      `UPDATE plans SET name = ?, short_name = ?, description = ?, price_adult = ?, price_child = ?, duration_min = ?, sort_order = ?, active = ? WHERE id = ?`
    ).bind(name, shortName, description, priceAdult, priceChild, durationMin, sortOrder, active, id),
    c.env.DB.prepare(`DELETE FROM plan_resources WHERE plan_id = ?`).bind(id),
    ...resourceIds.map((resourceId) =>
      c.env.DB.prepare(`INSERT INTO plan_resources (plan_id, resource_id) VALUES (?, ?)`).bind(id, resourceId)
    )
  ];

  for (const slotTypeId of slotTypeIds) {
    const cfg = slotConfigs.get(slotTypeId);
    if (cfg) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO plan_slots (plan_id, slot_type_id, capacity, capacity_weekend, deadline_days, deadline_time, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(plan_id, slot_type_id) DO UPDATE SET
             capacity = excluded.capacity,
             capacity_weekend = excluded.capacity_weekend,
             deadline_days = excluded.deadline_days,
             deadline_time = excluded.deadline_time,
             active = 1`
        ).bind(id, slotTypeId, cfg.capacity, cfg.capacityWeekend, cfg.deadlineDays, cfg.deadlineTime)
      );
    } else {
      statements.push(
        c.env.DB.prepare(`UPDATE plan_slots SET active = 0 WHERE plan_id = ? AND slot_type_id = ?`).bind(
          id,
          slotTypeId
        )
      );
    }
  }

  await c.env.DB.batch(statements);

  return c.redirect('/admin/plans?ok=updated');
});

plans.post('/:id/copy', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const plan = await c.env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first<PlanRow>();
  if (!plan) return c.redirect('/admin/plans');

  const insertResult = await c.env.DB.prepare(
    `INSERT INTO plans (name, short_name, description, price_adult, price_child, duration_min, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans))`
  )
    .bind(`${plan.name} (コピー)`, plan.short_name, plan.description, plan.price_adult, plan.price_child, plan.duration_min)
    .run();

  const newId = insertResult.meta.last_row_id;

  const [resourcesResult, slotsResult] = await Promise.all([
    c.env.DB.prepare('SELECT resource_id FROM plan_resources WHERE plan_id = ?').bind(id).all<{
      resource_id: number;
    }>(),
    c.env.DB.prepare(
      'SELECT slot_type_id, capacity, capacity_weekend, deadline_days, deadline_time, active FROM plan_slots WHERE plan_id = ?'
    ).bind(id).all<{
      slot_type_id: number;
      capacity: number;
      capacity_weekend: number | null;
      deadline_days: number | null;
      deadline_time: string | null;
      active: number;
    }>()
  ]);

  const statements = [
    ...resourcesResult.results.map((r) =>
      c.env.DB.prepare('INSERT INTO plan_resources (plan_id, resource_id) VALUES (?, ?)').bind(newId, r.resource_id)
    ),
    ...slotsResult.results.map((s) =>
      c.env.DB.prepare(
        `INSERT INTO plan_slots (plan_id, slot_type_id, capacity, capacity_weekend, deadline_days, deadline_time, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId, s.slot_type_id, s.capacity, s.capacity_weekend, s.deadline_days, s.deadline_time, s.active)
    )
  ];

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.redirect('/admin/plans?ok=copied');
});

plans.post('/:id/archive', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  await c.env.DB.prepare('UPDATE plans SET active = 0 WHERE id = ?').bind(id).run();

  return c.redirect('/admin/plans?ok=archived');
});

plans.post('/:id/restore', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  await c.env.DB.prepare('UPDATE plans SET active = 1 WHERE id = ?').bind(id).run();

  return c.redirect('/admin/plans?ok=restored');
});

const MAX_PRICE_SPAN_DAYS = 31;

interface PriceOverrideRow {
  date: string;
  price_adult: number;
  price_child: number;
}

plans.get('/:id/prices', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const plan = await c.env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first<PlanRow>();
  if (!plan) return c.redirect('/admin/plans');

  const overridesResult = await c.env.DB.prepare(
    `SELECT date, price_adult, price_child FROM price_overrides WHERE plan_id = ? AND date >= ? ORDER BY date ASC`
  ).bind(id, todayJst()).all<PriceOverrideRow>();

  const okParam = c.req.query('ok');
  const errorParam = c.req.query('error');

  return c.html(
    <Layout title="料金カレンダー" active="/admin/plans">
      <div class="page-head">
        <span class="eyebrow">Plans / Prices</span>
        <h1>{plan.name} 料金カレンダー</h1>
        <span class="sub">
          <a href="/admin/plans">&laquo; プラン一覧に戻る</a>
        </span>
      </div>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <p>
        基本単価: 大人 {plan.price_adult}円 / 小人 {plan.price_child}円
      </p>

      <h2>期間指定で登録</h2>
      <form class="card card-pad" method="post" action={`/admin/plans/${plan.id}/prices`}>
        <div class="form-grid">
          <div class="field">
            <label>開始日</label>
            <input type="date" name="from" required />
          </div>
          <div class="field">
            <label>終了日</label>
            <input type="date" name="to" required />
          </div>
          <div class="field">
            <label>大人料金（円）</label>
            <input type="number" name="price_adult" min="0" value={plan.price_adult} />
          </div>
          <div class="field">
            <label>小人料金（円）</label>
            <input type="number" name="price_child" min="0" value={plan.price_child} />
          </div>
          <button class="btn btn-primary" type="submit">
            登録
          </button>
        </div>
      </form>

      <h2>登録済み（本日以降）</h2>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>日付</th>
              <th class="r">大人</th>
              <th class="r">小人</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {overridesResult.results.map((o) => (
              <tr>
                <td data-label="日付">{o.date}</td>
                <td data-label="大人" class="num r">
                  {o.price_adult}
                </td>
                <td data-label="小人" class="num r">
                  {o.price_child}
                </td>
                <td data-label="" class="actions">
                  <form method="post" action={`/admin/plans/${plan.id}/prices/delete`} style="display:inline">
                    <input type="hidden" name="date" value={o.date} />
                    <button class="btn btn-sm" type="submit">
                      削除
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

plans.post('/:id/prices', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const body = await c.req.parseBody();
  const from = body.from;
  const to = body.to;
  const priceAdult = parseNonNegativeInt(body.price_adult);
  const priceChild = parseNonNegativeInt(body.price_child);

  if (!isValidDate(from) || !isValidDate(to) || from > to || priceAdult === null || priceChild === null) {
    return c.redirect(`/admin/plans/${id}/prices?error=invalid`);
  }

  const dates = datesBetween(from, to);
  if (dates.length > MAX_PRICE_SPAN_DAYS) {
    return c.redirect(`/admin/plans/${id}/prices?error=invalid`);
  }

  await c.env.DB.batch(
    dates.map((date) =>
      c.env.DB.prepare(
        `INSERT INTO price_overrides (date, plan_id, price_adult, price_child) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, plan_id) DO UPDATE SET
           price_adult = excluded.price_adult,
           price_child = excluded.price_child`
      ).bind(date, id, priceAdult, priceChild)
    )
  );

  return c.redirect(`/admin/plans/${id}/prices?ok=1`);
});

plans.post('/:id/prices/delete', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const body = await c.req.parseBody();
  const date = body.date;

  if (!isValidDate(date)) {
    return c.redirect(`/admin/plans/${id}/prices?error=invalid`);
  }

  await c.env.DB.prepare('DELETE FROM price_overrides WHERE plan_id = ? AND date = ?').bind(id, date).run();

  return c.redirect(`/admin/plans/${id}/prices?ok=1`);
});
