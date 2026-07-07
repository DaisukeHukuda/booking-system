# 予約管理システム ステップ7（コース管理拡張）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** ウラカタのコース管理に相当する機能拡張 — ①予約締切（時刻ごと「N日前のHH:MMまで」、代理店のみに適用） ②平日/土日の基本定員 ③コース略称・複製・アーカイブ ④料金カレンダー（日別単価上書き） ⑤予約時取得項目（プラン別カスタム入力欄）。

**スコープ外（明示）:** 台帳表示項目のカスタマイズ、開催日カレンダー（手動クローズ・予約枠で代替）、リアルタイム/リクエスト別の定員枠。

**マイグレーション方針:** 本番稼働中のため **追記型**（`migrations/0002_course_mgmt.sql`）。0001は変更しない。

**前提:** 139テストgreen。ブランチ `step7-course-mgmt`。

## 許可されるテスト変更（これ以外の既存assert変更は禁止）

1. `test/schema.test.ts`: 期待テーブル一覧に `plan_fields` と `price_overrides` を追加（アルファベット順）
2. `test/admin-export.test.ts`: ヘッダ行の期待文字列の末尾に `,追加項目` を追加（1assertのみ）

## セマンティクス（設計済み・遵守）

- **有効定員** = `capacity_overrides(date)` ?? （土日なら `plan_slots.capacity_weekend` ?? `capacity`、平日なら `capacity`）。土日判定は日付の曜日（JST文字列日付そのものの曜日）。祝日は対象外（日別上書きで運用）
- **予約締切** = 参加日の `deadline_days` 日前の `deadline_time`（JST、time省略時 23:59）。**代理店ページのみ**に適用（表示は `締切`、POSTは `?error=deadline` → `予約締切を過ぎています。お電話にてお問い合わせください`）。管理画面の手入力は締切後も可能。`deadline_days` NULL = 締切なし
- **有効単価** = `price_overrides(date, plan)` ?? プランの単価。自動計算・スナップショットの両方に適用（管理・代理店とも）
- **カスタム項目** = `plan_fields`（プラン別・ラベルのみのテキスト項目）。予約の回答は `bookings.custom_fields` にJSON `[{"label":"...","value":"..."}]` で保存。required は**サーバー側検証のみ**（フォームは全プラン分のグループを描画しJSで表示切替するため、HTML required は使わない）

---

### Task 1: スキーマv3（追記マイグレーション・挙動不変）

**Files:** Create `migrations/0002_course_mgmt.sql`; Modify `test/schema.test.ts`（許可済み変更のみ）

`0002_course_mgmt.sql`:
```sql
ALTER TABLE plans ADD COLUMN short_name TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_slots ADD COLUMN capacity_weekend INTEGER;
ALTER TABLE plan_slots ADD COLUMN deadline_days INTEGER;
ALTER TABLE plan_slots ADD COLUMN deadline_time TEXT;
ALTER TABLE bookings ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '[]';

CREATE TABLE price_overrides (
  date TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  price_adult INTEGER NOT NULL CHECK (price_adult >= 0),
  price_child INTEGER NOT NULL CHECK (price_child >= 0),
  PRIMARY KEY (date, plan_id)
);

CREATE TABLE plan_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
```

手順: schema.test更新→FAIL確認→マイグレーション追加→`npm test && npm run typecheck` 全green（139のまま）→Commit `feat: スキーマv3(締切・週末定員・略称・料金上書き・カスタム項目)`

---

### Task 2: コアv3（週末定員・有効単価・締切判定）

**このタスクのSQLとコードは設計済み。一字一句そのまま使う。**

**Files:** Modify `src/core/booking.ts`, `src/core/availability.ts`; Create `src/core/deadline.ts`, `test/core-v3.test.ts`; Modify `src/routes/admin/calendar.tsx`・`src/routes/agency.tsx`（単価取得の差し替え）

- [ ] **Step 1: 失敗するテスト**

