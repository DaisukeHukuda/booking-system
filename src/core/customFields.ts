// 予約時取得項目（プラン別カスタム入力欄）: DBアクセスと予約フォーム入力の検証。

export interface PlanFieldDef {
  id: number;
  label: string;
  required: number;
}

// アクティブなプラン別カスタム項目を plan_id ごとにまとめて取得する（フォーム描画用）。
export async function getActiveFieldsByPlan(db: D1Database): Promise<Map<number, PlanFieldDef[]>> {
  const result = await db
    .prepare(`SELECT id, plan_id, label, required FROM plan_fields WHERE active = 1 ORDER BY plan_id, sort_order, id`)
    .all<{ id: number; plan_id: number; label: string; required: number }>();

  const map = new Map<number, PlanFieldDef[]>();
  for (const row of result.results) {
    const list = map.get(row.plan_id) ?? [];
    list.push({ id: row.id, label: row.label, required: row.required });
    map.set(row.plan_id, list);
  }
  return map;
}

// 単一プランのアクティブなカスタム項目（POST側の検証用）
export async function getActiveFields(db: D1Database, planId: number): Promise<PlanFieldDef[]> {
  const result = await db
    .prepare(`SELECT id, label, required FROM plan_fields WHERE plan_id = ? AND active = 1 ORDER BY sort_order, id`)
    .bind(planId)
    .all<PlanFieldDef>();
  return result.results;
}

// フォームの `field_{id}` 値から [{label, value}] を組み立てる。
// 必須項目が空なら null（呼び出し側は error=invalid とする）。値が空の項目は結果に含めない。
export function buildCustomFields(
  fields: PlanFieldDef[],
  body: Record<string, unknown>
): { label: string; value: string }[] | null {
  const out: { label: string; value: string }[] = [];
  for (const f of fields) {
    const raw = body[`field_${f.id}`];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (f.required && value === '') return null;
    if (value !== '') out.push({ label: f.label, value });
  }
  return out;
}

// 表示・CSV用: JSON文字列を `label:value / label:value` 形式にする
export function formatCustomFields(json: string): string {
  try {
    const arr = JSON.parse(json) as { label: string; value: string }[];
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr.map((f) => `${f.label}:${f.value}`).join(' / ');
  } catch {
    return '';
  }
}
