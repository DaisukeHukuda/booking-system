import { Hono } from 'hono';
import type { Bindings } from '../../types';
import { Layout } from './ui';

export const plans = new Hono<{ Bindings: Bindings }>();

const OK_MESSAGES: Record<string, string> = {
  created: 'プランを作成しました',
  updated: 'プランを更新しました'
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

function toIdArray(v: unknown): number[] {
  const values = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return values
    .map((x) => (typeof x === 'string' ? Number(x) : NaN))
    .filter((n) => Number.isInteger(n) && n > 0);
}

interface PlanRow {
  id: number;
  name: string;
  description: string;
  price: number;
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
    <Layout title="プラン管理">
      <h1>プラン管理</h1>
      {okParam && OK_MESSAGES[okParam] && <p class="msg-ok">{OK_MESSAGES[okParam]}</p>}
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <table>
        <thead>
          <tr>
            <th>名前</th>
            <th>価格</th>
            <th>有効</th>
            <th>割当リソース</th>
            <th>時間帯別定員</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {planRows.map((p) => (
            <tr>
              <td>{p.name}</td>
              <td>{p.price}</td>
              <td>{p.active ? '有効' : '無効'}</td>
              <td>{(resourceNamesByPlan.get(p.id) ?? []).join(', ')}</td>
              <td>{(slotLabelsByPlan.get(p.id) ?? []).join(', ')}</td>
              <td>
                <a href={`/admin/plans/${p.id}/edit`}>編集</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>新規作成</h2>
      <form method="post" action="/admin/plans">
        <label>
          名前: <input type="text" name="name" required />
        </label>{' '}
        <label>
          価格: <input type="number" name="price" min="0" value="0" />
        </label>{' '}
        <button type="submit">作成</button>
      </form>
    </Layout>
  );
});

plans.post('/', async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  const price = parseNonNegativeInt(form.price);

  if (name === '' || price === null) {
    return c.redirect('/admin/plans?error=invalid');
  }

  await c.env.DB.prepare(
    `INSERT INTO plans (name, price, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans))`
  )
    .bind(name, price)
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
    c.env.DB.prepare('SELECT slot_type_id, capacity, active FROM plan_slots WHERE plan_id = ?').bind(id).all<{
      slot_type_id: number;
      capacity: number;
      active: number;
    }>()
  ]);

  if (!plan) return c.redirect('/admin/plans');

  const resources = resourcesResult.results;
  const slotTypes = slotTypesResult.results;
  const assignedResourceIds = new Set(planResourcesResult.results.map((r) => r.resource_id));
  const planSlotById = new Map<number, { capacity: number; active: number }>();
  for (const ps of planSlotsResult.results) {
    planSlotById.set(ps.slot_type_id, { capacity: ps.capacity, active: ps.active });
  }

  const errorParam = c.req.query('error');

  return c.html(
    <Layout title="プラン編集">
      <h1>プラン編集</h1>
      <p>
        <a href="/admin/plans">&laquo; プラン一覧に戻る</a>
      </p>
      {errorParam && ERROR_MESSAGES[errorParam] && <p class="msg-error">{ERROR_MESSAGES[errorParam]}</p>}

      <form method="post" action={`/admin/plans/${plan.id}`}>
        <label>
          名前: <input type="text" name="name" value={plan.name} required />
        </label>{' '}
        <label>
          説明: <textarea name="description">{plan.description}</textarea>
        </label>{' '}
        <label>
          価格: <input type="number" name="price" min="0" value={plan.price} />
        </label>{' '}
        <label>
          表示順: <input type="number" name="sort_order" min="0" value={plan.sort_order} />
        </label>{' '}
        <label>
          <input type="checkbox" name="active" value="1" checked={plan.active === 1} /> 有効
        </label>

        <h2>割当リソース</h2>
        {resources.map((r) => (
          <label>
            <input
              type="checkbox"
              name="resource_ids[]"
              value={r.id}
              checked={assignedResourceIds.has(r.id)}
            />{' '}
            {r.name}
          </label>
        ))}

        <h2>時間帯別定員</h2>
        {slotTypes.map((st) => {
          const current = planSlotById.get(st.id);
          return (
            <div>
              <label>
                <input
                  type="checkbox"
                  name={`slot_active_${st.id}`}
                  value="1"
                  checked={!!current && current.active === 1}
                />{' '}
                {st.name} 催行
              </label>{' '}
              <label>
                定員: <input type="number" name={`slot_capacity_${st.id}`} min="1" value={current?.capacity ?? ''} />
              </label>
            </div>
          );
        })}

        <button type="submit">更新</button>
      </form>
    </Layout>
  );
});

plans.post('/:id', async (c) => {
  const id = parsePositiveInt(c.req.param('id'));
  if (id === null) return c.redirect('/admin/plans');

  const body = await c.req.parseBody({ all: true });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const price = parseNonNegativeInt(body.price);
  const sortOrder = parseNonNegativeInt(body.sort_order);
  const active = body.active !== undefined ? 1 : 0;
  const resourceIds = toIdArray(body['resource_ids[]']);

  const slotTypesResult = await c.env.DB.prepare('SELECT id FROM slot_types').all<{ id: number }>();
  const slotTypeIds = slotTypesResult.results.map((st) => st.id);

  if (name === '' || price === null || sortOrder === null) {
    return c.redirect(`/admin/plans/${id}/edit?error=invalid`);
  }

  const slotCapacities = new Map<number, number>();
  for (const slotTypeId of slotTypeIds) {
    if (body[`slot_active_${slotTypeId}`] !== undefined) {
      const capacity = parsePositiveInt(body[`slot_capacity_${slotTypeId}`]);
      if (capacity === null) {
        return c.redirect(`/admin/plans/${id}/edit?error=invalid`);
      }
      slotCapacities.set(slotTypeId, capacity);
    }
  }

  const statements = [
    c.env.DB.prepare(
      `UPDATE plans SET name = ?, description = ?, price = ?, sort_order = ?, active = ? WHERE id = ?`
    ).bind(name, description, price, sortOrder, active, id),
    c.env.DB.prepare(`DELETE FROM plan_resources WHERE plan_id = ?`).bind(id),
    ...resourceIds.map((resourceId) =>
      c.env.DB.prepare(`INSERT INTO plan_resources (plan_id, resource_id) VALUES (?, ?)`).bind(id, resourceId)
    )
  ];

  for (const slotTypeId of slotTypeIds) {
    if (slotCapacities.has(slotTypeId)) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO plan_slots (plan_id, slot_type_id, capacity, active) VALUES (?, ?, ?, 1)
           ON CONFLICT(plan_id, slot_type_id) DO UPDATE SET capacity = excluded.capacity, active = 1`
        ).bind(id, slotTypeId, slotCapacities.get(slotTypeId))
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