`test/core-v3.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBooking, getEffectivePrices } from '../src/core/booking';
import { getAvailability } from '../src/core/availability';
import { isBeforeDeadline } from '../src/core/deadline';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM } from './fixtures';

// 2026-08-01は土曜、2026-08-03は月曜
const SAT = '2026-08-01';
const MON = '2026-08-03';

describe('週末定員', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
    await env.DB.prepare(`UPDATE plan_slots SET capacity_weekend = 12 WHERE plan_id = ? AND slot_type_id = ?`)
      .bind(PLAN_B, SLOT_AM).run();
  });

  it('土曜は週末定員が効く（基本4→12）', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, date: SAT, numAdults: 10 }))).ok).toBe(true);
    const avail = await getAvailability(env.DB, SAT, SAT);
    const b = avail.find((a) => a.planId === PLAN_B && a.slotTypeId === SLOT_AM)!;
    expect(b.capacity).toBe(12);
    expect(b.remaining).toBe(2);
  });

  it('平日は基本定員のまま', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, date: MON, numAdults: 10 }))).ok).toBe(false);
    const avail = await getAvailability(env.DB, MON, MON);
    expect(avail.find((a) => a.planId === PLAN_B && a.slotTypeId === SLOT_AM)?.capacity).toBe(4);
  });

  it('日別上書きは週末定員より優先される', async () => {
    await env.DB.prepare(`INSERT INTO capacity_overrides (date, plan_id, slot_type_id, capacity) VALUES (?, ?, ?, 2)`)
      .bind(SAT, PLAN_B, SLOT_AM).run();
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, date: SAT, numAdults: 3 }))).ok).toBe(false);
  });

  it('capacity_weekend未設定のプランは土日も基本定員（回帰）', async () => {
    const avail = await getAvailability(env.DB, SAT, SAT);
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.capacity).toBe(6);
  });
});

describe('有効単価（料金カレンダー）', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('上書きがなければプラン単価', async () => {
    expect(await getEffectivePrices(env.DB, PLAN_A, SAT)).toEqual({ priceAdult: 8000, priceChild: 4000 });
  });

  it('上書きがあればその日だけ差し替わる', async () => {
    await env.DB.prepare(`INSERT INTO price_overrides (date, plan_id, price_adult, price_child) VALUES (?, ?, 9500, 5000)`)
      .bind(SAT, PLAN_A).run();
    expect(await getEffectivePrices(env.DB, PLAN_A, SAT)).toEqual({ priceAdult: 9500, priceChild: 5000 });
    expect(await getEffectivePrices(env.DB, PLAN_A, MON)).toEqual({ priceAdult: 8000, priceChild: 4000 });
  });

  it('存在しないプランはnull', async () => {
    expect(await getEffectivePrices(env.DB, 999, SAT)).toBeNull();
  });
});

describe('締切判定', () => {
  it('deadline_daysがnullなら常に予約可', () => {
    expect(isBeforeDeadline('2026-08-01', null, null, Date.parse('2026-08-01T23:00:00+09:00'))).toBe(true);
  });

  it('2日前18:00締切: 直前はNG・締切前はOK', () => {
    const d = '2026-08-10';
    expect(isBeforeDeadline(d, 2, '18:00', Date.parse('2026-08-08T17:59:00+09:00'))).toBe(true);
    expect(isBeforeDeadline(d, 2, '18:00', Date.parse('2026-08-08T18:01:00+09:00'))).toBe(false);
    expect(isBeforeDeadline(d, 2, '18:00', Date.parse('2026-08-09T10:00:00+09:00'))).toBe(false);
  });

  it('time省略時は23:59', () => {
    expect(isBeforeDeadline('2026-08-10', 0, null, Date.parse('2026-08-10T23:58:00+09:00'))).toBe(true);
    expect(isBeforeDeadline('2026-08-10', 0, null, Date.parse('2026-08-11T00:01:00+09:00'))).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装**

`src/core/booking.ts` — `slotOpenCond` の**定員条件のみ**を以下に置き換え（他の条件・末尾のリソース重なり条件は不変）:
```sql
      AND (SELECT COALESCE(SUM(b.party_size), 0) FROM bookings b
              WHERE b.plan_id = ? AND b.date = ? AND b.slot_type_id = ?
                AND b.status IN ('requested', 'confirmed')
                AND (? IS NULL OR b.id != ?)) + ?
          <= COALESCE(
               (SELECT co.capacity FROM capacity_overrides co
                 WHERE co.date = ? AND co.plan_id = ? AND co.slot_type_id = ?),
               (SELECT CASE WHEN strftime('%w', ?) IN ('0', '6') AND ps.capacity_weekend IS NOT NULL
                            THEN ps.capacity_weekend ELSE ps.capacity END
                  FROM plan_slots ps WHERE ps.plan_id = ? AND ps.slot_type_id = ?))
