# 予約管理システム ステップ1（基盤＋コアロジック）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers + Hono + D1 のプロジェクト基盤を作り、コース連動在庫のコアロジック（空き状況計算・アトミック予約登録・キャンセル・変更）と管理者認証を、網羅的テスト付きで完成させる。

**Architecture:** 単一のWorkersプロジェクト。空き状況は予約データからの導出値として計算し、クローズ/オープン状態は保存しない。予約の登録・変更は空き条件をWHERE句に含めた1文のSQLで実行し、ダブルブッキングを構造的に排除する。画面はステップ2以降（本ステップはヘルスチェックとログイン画面のみ）。

**Tech Stack:** TypeScript / Hono 4 / Cloudflare Workers / D1 (SQLite) / vitest + @cloudflare/vitest-pool-workers

**参照スペック:** `docs/superpowers/specs/2026-07-07-booking-system-design.md`

**前提:** Node.js 20+ と npm がインストール済み。作業ディレクトリはリポジトリルート（`booking-system/`）。

---

## ファイル構成（このステップで作るもの）

| パス | 責務 |
|---|---|
| `package.json` / `tsconfig.json` / `wrangler.jsonc` / `vitest.config.ts` / `.gitignore` / `.dev.vars.example` | プロジェクト設定 |
| `migrations/0001_init.sql` | 全テーブルのDDL |
| `src/types.ts` | Bindings型・ドメイン型（1箇所で定義し全員が参照） |
| `src/core/availability.ts` | 空き状況の導出計算（読み取り専用） |
| `src/core/booking.ts` | 予約の登録・キャンセル・変更（アトミック書き込み） |
| `src/auth/session.ts` | HMAC署名Cookieセッション（純関数） |
| `src/routes/admin.tsx` | 管理者ログイン/ログアウト/認証ミドルウェア |
| `src/index.ts` | Honoアプリ本体（ルート結線） |
| `test/apply-migrations.ts` / `test/env.d.ts` / `test/fixtures.ts` | テスト基盤・共通シード |
| `test/availability.test.ts` / `test/booking.test.ts` / `test/session.test.ts` / `test/admin-auth.test.ts` | テスト |

---

### Task 1: プロジェクト雛形とテスト基盤

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`, `.dev.vars.example`, `src/index.ts`, `src/types.ts`, `test/apply-migrations.ts`, `test/env.d.ts`, `test/smoke.test.ts`, `migrations/0001_init.sql`（空ファイルではなくコメントのみの仮置き）

- [ ] **Step 1: 設定ファイル一式を作成**

`package.json`:
```json
{
  "name": "booking-system",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`wrangler.jsonc`:
```jsonc
{
  "name": "booking-system",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "booking-system",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
}
```
（`database_id` はローカル開発・テストではプレースホルダで動く。本番IDはステップ4のデプロイ時に `wrangler d1 create` の結果で差し替える）

`vitest.config.ts`:
```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrationsPath = new URL('./migrations', import.meta.url).pathname;
  const migrations = await readD1Migrations(migrationsPath);
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ADMIN_PASSWORD: 'test-password',
              SESSION_SECRET: 'test-secret'
            }
          }
        }
      }
    }
  };
});
```

`.gitignore`:
```
node_modules/
.wrangler/
.dev.vars
dist/
```

`.dev.vars.example`（ローカル開発用シークレットの見本。実物は `.dev.vars` にコピーして使う）:
```
ADMIN_PASSWORD=changeme
SESSION_SECRET=changeme-long-random-string
```

`migrations/0001_init.sql`（仮置き。Task 2で本実装）:
```sql
-- スキーマはTask 2で定義する
```

- [ ] **Step 2: エントリポイントとテスト基盤を作成**

`src/types.ts`:
```ts
export type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
};

export type PaymentMethod = 'onsite_cash' | 'onsite_card' | 'invoice' | 'stripe';

export interface NewBooking {
  planId: number;
  date: string; // 'YYYY-MM-DD'
  slotTypeId: number;
  agencyId?: number | null;
  customerName: string;
  customerPhone?: string;
  partySize: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
  createdBy: 'admin' | 'agency';
}

export type BookingResult =
  | { ok: true; bookingId: number }
  | { ok: false; reason: 'slot_unavailable' };

export type SlotStatus = 'open' | 'full' | 'linked_closed' | 'manual_closed';

export interface SlotAvailability {
  planId: number;
  date: string;
  slotTypeId: number;
  status: SlotStatus;
  capacity: number;
  booked: number;
  remaining: number;
  blockingPlanIds: number[]; // linked_closed の原因プラン（それ以外は空配列）
}
```

`src/index.ts`:
```ts
import { Hono } from 'hono';
import type { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ ok: true }));

export default app;
```

`test/apply-migrations.ts`:
```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`test/env.d.ts`:
```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    ADMIN_PASSWORD: string;
    SESSION_SECRET: string;
  }
}
```

`test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';