```
params配列（26個・この順で全置き換え）:
```ts
    params: [
      v.planId, v.slotTypeId,
      v.date, v.slotTypeId, v.planId,
      v.planId, v.date, v.slotTypeId, ex, ex, v.partySize,
      v.date, v.planId, v.slotTypeId, v.date, v.planId, v.slotTypeId,
      v.planId, v.date, v.planId, v.slotTypeId, ex, ex, v.slotTypeId, v.planId, v.slotTypeId
    ]
```

`src/core/booking.ts` に追加:
```ts
// 有効単価: price_overrides(日付×プラン) があればそれ、なければプランの単価
export async function getEffectivePrices(
  db: D1Database, planId: number, date: string
): Promise<{ priceAdult: number; priceChild: number } | null> {
  const row = await db.prepare(
    `SELECT COALESCE(po.price_adult, p.price_adult) AS priceAdult,
            COALESCE(po.price_child, p.price_child) AS priceChild
     FROM plans p
     LEFT JOIN price_overrides po ON po.plan_id = p.id AND po.date = ?
     WHERE p.id = ?`
  ).bind(date, planId).first<{ priceAdult: number; priceChild: number }>();
  return row ?? null;
}
```

`src/core/deadline.ts`（新規・全文）:
```ts
// 予約締切: 参加日の deadlineDays 日前の deadlineTime（JST）まで予約可能。
// deadlineDays が null なら締切なし。deadlineTime 省略時は 23:59。
// 代理店ページのみに適用する（管理画面の手入力は締切後も可能）。
export function isBeforeDeadline(
  date: string,
  deadlineDays: number | null,
  deadlineTime: string | null,
  nowMs: number = Date.now()
): boolean {
  if (deadlineDays === null) return true;
  const time = deadlineTime ?? '23:59';
  const deadlineMs = Date.parse(`${date}T${time}:00+09:00`) - deadlineDays * 86_400_000;
  return nowMs <= deadlineMs;
}
```

`src/core/availability.ts`: planSlotsクエリに `ps.capacity_weekend AS capacityWeekend` を追加し、各(date, ps)の基本定員を `const isWknd = [0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay()); const baseCap = isWknd && ps.capacityWeekend != null ? ps.capacityWeekend : ps.capacity;` とし、`cap = override ?? baseCap` に変更。

`calendar.tsx`（POST /bookings・POST /bookings/:id の自動計算）と `agency.tsx`（予約POST）の単価取得SELECTを `getEffectivePrices` 呼び出しに差し替え（スナップショット・自動計算とも有効単価を使う）。

- [ ] **Step 4: 全テストgreen**（149件） → Commit `feat: コアv3(週末定員・有効単価・締切判定)`

---

### Task 3: プラン管理v2（略称・週末定員・締切・複製・アーカイブ）

**Files:** Modify `src/routes/admin/plans.tsx`, `src/routes/admin/calendar.tsx`（日別の空き表ヘッダ）, `src/routes/admin/slots.tsx`（行ラベル）; Create `test/admin-plans-v2.test.ts`

- [ ] **Step 1: 失敗するテスト**

`test/admin-plans-v2.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

function form(data: Record<string, string | string[]>, cookie: string) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else params.append(k, v);
  }
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: params.toString()
  };
}

const FULL = {
  name: 'プランA', short_name: '体験', description: '', price_adult: '8000', price_child: '4000',
  duration_min: '120', sort_order: '1', active: '1', 'resource_ids[]': ['1'],
  slot_active_1: '1', slot_capacity_1: '6', slot_capacity_weekend_1: '12', slot_deadline_days_1: '2', slot_deadline_time_1: '18:00',
  slot_active_2: '1', slot_capacity_2: '6'
};

describe('admin plans v2', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('略称・週末定員・締切を保存できる', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}`, form(FULL, cookie), env);
    expect(res.status).toBe(302);
    const plan = await env.DB.prepare(`SELECT short_name FROM plans WHERE id = ?`).bind(PLAN_A).first<{ short_name: string }>();
    expect(plan?.short_name).toBe('体験');
    const slot = await env.DB.prepare(
      `SELECT capacity_weekend, deadline_days, deadline_time FROM plan_slots WHERE plan_id = ? AND slot_type_id = ?`
    ).bind(PLAN_A, SLOT_AM).first<{ capacity_weekend: number; deadline_days: number; deadline_time: string }>();
    expect(slot).toEqual({ capacity_weekend: 12, deadline_days: 2, deadline_time: '18:00' });
  });

  it('週末定員・締切を空にするとNULLに戻る', async () => {
    await app.request(`/admin/plans/${PLAN_A}`, form(FULL, cookie), env);
    await app.request(`/admin/plans/${PLAN_A}`, form({
      ...FULL, slot_capacity_weekend_1: '', slot_deadline_days_1: '', slot_deadline_time_1: ''
    }, cookie), env);
    const slot = await env.DB.prepare(
      `SELECT capacity_weekend, deadline_days FROM plan_slots WHERE plan_id = ? AND slot_type_id = ?`
    ).bind(PLAN_A, SLOT_AM).first<{ capacity_weekend: number | null; deadline_days: number | null }>();
    expect(slot).toEqual({ capacity_weekend: null, deadline_days: null });
  });

  it('コースを複製できる（(コピー)付き・無効状態で作成、リソースと時間帯設定も複製）', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}/copy`, form({}, cookie), env);
    expect(res.status).toBe(302);
    const copy = await env.DB.prepare(`SELECT id, active, price_adult, duration_min FROM plans WHERE name = 'プランA (コピー)'`)
      .first<{ id: number; active: number; price_adult: number; duration_min: number }>();
    expect(copy?.active).toBe(0);
    expect(copy?.price_adult).toBe(8000);
    const slots = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plan_slots WHERE plan_id = ?`).bind(copy!.id).first<{ n: number }>();
    expect(slots?.n).toBe(2);
    const resources = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plan_resources WHERE plan_id = ?`).bind(copy!.id).first<{ n: number }>();
    expect(resources?.n).toBe(1);
  });

  it('アーカイブと復帰ができる', async () => {
    let res = await app.request(`/admin/plans/${PLAN_A}/archive`, form({}, cookie), env);
    expect(res.status).toBe(302);
    let plan = await env.DB.prepare(`SELECT active FROM plans WHERE id = ?`).bind(PLAN_A).first<{ active: number }>();
    expect(plan?.active).toBe(0);
    res = await app.request(`/admin/plans/${PLAN_A}/restore`, form({}, cookie), env);
    plan = await env.DB.prepare(`SELECT active FROM plans WHERE id = ?`).bind(PLAN_A).first<{ active: number }>();
    expect(plan?.active).toBe(1);
  });

  it('日別詳細の空き状況ヘッダに略称が使われる', async () => {
    await app.request(`/admin/plans/${PLAN_A}`, form(FULL, cookie), env);
    const html = await (await app.request('/admin/day/2026-08-01', { headers: { cookie } }, env)).text();
    expect(html).toContain('>体験<');
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  - plans編集フォーム: `short_name`（任意）、時間帯ごとに `slot_capacity_weekend_{id}`（任意・placeholder `平日と同じ`）、`slot_deadline_days_{id}`（任意）、`slot_deadline_time_{id}`（任意・type=time）。空文字→NULL。activeな時間帯のupsert文を5列に拡張（`ON CONFLICT ... DO UPDATE SET capacity, capacity_weekend, deadline_days, deadline_time, active`）。非activeは従来どおり active=0 のみ
  - 新規作成フォームにも `short_name` を追加（任意）
  - 一覧: 略称列、各行に `複製` フォーム（POST `/admin/plans/:id/copy`）、activeなら `アーカイブ`（`/archive`）・無効なら `復帰`（`/restore`）ボタン。無効プランは `row-muted`
  - POST `/copy`: プラン行を複製（name = `{元名} (コピー)`、active=0、sort_order=max+1）→ plan_resources / plan_slots も複製 → `/admin/plans?ok=copied`（メッセージ `コースを複製しました（無効状態）`）。db.batchで
  - POST `/archive` / `/restore`: active更新 → `?ok=archived|restored`
  - 日別詳細の空き状況表の列ヘッダと予約枠(slots.tsx)の行ラベル: `short_name が非空ならそれ、なければ name`（`{p.short_name || p.name}`）。プラン名のフル表記は他画面では変更しない
- [ ] **Step 4: 全テストgreen**（154件） → Commit `feat: プラン管理v2(略称・週末定員・締切・複製・アーカイブ)`

---

### Task 4: 料金カレンダー

**Files:** Modify `src/routes/admin/plans.tsx`; Create `test/admin-prices.test.ts`

- [ ] **Step 1: 失敗するテスト**

`test/admin-prices.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin price calendar', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('期間指定で日別単価を一括登録できる', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}/prices`, form({
      from: '2026-08-10', to: '2026-08-12', price_adult: '9500', price_child: '5000'
    }, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM price_overrides WHERE plan_id = ?`).bind(PLAN_A).first<{ n: number }>();
    expect(n?.n).toBe(3);
    const page = await (await app.request(`/admin/plans/${PLAN_A}/prices`, { headers: { cookie } }, env)).text();
    expect(page).toContain('2026-08-10');
    expect(page).toContain('9500');
  });

  it('同じ日への再登録は上書き（重複しない）', async () => {
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9500', price_child: '5000' }, cookie), env);
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9000', price_child: '4500' }, cookie), env);
    const rows = await env.DB.prepare(`SELECT price_adult FROM price_overrides WHERE plan_id = ? AND date = '2026-08-10'`).bind(PLAN_A).all<{ price_adult: number }>();
    expect(rows.results).toEqual([{ price_adult: 9000 }]);
  });

  it('削除できる', async () => {
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9500', price_child: '5000' }, cookie), env);
    const res = await app.request(`/admin/plans/${PLAN_A}/prices/delete`, form({ date: '2026-08-10' }, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM price_overrides`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('上書き日の予約は自動計算・スナップショットに反映される', async () => {
    await app.request(`/admin/plans/${PLAN_A}/prices`, form({ from: '2026-08-10', to: '2026-08-10', price_adult: '9500', price_child: '5000' }, cookie), env);
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-10',
      customer_name: '特別料金の客', customer_phone: '', num_adults: '2', num_children: '1',
      total_amount: '', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    const row = await env.DB.prepare(`SELECT total_amount, price_adult FROM bookings WHERE customer_name = '特別料金の客'`)
      .first<{ total_amount: number; price_adult: number }>();
    expect(row).toEqual({ total_amount: 9500 * 2 + 5000, price_adult: 9500 });
  });

  it('30日超の期間は error=invalid', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}/prices`, form({
      from: '2026-08-01', to: '2026-10-01', price_adult: '9500', price_child: '5000'
    }, cookie), env);
    expect(res.headers.get('location')).toContain('error=invalid');
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  plans.tsx に GET/POST `/:id/prices`・POST `/:id/prices/delete`。GET: 見出し `{プラン名} 料金カレンダー`、基本単価表示、登録フォーム（from/to/price_adult/price_child）、登録済み一覧（日付昇順・今日以降のみ・単価・削除ボタン）。POST: 日付検証・from≦to・**期間は最大31日**・単価0以上 → 各日をdb.batchで `INSERT ... ON CONFLICT(date, plan_id) DO UPDATE SET price_adult = excluded.price_adult, price_child = excluded.price_child` → `?ok=1`。delete: date検証→DELETE。プラン一覧・編集ページに `料金カレンダー` リンク
- [ ] **Step 4: 全テストgreen**（159件） → Commit `feat: 料金カレンダー(日別単価の一括上書き)`

---

### Task 5: 予約締切の代理店適用

**Files:** Modify `src/routes/agency.tsx`; Create `test/agency-deadline.test.ts`

- [ ] **Step 1: 失敗するテスト**

`test/agency-deadline.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

const TOKEN = 'test-agency-token-0123456789abcdef';

function form(data: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  };
}

// 参加日の9999日前が締切 = 実質常に締切超過
async function setHugeDeadline() {
  await env.DB.prepare(
    `UPDATE plan_slots SET deadline_days = 9999, deadline_time = '18:00' WHERE plan_id = ? AND slot_type_id = ?`
  ).bind(PLAN_A, SLOT_AM).run();
}

describe('agency deadline', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('締切超過の枠は代理店から予約できない', async () => {
    await setHugeDeadline();
    const res = await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '締切後の客', customer_phone: '', num_adults: '1', num_children: '0', notes: ''
    }), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?error=deadline`);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('締切超過の枠は空き表で「締切」表示になる', async () => {
    await setHugeDeadline();
    const html = await (await app.request(`/a/${TOKEN}`, {}, env)).text();
    expect(html).toContain('締切');
  });

  it('締切設定がなければ従来どおり予約できる', async () => {
    const res = await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '通常の客', customer_phone: '', num_adults: '1', num_children: '0', notes: ''
    }), env);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?ok=requested`);
  });

  it('管理画面の手入力は締切後も可能（回帰）', async () => {
    await setHugeDeadline();
    const { adminCookie } = await import('./helpers');
    const cookie = await adminCookie();
    const res = await app.request('/admin/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
        customer_name: '電話の客', customer_phone: '', num_adults: '1', num_children: '0',
        total_amount: '0', payment_method: 'onsite_cash', notes: ''
      }).toString()
    }, env);
    expect(res.headers.get('location')).toBe('/admin/day/2026-08-01?ok=created');
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  agency.tsx: plan_slots の deadline_days/deadline_time を取得し、
  - 空き表: status open でも `!isBeforeDeadline(date, ...)` なら class `off`・テキスト `締切`
  - 予約POST: 対象 plan×slot の締切チェックを createBooking 前に実施 → 超過なら `?error=deadline`。ERROR_MESSAGES に `deadline: '予約締切を過ぎています。お電話にてお問い合わせください'`