describe('smoke', () => {
  it('GET /health が ok を返す', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: 依存パッケージをインストール**

Run:
```bash
npm install hono
npm install -D wrangler typescript @cloudflare/workers-types vitest@~3.2.0 @cloudflare/vitest-pool-workers
```
Expected: エラーなく完了。もし `@cloudflare/vitest-pool-workers` が vitest のバージョン不一致を報告したら、エラーメッセージが要求する vitest バージョンに合わせて入れ直す（pool-workers側を優先）。

- [ ] **Step 4: テストと型チェックを実行**

Run: `npm test && npm run typecheck`
Expected: smoke.test.ts が 1 passed。typecheck エラーなし。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: Cloudflare Workers + Hono + vitest プロジェクト雛形"
```

---

### Task 2: DBスキーマとテストフィクスチャ

**Files:**
- Modify: `migrations/0001_init.sql`
- Create: `test/fixtures.ts`, `test/schema.test.ts`

- [ ] **Step 1: 失敗するスキーマテストを書く**

`test/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('schema', () => {
  it('全テーブルが存在する', async () => {
    const res = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name`
    ).all<{ name: string }>();
    expect(res.results.map((r) => r.name)).toEqual([
      'agencies', 'bookings', 'email_log', 'plan_resources',
      'plan_slots', 'plans', 'resources', 'slot_closures', 'slot_types'
    ]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- schema`
Expected: FAIL（テーブルが存在しない）

- [ ] **Step 3: マイグレーションを実装**

`migrations/0001_init.sql` を以下で置き換える:
```sql
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE plan_resources (
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  PRIMARY KEY (plan_id, resource_id)
);

CREATE TABLE slot_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plan_slots (
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  slot_type_id INTEGER NOT NULL REFERENCES slot_types(id),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (plan_id, slot_type_id)
);

CREATE TABLE slot_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot_type_id INTEGER NOT NULL REFERENCES slot_types(id),
  plan_id INTEGER REFERENCES plans(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_slot_closures_date ON slot_closures (date, slot_type_id);

CREATE TABLE agencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  date TEXT NOT NULL,
  slot_type_id INTEGER NOT NULL REFERENCES slot_types(id),
  agency_id INTEGER REFERENCES agencies(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  total_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'onsite_cash' CHECK (payment_method IN ('onsite_cash', 'onsite_card', 'invoice', 'stripe')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL CHECK (created_by IN ('admin', 'agency')),
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_bookings_slot ON bookings (date, slot_type_id, status);
CREATE INDEX idx_bookings_agency ON bookings (agency_id, date);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id),
  to_address TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 4: 共通フィクスチャを作成**

`test/fixtures.ts`:
```ts
import type { NewBooking } from '../src/types';

// シナリオ: プランA・B・Cはインストラクター1を共有（コース連動）。プランDは独立リソース（ボート1）。
export const PLAN_A = 1;
export const PLAN_B = 2;
export const PLAN_C = 3;
export const PLAN_D = 4;
export const SLOT_AM = 1;
export const SLOT_PM = 2;
export const AGENCY_1 = 1;
export const CAP_A = 6;
export const CAP_B = 4;

export async function seedBasic(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`INSERT INTO resources (id, name) VALUES (1, 'インストラクター1'), (2, 'ボート1')`),
    db.prepare(`INSERT INTO plans (id, name, price) VALUES
      (1, 'プランA', 8000), (2, 'プランB', 10000), (3, 'プランC', 12000), (4, 'プランD', 6000)`),
    db.prepare(`INSERT INTO plan_resources (plan_id, resource_id) VALUES (1, 1), (2, 1), (3, 1), (4, 2)`),
    db.prepare(`INSERT INTO slot_types (id, name, start_time, sort_order) VALUES
      (1, '午前便', '09:00', 1), (2, '午後便', '13:00', 2)`),
    db.prepare(`INSERT INTO plan_slots (plan_id, slot_type_id, capacity) VALUES
      (1, 1, 6), (1, 2, 6), (2, 1, 4), (2, 2, 4), (3, 1, 6), (3, 2, 6), (4, 1, 8), (4, 2, 8)`),
    db.prepare(`INSERT INTO agencies (id, name, token, email, created_at) VALUES
      (1, 'テスト代理店', 'test-agency-token-0123456789abcdef', 'agency@example.com', '2026-07-07T00:00:00.000Z')`)
  ]);
}

export function makeBooking(overrides: Partial<NewBooking> = {}): NewBooking {
  return {
    planId: PLAN_A,
    date: '2026-08-01',
    slotTypeId: SLOT_AM,
    customerName: 'テスト太郎',
    customerPhone: '090-0000-0000',
    partySize: 2,
    totalAmount: 16000,
    paymentMethod: 'onsite_cash',
    createdBy: 'admin',
    ...overrides
  };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: schema / smoke とも PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: DBスキーマ（全9テーブル）とテストフィクスチャ"
```

---

### Task 3: 空き状況計算（コース連動の導出ロジック）

**Files:**
- Create: `src/core/availability.ts`, `test/availability.test.ts`

このタスクではまだ `createBooking` が無いので、テスト内では直接SQLで予約行を挿入するヘルパーを使う。

- [ ] **Step 1: 失敗するテストを書く**

`test/availability.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getAvailability } from '../src/core/availability';
import { seedBasic, PLAN_A, PLAN_B, PLAN_C, PLAN_D, SLOT_AM, SLOT_PM, CAP_A } from './fixtures';

const D = '2026-08-01';

async function insertBooking(planId: number, date: string, slotTypeId: number, partySize: number, status = 'confirmed'): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO bookings (plan_id, date, slot_type_id, status, customer_name, party_size, created_by, created_at)
     VALUES (?, ?, ?, ?, 'テスト', ?, 'admin', '2026-07-07T00:00:00.000Z')`
  ).bind(planId, date, slotTypeId, status, partySize).run();
  return res.meta.last_row_id;
}

function slot(avail: Awaited<ReturnType<typeof getAvailability>>, planId: number, date: string, slotTypeId: number) {
  const found = avail.find((a) => a.planId === planId && a.date === date && a.slotTypeId === slotTypeId);
  if (!found) throw new Error(`slot not found: plan=${planId} ${date} slot=${slotTypeId}`);
  return found;
}

describe('getAvailability', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('予約なし: 全プラン・全時間帯が open で残席=定員', async () => {
    const avail = await getAvailability(env.DB, D, D);
    expect(avail).toHaveLength(8); // 4プラン × 2時間帯 × 1日
    const a = slot(avail, PLAN_A, D, SLOT_AM);
    expect(a.status).toBe('open');
    expect(a.remaining).toBe(CAP_A);
  });

  it('コース連動: プランAに予約1件で、同時間帯のB・Cが linked_closed になり原因プランが分かる', async () => {
    await insertBooking(PLAN_A, D, SLOT_AM, 2);
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_A, D, SLOT_AM).status).toBe('open'); // A自体は定員まで受付可
    expect(slot(avail, PLAN_A, D, SLOT_AM).remaining).toBe(CAP_A - 2);
    expect(slot(avail, PLAN_B, D, SLOT_AM).status).toBe('linked_closed');
    expect(slot(avail, PLAN_B, D, SLOT_AM).blockingPlanIds).toEqual([PLAN_A]);
    expect(slot(avail, PLAN_C, D, SLOT_AM).status).toBe('linked_closed');
    // リソースを共有しないプランDは影響なし
    expect(slot(avail, PLAN_D, D, SLOT_AM).status).toBe('open');
    // 午後便は影響なし
    expect(slot(avail, PLAN_B, D, SLOT_PM).status).toBe('open');
  });

  it('満席: 定員ちょうどまで予約が入ると full', async () => {
    await insertBooking(PLAN_A, D, SLOT_AM, CAP_A);
    const avail = await getAvailability(env.DB, D, D);
    const a = slot(avail, PLAN_A, D, SLOT_AM);
    expect(a.status).toBe('full');
    expect(a.remaining).toBe(0);
  });

  it('キャンセル済み予約は無視される（自動オープン）', async () => {
    const id = await insertBooking(PLAN_A, D, SLOT_AM, 2);
    await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = '2026-07-07T01:00:00.000Z' WHERE id = ?`).bind(id).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_B, D, SLOT_AM).status).toBe('open');
    expect(slot(avail, PLAN_A, D, SLOT_AM).remaining).toBe(CAP_A);
  });

  it('全プラン向け手動クローズ（plan_id = NULL）で対象時間帯の全プランが manual_closed', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, NULL, '休業', '2026-07-07T00:00:00.000Z')`
    ).bind(D, SLOT_AM).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_A, D, SLOT_AM).status).toBe('manual_closed');
    expect(slot(avail, PLAN_D, D, SLOT_AM).status).toBe('manual_closed');
    expect(slot(avail, PLAN_A, D, SLOT_PM).status).toBe('open');
  });

  it('プラン指定の手動クローズは対象プランのみ manual_closed', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, ?, 'メンテ', '2026-07-07T00:00:00.000Z')`
    ).bind(D, SLOT_AM, PLAN_A).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(slot(avail, PLAN_A, D, SLOT_AM).status).toBe('manual_closed');
    expect(slot(avail, PLAN_B, D, SLOT_AM).status).toBe('open');
  });

  it('無効化されたプランは結果に含まれない', async () => {
    await env.DB.prepare(`UPDATE plans SET active = 0 WHERE id = ?`).bind(PLAN_D).run();
    const avail = await getAvailability(env.DB, D, D);
    expect(avail.filter((a) => a.planId === PLAN_D)).toHaveLength(0);
  });

  it('日付範囲: 3日分を要求すると日数分の結果が返る', async () => {
    const avail = await getAvailability(env.DB, '2026-08-01', '2026-08-03');
    expect(avail).toHaveLength(8 * 3);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- availability`
Expected: FAIL（`getAvailability` が存在しない）

- [ ] **Step 3: 実装**

`src/core/availability.ts`:
```ts
import type { SlotAvailability, SlotStatus } from '../types';

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function getAvailability(db: D1Database, from: string, to: string): Promise<SlotAvailability[]> {
  const [planSlots, closures, booked, planResources] = await Promise.all([
    db.prepare(
      `SELECT ps.plan_id AS planId, ps.slot_type_id AS slotTypeId, ps.capacity
       FROM plan_slots ps JOIN plans p ON p.id = ps.plan_id
       WHERE ps.active = 1 AND p.active = 1`
    ).all<{ planId: number; slotTypeId: number; capacity: number }>(),
    db.prepare(
      `SELECT date, slot_type_id AS slotTypeId, plan_id AS planId
       FROM slot_closures WHERE date BETWEEN ?1 AND ?2`
    ).bind(from, to).all<{ date: string; slotTypeId: number; planId: number | null }>(),
    db.prepare(
      `SELECT plan_id AS planId, date, slot_type_id AS slotTypeId, SUM(party_size) AS booked
       FROM bookings WHERE status = 'confirmed' AND date BETWEEN ?1 AND ?2
       GROUP BY plan_id, date, slot_type_id`
    ).bind(from, to).all<{ planId: number; date: string; slotTypeId: number; booked: number }>(),
    db.prepare(`SELECT plan_id AS planId, resource_id AS resourceId FROM plan_resources`)
      .all<{ planId: number; resourceId: number }>()
  ]);

  const resourcesByPlan = new Map<number, number[]>();
  for (const pr of planResources.results) {
    const list = resourcesByPlan.get(pr.planId) ?? [];
    list.push(pr.resourceId);
    resourcesByPlan.set(pr.planId, list);
  }

  const bookedByPlanSlot = new Map<string, number>();
  const plansBookedInSlot = new Map<string, number[]>();
  for (const b of booked.results) {
    bookedByPlanSlot.set(`${b.planId}|${b.date}|${b.slotTypeId}`, b.booked);
    const key = `${b.date}|${b.slotTypeId}`;
    const list = plansBookedInSlot.get(key) ?? [];
    list.push(b.planId);
    plansBookedInSlot.set(key, list);
  }

  const globalClosures = new Set<string>();
  const planClosures = new Set<string>();
  for (const cl of closures.results) {
    if (cl.planId === null) globalClosures.add(`${cl.date}|${cl.slotTypeId}`);
    else planClosures.add(`${cl.date}|${cl.slotTypeId}|${cl.planId}`);
  }

  const out: SlotAvailability[] = [];
  for (const date of datesBetween(from, to)) {
    for (const ps of planSlots.results) {
      const bookedCount = bookedByPlanSlot.get(`${ps.planId}|${date}|${ps.slotTypeId}`) ?? 0;
      let status: SlotStatus;
      let blockingPlanIds: number[] = [];

      if (globalClosures.has(`${date}|${ps.slotTypeId}`) || planClosures.has(`${date}|${ps.slotTypeId}|${ps.planId}`)) {
        status = 'manual_closed';
      } else {
        const myResources = new Set(resourcesByPlan.get(ps.planId) ?? []);
        const others = (plansBookedInSlot.get(`${date}|${ps.slotTypeId}`) ?? []).filter(
          (pid) => pid !== ps.planId && (resourcesByPlan.get(pid) ?? []).some((r) => myResources.has(r))
        );
        if (others.length > 0) {
          status = 'linked_closed';
          blockingPlanIds = others;
        } else if (bookedCount >= ps.capacity) {
          status = 'full';
        } else {
          status = 'open';
        }
      }

      out.push({
        planId: ps.planId,
        date,
        slotTypeId: ps.slotTypeId,
        status,
        capacity: ps.capacity,
        booked: bookedCount,
        remaining: Math.max(0, ps.capacity - bookedCount),
        blockingPlanIds
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- availability`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 空き状況の導出計算（コース連動・手動クローズ・満席判定）"
```

---

### Task 4: 予約登録（アトミックINSERT）

**Files:**
- Create: `src/core/booking.ts`, `test/booking.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/booking.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBooking } from '../src/core/booking';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, PLAN_D, SLOT_AM, SLOT_PM, AGENCY_1, CAP_B } from './fixtures';

const D = '2026-08-01';

describe('createBooking', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('空き枠に予約でき、行がconfirmedで保存される', async () => {
    const result = await createBooking(env.DB, makeBooking());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(result.bookingId)
      .first<{ status: string; plan_id: number; party_size: number; payment_status: string }>();
    expect(row?.status).toBe('confirmed');
    expect(row?.plan_id).toBe(PLAN_A);
    expect(row?.party_size).toBe(2);
    expect(row?.payment_status).toBe('unpaid');
  });

  it('代理店予約: agency_id と created_by が保存される', async () => {
    const result = await createBooking(env.DB, makeBooking({ agencyId: AGENCY_1, createdBy: 'agency' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await env.DB.prepare(`SELECT agency_id, created_by FROM bookings WHERE id = ?`)
      .bind(result.bookingId).first<{ agency_id: number; created_by: string }>();
    expect(row).toEqual({ agency_id: AGENCY_1, created_by: 'agency' });
  });

  it('コース連動: プランAに予約後、同時間帯のプランBは予約不可', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(true);
    const result = await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }));
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
  });

  it('コース連動: リソースが違うプランD・別時間帯のプランBは予約可能', async () => {
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_D }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_PM }))).ok).toBe(true);
  });

  it('同一プランへの追加予約は定員まで可能（相乗り）、超過は不可', async () => {
    // プランB定員4: 3名 + 1名 = OK、さらに1名は超過
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: 3 }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: 1 }))).ok).toBe(true);
    const over = await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: 1 }));
    expect(over).toEqual({ ok: false, reason: 'slot_unavailable' });
    const sum = await env.DB.prepare(
      `SELECT SUM(party_size) AS n FROM bookings WHERE plan_id = ? AND date = ? AND slot_type_id = ? AND status = 'confirmed'`
    ).bind(PLAN_B, D, SLOT_AM).first<{ n: number }>();
    expect(sum?.n).toBe(CAP_B); // 定員ちょうどで止まっている
  });

  it('1件で定員超過する人数は不可', async () => {
    const result = await createBooking(env.DB, makeBooking({ planId: PLAN_B, partySize: CAP_B + 1 }));
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
  });

  it('手動クローズされた枠には予約不可', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, NULL, '休業', '2026-07-07T00:00:00.000Z')`
    ).bind(D, SLOT_AM).run();
    const result = await createBooking(env.DB, makeBooking());
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
  });

  it('無効化されたプラン・催行のない時間帯には予約不可', async () => {
    await env.DB.prepare(`UPDATE plans SET active = 0 WHERE id = ?`).bind(PLAN_A).run();
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(false);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: 99 }))).ok).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- booking`
Expected: FAIL（`createBooking` が存在しない）

- [ ] **Step 3: 実装**

`src/core/booking.ts`:
```ts
import type { BookingResult, NewBooking } from '../types';

function nowIso(): string {
  return new Date().toISOString();
}

// 予約可能条件（WHERE句の断片）。スペック4章の①〜④に対応。
// excludeBookingId は予約変更時に「自分自身の予約」を人数・リソース判定から除外するために使う。
function slotOpenCond(
  v: { planId: number; date: string; slotTypeId: number; partySize: number },
  excludeBookingId: number | null
): { sql: string; params: (string | number | null)[] } {
  const ex = excludeBookingId;
  return {
    sql: `
      EXISTS (SELECT 1 FROM plan_slots ps JOIN plans p ON p.id = ps.plan_id
              WHERE ps.plan_id = ? AND ps.slot_type_id = ? AND ps.active = 1 AND p.active = 1)
      AND NOT EXISTS (SELECT 1 FROM slot_closures sc
              WHERE sc.date = ? AND sc.slot_type_id = ? AND (sc.plan_id IS NULL OR sc.plan_id = ?))
      AND (SELECT COALESCE(SUM(b.party_size), 0) FROM bookings b
              WHERE b.plan_id = ? AND b.date = ? AND b.slot_type_id = ? AND b.status = 'confirmed'
                AND (? IS NULL OR b.id != ?)) + ?
          <= (SELECT ps.capacity FROM plan_slots ps WHERE ps.plan_id = ? AND ps.slot_type_id = ?)
      AND NOT EXISTS (SELECT 1 FROM bookings b
              JOIN plan_resources pr_o ON pr_o.plan_id = b.plan_id
              JOIN plan_resources pr_m ON pr_m.resource_id = pr_o.resource_id
              WHERE pr_m.plan_id = ? AND b.date = ? AND b.slot_type_id = ? AND b.status = 'confirmed'
                AND b.plan_id != ? AND (? IS NULL OR b.id != ?))`,
    params: [
      v.planId, v.slotTypeId,
      v.date, v.slotTypeId, v.planId,
      v.planId, v.date, v.slotTypeId, ex, ex, v.partySize, v.planId, v.slotTypeId,
      v.planId, v.date, v.slotTypeId, v.planId, ex, ex
    ]
  };
}

export async function createBooking(db: D1Database, nb: NewBooking): Promise<BookingResult> {
  const cond = slotOpenCond(nb, null);
  const res = await db.prepare(
    `INSERT INTO bookings (plan_id, date, slot_type_id, agency_id, status, customer_name, customer_phone,
                           party_size, total_amount, payment_method, payment_status, notes, created_by, created_at)
     SELECT ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?
     WHERE ${cond.sql}`
  ).bind(
    nb.planId, nb.date, nb.slotTypeId, nb.agencyId ?? null, nb.customerName, nb.customerPhone ?? '',
    nb.partySize, nb.totalAmount, nb.paymentMethod, nb.notes ?? '', nb.createdBy, nowIso(),
    ...cond.params
  ).run();

  if (res.meta.changes !== 1) return { ok: false, reason: 'slot_unavailable' };
  return { ok: true, bookingId: res.meta.last_row_id };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- booking`
Expected: 8 passed（既存テストも含め全体で `npm test` がPASSであること）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: アトミックな予約登録（空き条件をWHERE句に含めた1文INSERT）"
```

---

### Task 5: キャンセルと自動オープン

**Files:**
- Modify: `src/core/booking.ts`（`cancelBooking` を追加）
- Modify: `test/booking.test.ts`（describe を追加）

- [ ] **Step 1: 失敗するテストを書く**

`test/booking.test.ts` の末尾に追加:
```ts
import { cancelBooking } from '../src/core/booking';
import { getAvailability } from '../src/core/availability';
// （既存importに統合すること）

describe('cancelBooking', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('キャンセルすると cancelled になり cancelled_at が記録される', async () => {
    const created = await createBooking(env.DB, makeBooking());
    if (!created.ok) throw new Error('setup failed');
    expect(await cancelBooking(env.DB, created.bookingId)).toBe(true);
    const row = await env.DB.prepare(`SELECT status, cancelled_at FROM bookings WHERE id = ?`)
      .bind(created.bookingId).first<{ status: string; cancelled_at: string | null }>();
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelled_at).not.toBeNull();
  });

  it('自動オープン: プランAの予約キャンセル後、連動クローズされていたプランBに予約できる', async () => {
    const created = await createBooking(env.DB, makeBooking({ planId: PLAN_A }));
    if (!created.ok) throw new Error('setup failed');
    // クローズ確認
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B }))).ok).toBe(false);
    // キャンセル → オープン
    await cancelBooking(env.DB, created.bookingId);
    const avail = await getAvailability(env.DB, D, D);
    expect(avail.find((a) => a.planId === PLAN_B && a.slotTypeId === SLOT_AM)?.status).toBe('open');
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B }))).ok).toBe(true);
  });

  it('二重キャンセルは false', async () => {
    const created = await createBooking(env.DB, makeBooking());
    if (!created.ok) throw new Error('setup failed');
    expect(await cancelBooking(env.DB, created.bookingId)).toBe(true);
    expect(await cancelBooking(env.DB, created.bookingId)).toBe(false);
  });

  it('存在しないIDは false', async () => {
    expect(await cancelBooking(env.DB, 9999)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- booking`
Expected: FAIL（`cancelBooking` が存在しない）

- [ ] **Step 3: 実装**

`src/core/booking.ts` に追加:
```ts
export async function cancelBooking(db: D1Database, bookingId: number): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'confirmed'`
  ).bind(nowIso(), bookingId).run();
  return res.meta.changes === 1;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全テストPASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 予約キャンセル（論理削除）と連動枠の自動オープン"
```

---

### Task 6: 予約変更（アトミックUPDATE）

**Files:**
- Modify: `src/core/booking.ts`（`changeBooking` を追加）
- Modify: `test/booking.test.ts`（describe を追加）

- [ ] **Step 1: 失敗するテストを書く**

`test/booking.test.ts` の末尾に追加:
```ts
import { changeBooking } from '../src/core/booking';
import { PLAN_C } from './fixtures';
// （どちらも既存のimport行に統合すること）

describe('changeBooking', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  async function setup(overrides = {}) {
    const created = await createBooking(env.DB, makeBooking(overrides));
    if (!created.ok) throw new Error('setup failed');
    return created.bookingId;
  }

  it('空いている枠へ移動でき、予約IDは維持される', async () => {
    const id = await setup();
    const result = await changeBooking(env.DB, id, { planId: PLAN_A, date: D, slotTypeId: SLOT_PM, partySize: 2 });
    expect(result).toEqual({ ok: true, bookingId: id });
    const row = await env.DB.prepare(`SELECT slot_type_id, status FROM bookings WHERE id = ?`)
      .bind(id).first<{ slot_type_id: number; status: string }>();
    expect(row).toEqual({ slot_type_id: SLOT_PM, status: 'confirmed' });
  });

  it('移動により元の時間帯の連動枠がオープンし、移動先の連動枠がクローズする', async () => {
    const id = await setup({ planId: PLAN_A, slotTypeId: SLOT_AM });
    await changeBooking(env.DB, id, { planId: PLAN_A, date: D, slotTypeId: SLOT_PM, partySize: 2 });
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, slotTypeId: SLOT_AM }))).ok).toBe(true);  // 元はオープン
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_C, slotTypeId: SLOT_PM }))).ok).toBe(false); // 先はクローズ
  });

  it('人数変更: 自分自身を除いて定員判定される（2名→定員いっぱいの6名はOK）', async () => {
    const id = await setup({ partySize: 2 });
    const result = await changeBooking(env.DB, id, { planId: PLAN_A, date: D, slotTypeId: SLOT_AM, partySize: 6 });
    expect(result.ok).toBe(true);
  });

  it('定員超過への人数変更は失敗し、元の予約が無変更で残る', async () => {
    const id = await setup({ partySize: 2 });
    const result = await changeBooking(env.DB, id, { planId: PLAN_A, date: D, slotTypeId: SLOT_AM, partySize: 7 });
    expect(result).toEqual({ ok: false, reason: 'slot_unavailable' });
    const row = await env.DB.prepare(`SELECT party_size, status FROM bookings WHERE id = ?`)
      .bind(id).first<{ party_size: number; status: string }>();
    expect(row).toEqual({ party_size: 2, status: 'confirmed' });
  });

  it('リソース競合する枠への移動は失敗し、元の予約が残る', async () => {
    const idA = await setup({ planId: PLAN_A, slotTypeId: SLOT_AM });
    await createBooking(env.DB, makeBooking({ planId: PLAN_C, slotTypeId: SLOT_PM, customerName: '午後の客' }));
    const result = await changeBooking(env.DB, idA, { planId: PLAN_A, date: D, slotTypeId: SLOT_PM, partySize: 2 });
    expect(result.ok).toBe(false);
    const row = await env.DB.prepare(`SELECT slot_type_id FROM bookings WHERE id = ?`)
      .bind(idA).first<{ slot_type_id: number }>();
    expect(row?.slot_type_id).toBe(SLOT_AM);
  });

  it('同一時間帯でのプラン変更: 自分の予約は競合とみなされない', async () => {
    const id = await setup({ planId: PLAN_A, slotTypeId: SLOT_AM });
    const result = await changeBooking(env.DB, id, { planId: PLAN_B, date: D, slotTypeId: SLOT_AM, partySize: 2 });
    expect(result.ok).toBe(true);
  });

  it('キャンセル済み予約は変更できない', async () => {
    const id = await setup();
    await cancelBooking(env.DB, id);
    const result = await changeBooking(env.DB, id, { planId: PLAN_A, date: D, slotTypeId: SLOT_PM, partySize: 2 });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- booking`
Expected: FAIL（`changeBooking` が存在しない）

- [ ] **Step 3: 実装**

`src/core/booking.ts` に追加:
```ts
export interface BookingChange {
  planId: number;
  date: string;
  slotTypeId: number;
  partySize: number;
  totalAmount?: number;
  notes?: string;
}

// 変更後の枠の空き条件（自分自身を除外して評価）をWHERE句に含めた1文のUPDATE。
// 条件を満たさなければ meta.changes = 0 で元の行は無変更のまま残る。
export async function changeBooking(db: D1Database, bookingId: number, ch: BookingChange): Promise<BookingResult> {
  const cond = slotOpenCond(ch, bookingId);
  const res = await db.prepare(
    `UPDATE bookings
     SET plan_id = ?, date = ?, slot_type_id = ?, party_size = ?,
         total_amount = COALESCE(?, total_amount), notes = COALESCE(?, notes)
     WHERE id = ? AND status = 'confirmed' AND ${cond.sql}`
  ).bind(
    ch.planId, ch.date, ch.slotTypeId, ch.partySize,
    ch.totalAmount ?? null, ch.notes ?? null,
    bookingId, ...cond.params
  ).run();

  if (res.meta.changes !== 1) return { ok: false, reason: 'slot_unavailable' };
  return { ok: true, bookingId };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全テストPASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 予約変更（空き条件付き1文UPDATEでアトミックに実行）"
```

---

### Task 7: 管理者セッション認証

**Files:**
- Create: `src/auth/session.ts`, `src/routes/admin.tsx`, `test/session.test.ts`, `test/admin-auth.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: セッション純関数の失敗するテストを書く**

`test/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { signSession, verifySession, passwordMatches } from '../src/auth/session';

const SECRET = 'test-secret';

describe('session', () => {
  it('署名したトークンは検証に通る', async () => {
    const token = await signSession(SECRET, Date.now() + 60_000);
    expect(await verifySession(SECRET, token)).toBe(true);
  });

  it('期限切れトークンは無効', async () => {
    const token = await signSession(SECRET, Date.now() - 1_000);
    expect(await verifySession(SECRET, token)).toBe(false);
  });

  it('改ざんされたトークンは無効', async () => {
    const token = await signSession(SECRET, Date.now() + 60_000);
    const [exp, sig] = token.split('.');
    const forged = `${Number(exp) + 999_999_999}.${sig}`;
    expect(await verifySession(SECRET, forged)).toBe(false);
  });

  it('別のシークレットで署名されたトークンは無効', async () => {
    const token = await signSession('other-secret', Date.now() + 60_000);
    expect(await verifySession(SECRET, token)).toBe(false);
  });

  it('undefined・不正形式は無効', async () => {
    expect(await verifySession(SECRET, undefined)).toBe(false);
    expect(await verifySession(SECRET, 'garbage')).toBe(false);
    expect(await verifySession(SECRET, '123.')).toBe(false);
  });

  it('passwordMatches はパスワードの一致を判定する', async () => {
    expect(await passwordMatches(SECRET, 'abc', 'abc')).toBe(true);
    expect(await passwordMatches(SECRET, 'abc', 'abd')).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- session`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: セッション純関数を実装**

`src/auth/session.ts`:
```ts
const encoder = new TextEncoder();

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const b64 = s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// トークン形式: `${expiresAtMs}.${base64url(HMAC-SHA256(expiresAtMs))}`
export async function signSession(secret: string, expiresAtMs: number): Promise<string> {
  const key = await hmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(String(expiresAtMs)));
  return `${expiresAtMs}.${toBase64Url(sig)}`;
}

export async function verifySession(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sigBytes = fromBase64Url(token.slice(dot + 1));
  if (!sigBytes || sigBytes.length === 0) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const key = await hmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, sigBytes as unknown as BufferSource, encoder.encode(exp));
}

// パスワード比較。生文字列の === 比較によるタイミング差を避けるため、両者のHMACダイジェストを比較する
export async function passwordMatches(secret: string, input: string, expected: string): Promise<boolean> {
  const key = await hmacKey(secret, 'sign');
  const a = toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(input)));
  const b = toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(expected)));
  return a === b;
}
```

- [ ] **Step 4: セッションテストが通ることを確認**

Run: `npm test -- session`
Expected: 6 passed

- [ ] **Step 5: 管理ルートの失敗するテストを書く**

`test/admin-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';

async function login(password: string): Promise<Response> {
  return app.request('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString()
  }, env);
}

describe('admin auth', () => {
  it('未ログインで /admin にアクセスするとログイン画面へリダイレクト', async () => {
    const res = await app.request('/admin', {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/login');
  });

  it('ログイン画面は未ログインでも表示できる', async () => {
    const res = await app.request('/admin/login', {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('パスワード');
  });

  it('誤ったパスワードでは401でCookieが発行されない', async () => {
    const res = await login('wrong-password');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('正しいパスワードでログインでき、Cookieで /admin にアクセスできる', async () => {
    const res = await login('test-password'); // vitest.config.ts の ADMIN_PASSWORD
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('admin_session=');
    expect(setCookie).toContain('HttpOnly');
    const cookie = setCookie!.split(';')[0];
    const page = await app.request('/admin', { headers: { cookie } }, env);
    expect(page.status).toBe(200);
  });

  it('ログアウトするとCookieが無効化される', async () => {
    const res = await login('test-password');
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const out = await app.request('/admin/logout', { method: 'POST', headers: { cookie } }, env);
    expect(out.status).toBe(302);
    // Max-Age=0 のCookieが返る
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('でたらめなCookieではアクセスできない', async () => {
    const res = await app.request('/admin', { headers: { cookie: 'admin_session=123.fakesig' } }, env);
    expect(res.status).toBe(302);
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npm test -- admin-auth`
Expected: FAIL（/admin ルートが存在せず404）

- [ ] **Step 7: 管理ルートを実装**

`src/routes/admin.tsx`:
```tsx
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { passwordMatches, signSession, verifySession } from '../auth/session';
import type { Bindings } from '../types';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

const LoginPage = (props: { error: string | null }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>管理者ログイン</title>
    </head>
    <body>
      <h1>管理者ログイン</h1>
      {props.error && <p style="color: red">{props.error}</p>}
      <form method="post" action="/admin/login">
        <label>
          パスワード: <input type="password" name="password" required />
        </label>
        <button type="submit">ログイン</button>
      </form>
    </body>
  </html>
);

export const admin = new Hono<{ Bindings: Bindings }>();

// ログイン画面・処理は認証ミドルウェアより先に登録する（未ログインで到達可能にするため）
admin.get('/login', (c) => c.html(<LoginPage error={null} />));

admin.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const password = typeof form.password === 'string' ? form.password : '';
  if (!(await passwordMatches(c.env.SESSION_SECRET, password, c.env.ADMIN_PASSWORD))) {
    return c.html(<LoginPage error="パスワードが違います" />, 401);
  }
  const token = await signSession(c.env.SESSION_SECRET, Date.now() + SESSION_TTL_MS);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000
  });
  return c.redirect('/admin');
});

admin.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.redirect('/admin/login');
});

// これ以降に登録するルートはすべて認証必須
admin.use('*', async (c, next) => {
  if (!(await verifySession(c.env.SESSION_SECRET, getCookie(c, COOKIE_NAME)))) {
    return c.redirect('/admin/login');
  }
  await next();
});

admin.get('/', (c) =>
  c.html(
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>予約管理</title>
      </head>
      <body>
        <h1>予約管理システム</h1>
        <p>予約台帳はステップ2で実装します。</p>
        <form method="post" action="/admin/logout">
          <button type="submit">ログアウト</button>
        </form>
      </body>
    </html>
  )
);
```

`src/index.ts` を以下で置き換える:
```ts
import { Hono } from 'hono';
import { admin } from './routes/admin';
import type { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/admin', admin);

export default app;
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npm test && npm run typecheck`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: 管理者認証（HMAC署名Cookieセッション＋ログイン画面）"
```

---

### Task 8: 仕上げ（README・最終検証）

**Files:**
- Create: `README.md`

- [ ] **Step 1: README を作成**

`README.md`:
```markdown
# 予約管理システム

「ウラカタ予約」をモデルにした自社専用の予約管理システム。
Cloudflare Workers + Hono + D1 で動作します。

## セットアップ

    npm install
    cp .dev.vars.example .dev.vars   # パスワード等を書き換える
    npm run dev                      # http://localhost:8787

- ヘルスチェック: GET /health
- 管理画面: /admin （.dev.vars の ADMIN_PASSWORD でログイン）

## テスト

    npm test           # 全テスト実行
    npm run typecheck  # 型チェック

## ドキュメント

- 設計書: docs/superpowers/specs/2026-07-07-booking-system-design.md
- 実装計画: docs/superpowers/plans/

## 開発ステップ

1. 基盤＋コアロジック（このリポジトリの現状） — 空き状況計算・アトミック予約登録・管理者認証
2. 管理画面（予約台帳カレンダー・マスタ管理）
3. 代理店連携（専用リンク・メール通知）
4. 運用機能（CSVエクスポート・集計・本番デプロイ）
```

- [ ] **Step 2: 全体検証**

Run: `npm test && npm run typecheck`
Expected: 全テストPASS（30件以上）、型エラーなし

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: README（セットアップ手順と開発ステップ）"
```

---

## 完了条件

- `npm test` が全件PASS（空き状況8件・予約登録8件・キャンセル4件・変更7件・セッション6件・認証6件・schema/smoke 2件）
- `npm run typecheck` がエラーなし
- スペック4章の①〜④の全条件がテストで検証されている
- `wrangler dev` でログイン画面が表示され、ログインできる（手動確認）