- [ ] **Step 4: 全テストgreen**（163件） → Commit `feat: 予約締切の代理店ページ適用(表示・受付拒否)`

---

### Task 6: 予約時取得項目（プラン別カスタム入力欄）

**Files:** Modify `src/routes/admin/plans.tsx`（項目CRUD）, `src/routes/admin/calendar.tsx`・`src/routes/admin/new-booking.tsx`・`src/routes/agency.tsx`（フォーム描画＋保存）, `src/routes/admin/lists.tsx`（today表示）, `src/routes/admin/stats.tsx`（CSV列）; Create `test/plan-fields.test.ts`; Modify `test/admin-export.test.ts`（許可済みのヘッダassertのみ）

- [ ] **Step 1: 失敗するテスト**

`test/plan-fields.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

const TOKEN = 'test-agency-token-0123456789abcdef';

function form(data: Record<string, string>, cookie = '') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(data).toString()
  };
}

describe('plan custom fields', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  async function addField(label: string, required = false): Promise<number> {
    await app.request(`/admin/plans/${PLAN_A}/fields`, form({ label, required: required ? '1' : '' }, cookie), env);
    const row = await env.DB.prepare(`SELECT id FROM plan_fields WHERE label = ?`).bind(label).first<{ id: number }>();
    return row!.id;
  }

  it('項目を追加・削除でき、編集ページに表示される', async () => {
    const id = await addField('レンタル希望');
    const page = await (await app.request(`/admin/plans/${PLAN_A}/edit`, { headers: { cookie } }, env)).text();
    expect(page).toContain('レンタル希望');
    const res = await app.request(`/admin/plans/${PLAN_A}/fields/${id}/delete`, form({}, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plan_fields WHERE active = 1`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('管理画面の予約でカスタム項目が保存され、日別詳細に表示される', async () => {
    const id = await addField('レンタル希望');
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '項目付きの客', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: '', [`field_${id}`]: 'ウェット2着'
    }, cookie), env);
    const row = await env.DB.prepare(`SELECT custom_fields FROM bookings WHERE customer_name = '項目付きの客'`)
      .first<{ custom_fields: string }>();
    expect(JSON.parse(row!.custom_fields)).toEqual([{ label: 'レンタル希望', value: 'ウェット2着' }]);
    const day = await (await app.request('/admin/day/2026-08-01', { headers: { cookie } }, env)).text();
    expect(day).toContain('ウェット2着');
  });

  it('必須項目が空だと error=invalid', async () => {
    await addField('集合場所', true);
    const res = await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '必須漏れ', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    expect(res.headers.get('location')).toContain('error=invalid');
  });

  it('別プランの項目は要求されない（プランDの予約にプランAの必須項目は無関係）', async () => {
    await addField('集合場所', true);
    const res = await app.request('/admin/bookings', form({
      plan_id: '4', slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '別プランの客', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    expect(res.headers.get('location')).toBe('/admin/day/2026-08-01?ok=created');
  });

  it('代理店ページでも入力・保存できる', async () => {
    const id = await addField('お客様の年齢層');
    await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: '代理店項目', customer_phone: '', num_adults: '1', num_children: '0', notes: '',
      [`field_${id}`]: '30代中心'
    }), env);
    const row = await env.DB.prepare(`SELECT custom_fields FROM bookings WHERE customer_name = '代理店項目'`)
      .first<{ custom_fields: string }>();
    expect(JSON.parse(row!.custom_fields)).toEqual([{ label: 'お客様の年齢層', value: '30代中心' }]);
  });

  it('CSVに追加項目列が出る', async () => {
    const id = await addField('レンタル希望');
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: '2026-08-01',
      customer_name: 'CSV確認', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: '', [`field_${id}`]: 'あり'
    }, cookie), env);
    const res = await app.request('/admin/stats/export.csv?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env);
    const body = await res.text();
    expect(body).toContain('追加項目');
    expect(body).toContain('レンタル希望:あり');
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  - plans編集ページに `予約時取得項目` セクション: activeな項目一覧（ラベル・必須マーク・削除ボタン=POST `/admin/plans/:id/fields/:fieldId/delete` → active=0の論理削除）＋追加フォーム（`label` 必須・`required` checkbox → POST `/admin/plans/:id/fields`、sort_orderはmax+1）
  - 予約フォーム3箇所（管理:日別・新規予約、代理店）: 全activeプランの項目を `<div class="cf-group" data-plan="{planId}">` で描画（input name=`field_{id}`、必須はラベルに `*`。HTML requiredは付けない）。`<script>` でプランselectのchangeに応じ該当グループのみ表示（初期表示は選択中プラン）
  - POST側（calendar.tsx POST /bookings・agency.tsx 予約POST）: 選択プランのactive項目を取得→ requiredで値空なら `error=invalid` → `[{label, value}]`（値空の項目は含めない）を `custom_fields` に保存（createBookingのINSERT列に追加。`NewBooking` に `customFields?: { label: string; value: string }[]` を追加し、JSON.stringifyして保存。既定 '[]'）
  - 表示: 日別詳細の予約行（備考の下に小さく `label: value` 並記）・本日の台帳・編集ページ（読み取り表示のみ、編集は不可と注記）
  - CSV: 列 `追加項目` を末尾に追加（`label:value / label:value` 形式）。`test/admin-export.test.ts` のヘッダassertのみ許可どおり更新
- [ ] **Step 4: 全テストgreen**（169件） → Commit `feat: 予約時取得項目(プラン別カスタム入力・CSV出力対応)`

---

### Task 7: 仕上げ（コントローラ実施）

- [ ] README更新 → 全テスト → 目視確認 → mainマージ → push → **本番マイグレーション** `wrangler d1 migrations apply booking-system --remote`（0002のみ適用されること） → `wrangler deploy` → 本番smoke

## 完了条件

- 169テストgreen・typecheckクリーン
- 本番で: プラン編集に新項目、料金カレンダー・複製・アーカイブが動作、代理店ページで締切表示
