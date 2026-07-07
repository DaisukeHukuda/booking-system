# 予約管理システム ステップ2（管理画面）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者向けの予約台帳カレンダー・日別詳細・予約CRUD・マスタ管理（プラン/リソース/時間帯/手動クローズ）をSSRで実装し、自社の予約管理を開始できる状態にする。

**Architecture:** ステップ1のコア（`getAvailability` / `createBooking` / `cancelBooking` / `changeBooking`）の上にHono JSXのSSR画面を載せる。ビジネスロジックは一切追加しない — 画面はコアの呼び出しとフォーム処理のみ。認証はステップ1の `/admin` ミドルウェアをそのまま利用。

**Tech Stack:** ステップ1と同じ（TypeScript / Hono 4 JSX SSR / Cloudflare Workers / D1 / vitest）

**この計画の書式について:** テストコードは全文を記載する（実装者は一字一句そのまま使う）。画面実装は「コントラクト」（ルート定義・SQL・フォームフィールド名・リダイレクト先・**必ず表示する文字列**）で規定し、JSXマークアップの詳細は実装者に委ねる。テストがコントラクトの検証器になっている。

**参照:** スペック `docs/superpowers/specs/2026-07-07-booking-system-design.md` §5（管理画面）
**前提:** ステップ1完了（テスト41件green）。ブランチ `step2-admin-ui` を main から切って作業。

---

## ファイル構成（このステップで作る/変更するもの）

| パス | 責務 |
|---|---|
| `src/routes/admin/ui.tsx` | 共通Layout（ナビ+CSS）、ステータス/支払方法のラベル定数 |
| `src/routes/admin/calendar.tsx` | 台帳カレンダー、日別詳細、予約の登録/キャンセル/変更 |
| `src/routes/admin/plans.tsx` | プラン管理（一覧/作成/編集: リソース割当・時間帯別定員込み） |
| `src/routes/admin/settings.tsx` | リソース/時間帯/手動クローズの管理（1ページ3セクション） |
| `src/routes/admin.tsx` | （変更）ログイン/認証はそのまま、配下ルータのマウントに変更 |
| `test/helpers.ts` | ログインCookie取得ヘルパー |
| `test/admin-calendar.test.ts` ほか | 各画面のHTTPレベルテスト |

## 共通コントラクト（全タスク共通）

- すべての管理画面は認証必須（既存ミドルウェアが担保。ルータは `admin.use('*', ...)` より後にマウントする）
- 画面は `Layout` で包む。ナビリンク: `予約台帳`(/admin)・`プラン`(/admin/plans)・`設定`(/admin/settings)・ログアウトボタン
- ステータス表示文字列（`ui.tsx` の `STATUS_LABELS`）: open→`空き` / full→`満席` / linked_closed→`連動クローズ` / manual_closed→`手動クローズ`
- ステータスCSSクラス: open→`st-open` / full→`st-full` / linked_closed→`st-linked` / manual_closed→`st-manual`
- 支払方法表示（`PAYMENT_LABELS`）: onsite_cash→`現地現金` / onsite_card→`現地カード` / invoice→`請求書` / stripe→`事前決済`
- フォーム結果はクエリパラメータでフィードバック: `?ok=...`（緑のメッセージ）/ `?error=unavailable`（`この枠は直前に埋まりました` と赤表示）/ `?error=invalid`（`入力内容に誤りがあります`）
- 日付・数値の入力検証: date は `/^\d{4}-\d{2}-\d{2}$/`、数値IDと人数は `Number.isInteger` かつ正。検証NGは `?error=invalid` にリダイレクト
- コミットメッセージは各タスク記載のとおり。末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける
- 各タスク完了時に `npm test && npm run typecheck` が全green であること

---

### Task 1: ルータ再構成と共通レイアウト

**Files:**
- Create: `src/routes/admin/ui.tsx`, `test/helpers.ts`
- Modify: `src/routes/admin.tsx`, `test/admin-auth.test.ts`（1assertのみ変更可）

- [ ] **Step 1: テストヘルパーを作成**

`test/helpers.ts`:
```ts
import { env } from 'cloudflare:test';
import app from '../src/index';

export async function adminCookie(): Promise<string> {
  const res = await app.request('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'test-password' }).toString()
  }, env);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login failed');
  return setCookie.split(';')[0];
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/admin-layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';

describe('admin layout', () => {
  it('ログイン後の /admin にナビゲーションが表示される', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/admin/plans"');
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('ログアウト');
  });
});
```

- [ ] **Step 3: 失敗確認** — Run: `npm test -- admin-layout` → FAIL

- [ ] **Step 4: 実装**

`src/routes/admin/ui.tsx` を作成:
- `export const Layout = (props: { title: string; children: Child }) => ...`（`import type { Child } from 'hono/jsx'`）。`<html lang="ja">`、`<head>` にタイトル・viewport・`<style>` でCSS定数を埋め込み。`<header><nav>` に共通コントラクトのナビ4項目、`<main>{props.children}</main>`
- CSS定数: テーブルに罫線、ナビの横並び、`.st-open{color:#0a7d33}` `.st-full{color:#c0392b}` `.st-linked{color:#d35400}` `.st-manual{color:#7f8c8d}` `.msg-ok{color:green}` `.msg-error{color:red}` 程度のミニマムでよい
- `export const STATUS_LABELS: Record<SlotStatus, string>` と `export const PAYMENT_LABELS: Record<PaymentMethod, string>`（値は共通コントラクトのとおり）

`src/routes/admin.tsx` を変更: 認証ミドルウェアより後の `admin.get('/', ...)` のプレースホルダページを `Layout` で包む（本文は現状の「予約台帳はステップ2で実装します」のままでよい。Task 2で置き換える）。

`test/admin-auth.test.ts` の「正しいパスワードでログインでき…」は `page.status === 200` の確認のみなので変更不要のはず。他のテストも変更不要。もし文字列依存で壊れたら、壊れたassertのみ最小修正し報告する。

- [ ] **Step 5: 全テスト green 確認** — Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit** — `feat: 管理画面の共通レイアウトとナビゲーション`

---

### Task 2: 予約台帳カレンダー（月表示）

**Files:**
- Create: `src/routes/admin/calendar.tsx`, `test/admin-calendar.test.ts`
- Modify: `src/routes/admin.tsx`（プレースホルダを削除し `admin.route('/', calendar)` をマウント。マウント順は plans/settings が存在するようになったら先、calendar は最後）

- [ ] **Step 1: 失敗するテストを書く**

`test/admin-calendar.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, SLOT_AM } from './fixtures';
import { createBooking } from '../src/core/booking';

describe('admin calendar', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('月を指定してカレンダーが表示され、前後の月へのリンクがある', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=2026-08', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('2026年8月');
    expect(html).toContain('month=2026-07');
    expect(html).toContain('month=2026-09');
    expect(html).toContain('href="/admin/day/2026-08-01"');
    expect(html).toContain('href="/admin/day/2026-08-31"');
  });

  it('予約が入っている日に人数が表示される', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_A, partySize: 3 }));
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=2026-08', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('3名');
  });

  it('手動クローズした時間帯は st-manual で表示される', async () => {
    await env.DB.prepare(
      `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES ('2026-08-02', ?, NULL, '休業', '2026-07-07T00:00:00.000Z')`
    ).bind(SLOT_AM).run();
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=2026-08', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('st-manual');
  });

  it('month指定なしでも200で表示される（当月）', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('年');
  });

  it('不正なmonthは当月にフォールバックする', async () => {
    const cookie = await adminCookie();
    const res = await app.request('/admin?month=garbage', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npm test -- admin-calendar` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`src/routes/admin/calendar.tsx`: `export const calendar = new Hono<{ Bindings: Bindings }>()`

**GET `/`**:
- クエリ `month`（`YYYY-MM`）。`/^\d{4}-\d{2}$/` に合わなければ JST の当月（`new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7)`）
- 月初〜月末を計算し `getAvailability(db, from, to)` と `slot_types`（sort順）を取得
- 見出し `{Y}年{M}月`（ゼロ埋めなし）。前月・翌月リンク `/admin?month=...`
- カレンダーは `<table>`。週は日曜始まり、月初までの空セルあり。各日セル: `<a href="/admin/day/{date}">{日番号}</a>` と、時間帯ごとに1行 `<div class="{cls}">{時間帯名} {合計人数>0 ? `${合計人数}名` : ''}{記号}</div>`
  - その日その時間帯の全プランの status/booked から: 全プラン manual_closed → cls=`st-manual` 記号=`休` / いずれかのプランが open → `st-open` `空` / それ以外 → `st-full` `満`
  - 合計人数 = 全プランの booked 合計

`src/routes/admin.tsx`: プレースホルダの `admin.get('/', ...)` を削除し、認証ミドルウェアの後に `admin.route('/', calendar)` を追加。

- [ ] **Step 4: 全テスト green 確認** — Run: `npm test && npm run typecheck`
- [ ] **Step 5: Commit** — `feat: 予約台帳カレンダー(月表示・空き状況の色分け)`

---

### Task 3: 日別詳細と予約登録・キャンセル

**Files:**
- Modify: `src/routes/admin/calendar.tsx`
- Create: `test/admin-day.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/admin-day.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM, CAP_A } from './fixtures';
import { createBooking } from '../src/core/booking';

const D = '2026-08-01';

function form(data: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin day detail', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('空き状況の表と予約一覧・新規予約フォームが表示される', async () => {
    await createBooking(env.DB, makeBooking({ partySize: 2 }));
    const res = await app.request(`/admin/day/${D}`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト太郎');
    expect(html).toContain('090-0000-0000');
    expect(html).toContain('連動クローズ');           // B/CのAM
    expect(html).toContain(`残${CAP_A - 2}`);          // AのAM残席
    expect(html).toContain('action="/admin/bookings"');
    expect(html).toContain('現地現金');
  });

  it('新規予約を登録でき、日別ページへリダイレクトされる', async () => {
    const res = await app.request('/admin/bookings', {
      ...form({
        plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
        customer_name: '電話予約の客', customer_phone: '080-1111-2222',
        party_size: '3', total_amount: '24000', payment_method: 'onsite_cash', notes: ''
      }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=created`);
    const row = await env.DB.prepare(
      `SELECT customer_name, party_size, created_by FROM bookings WHERE customer_name = '電話予約の客'`
    ).first<{ customer_name: string; party_size: number; created_by: string }>();
    expect(row?.party_size).toBe(3);
    expect(row?.created_by).toBe('admin');
  });

  it('連動クローズ枠への登録は error=unavailable で戻される', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_A }));
    const res = await app.request('/admin/bookings', {
      ...form({
        plan_id: String(PLAN_B), slot_type_id: String(SLOT_AM), date: D,
        customer_name: '無理な客', customer_phone: '', party_size: '1',
        total_amount: '0', payment_method: 'onsite_cash', notes: ''
      }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?error=unavailable`);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE customer_name = '無理な客'`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('入力不備は error=invalid で戻される', async () => {
    const res = await app.request('/admin/bookings', {
      ...form({
        plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
        customer_name: '', customer_phone: '', party_size: '2',
        total_amount: '0', payment_method: 'onsite_cash', notes: ''
      }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=invalid');
  });

  it('キャンセルできる（論理削除・取消表示）', async () => {
    const created = await createBooking(env.DB, makeBooking());
    if (!created.ok) throw new Error('setup failed');
    const res = await app.request(`/admin/bookings/${created.bookingId}/cancel`, {
      ...form({ date: D }),
      headers: { ...form({}).headers, cookie }
    }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=cancelled`);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(created.bookingId).first<{ status: string }>();
    expect(row?.status).toBe('cancelled');
    const page = await app.request(`/admin/day/${D}`, { headers: { cookie } }, env);
    expect(await page.text()).toContain('取消');
  });

  it('不正な日付は404ではなくバリデーションエラー', async () => {
    const res = await app.request('/admin/day/2026-13-99x', { headers: { cookie } }, env);
    expect(res.status).toBe(302); // /admin へ戻す
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npm test -- admin-day` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`calendar.tsx` に追加:

**GET `/day/:date`**:
- date形式NGなら `/admin` へ302
- 表示内容:
  1. 見出し `{date}` と カレンダーへ戻るリンク
  2. `?ok=` / `?error=` のメッセージ（共通コントラクトの文言）
  3. **空き状況表**: 行=時間帯、列=プラン（active）。セルは `STATUS_LABELS[status]` を `st-*` クラス付きで表示し、open のときは `残{remaining}` を併記。linked_closed のときは原因プラン名を括弧書き（例: `連動クローズ(プランA)`）
  4. **予約一覧**（その日の全予約、キャンセル済み含む・作成順）: 時間帯名/プラン名/顧客名/電話/人数/金額/`PAYMENT_LABELS`/代理店名（agency_id NULL は `自社`）/状態。cancelled は `取消` と表示。confirmed 行には `変更` リンク（`/admin/bookings/{id}/edit`）と キャンセルフォーム（POST `/admin/bookings/{id}/cancel`、hidden `date`、`confirm` は不要）
  5. **新規予約フォーム**: action=`/admin/bookings`、hidden `date`、select `plan_id`（activeなプラン）、select `slot_type_id`、`customer_name`（required）、`customer_phone`、`party_size`（number, min=1）、`total_amount`（number）、select `payment_method`（PAYMENT_LABELS）、`notes`（textarea）
- SQL（予約一覧）:
```sql
SELECT b.*, p.name AS plan_name, st.name AS slot_name, a.name AS agency_name
FROM bookings b
JOIN plans p ON p.id = b.plan_id
JOIN slot_types st ON st.id = b.slot_type_id
LEFT JOIN agencies a ON a.id = b.agency_id
WHERE b.date = ?
ORDER BY st.sort_order, b.created_at
```

**POST `/bookings`**: parseBody→検証（customer_name 空NG、plan_id/slot_type_id/party_size 正整数、total_amount 0以上整数、date形式、payment_method はPAYMENT_LABELSのキー）→NGは `/admin/day/{date}?error=invalid`（dateすら不正なら `/admin`）→ `createBooking(..., createdBy: 'admin')` → okは `?ok=created`、失敗は `?error=unavailable`

**POST `/bookings/:id/cancel`**: hidden `date` 取得→ `cancelBooking` → true: `/admin/day/{date}?ok=cancelled` / false: `?error=invalid`

- [ ] **Step 4: 全テスト green 確認** — Run: `npm test && npm run typecheck`
- [ ] **Step 5: Commit** — `feat: 日別詳細ページと予約登録・キャンセル`

---

### Task 4: 予約変更フォーム

**Files:**
- Modify: `src/routes/admin/calendar.tsx`
- Create: `test/admin-edit.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/admin-edit.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_C, SLOT_AM, SLOT_PM } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

const D = '2026-08-01';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

async function setup(): Promise<number> {
  const created = await createBooking(env.DB, makeBooking({ partySize: 2 }));
  if (!created.ok) throw new Error('setup failed');
  return created.bookingId;
}

describe('admin booking edit', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('編集フォームに現在の値が表示される', async () => {
    const id = await setup();
    const res = await app.request(`/admin/bookings/${id}/edit`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト太郎');
    expect(html).toContain('value="2"');   // party_size
    expect(html).toContain(`value="${D}"`);
  });

  it('時間帯を変更でき、変更後の日のページへリダイレクトされる', async () => {
    const id = await setup();
    const res = await app.request(`/admin/bookings/${id}`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_PM), date: D,
      party_size: '2', total_amount: '16000',
      customer_name: '変更後の名前', customer_phone: '070-9999-8888', notes: 'メモ'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=changed`);
    const row = await env.DB.prepare(`SELECT slot_type_id, customer_name, customer_phone, notes FROM bookings WHERE id = ?`)
      .bind(id).first<{ slot_type_id: number; customer_name: string; customer_phone: string; notes: string }>();
    expect(row).toEqual({ slot_type_id: SLOT_PM, customer_name: '変更後の名前', customer_phone: '070-9999-8888', notes: 'メモ' });
  });

  it('リソース競合する変更は失敗し、編集画面に error=unavailable で戻る', async () => {
    const id = await setup();
    await createBooking(env.DB, makeBooking({ planId: PLAN_C, slotTypeId: SLOT_PM, customerName: '午後の先客' }));
    const res = await app.request(`/admin/bookings/${id}`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_PM), date: D,
      party_size: '2', total_amount: '16000',
      customer_name: 'テスト太郎', customer_phone: '090-0000-0000', notes: ''
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/bookings/${id}/edit?error=unavailable`);
    const row = await env.DB.prepare(`SELECT slot_type_id FROM bookings WHERE id = ?`).bind(id).first<{ slot_type_id: number }>();
    expect(row?.slot_type_id).toBe(SLOT_AM); // 無変更
  });

  it('キャンセル済み予約の編集画面は日別ページへリダイレクト', async () => {
    const id = await setup();
    await cancelBooking(env.DB, id);
    const res = await app.request(`/admin/bookings/${id}/edit`, { headers: { cookie } }, env);
    expect(res.status).toBe(302);
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npm test -- admin-edit` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`calendar.tsx` に追加:

**GET `/bookings/:id/edit`**: 予約をJOIN付きで取得。存在しない or cancelled → `/admin` へ302。フォーム action=`/admin/bookings/{id}`: select `plan_id`（activeプラン、現値selected）、select `slot_type_id`（現値selected）、`date`（type=date, value=現値）、`party_size`（value=現値）、`total_amount`、`customer_name`、`customer_phone`、`notes`。`?error=unavailable` 時は共通文言を赤表示

**POST `/bookings/:id`**: 検証（Task 3と同基準）→NG: `/admin/bookings/{id}/edit?error=invalid` → `changeBooking(db, id, { planId, date, slotTypeId, partySize, totalAmount, notes })` → 失敗: `/admin/bookings/{id}/edit?error=unavailable` / 成功: 続けて `UPDATE bookings SET customer_name = ?, customer_phone = ? WHERE id = ?` を実行し `/admin/day/{新date}?ok=changed` へ302
（連絡先の更新は在庫に影響しないため changeBooking の外で行ってよい、という設計判断。コメントで残すこと）

- [ ] **Step 4: 全テスト green 確認** — Run: `npm test && npm run typecheck`
- [ ] **Step 5: Commit** — `feat: 予約変更フォーム(枠移動+連絡先修正)`

---

### Task 5: プラン管理

**Files:**
- Create: `src/routes/admin/plans.tsx`, `test/admin-plans.test.ts`
- Modify: `src/routes/admin.tsx`（`admin.route('/plans', plans)` を calendar より先にマウント）

- [ ] **Step 1: 失敗するテストを書く**

`test/admin-plans.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_D, SLOT_AM } from './fixtures';
import { createBooking } from '../src/core/booking';

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

describe('admin plans', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('プラン一覧が表示される', async () => {
    const res = await app.request('/admin/plans', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('プランA');
    expect(html).toContain('プランD');
    expect(html).toContain('8000');
  });

  it('プランを新規作成できる', async () => {
    const res = await app.request('/admin/plans', form({ name: '新プラン', price: '5000' }, cookie), env);
    expect(res.status).toBe(302);
    const row = await env.DB.prepare(`SELECT name, price, active FROM plans WHERE name = '新プラン'`)
      .first<{ name: string; price: number; active: number }>();
    expect(row).toEqual({ name: '新プラン', price: 5000, active: 1 });
  });

  it('編集フォームに現在の値・リソース・定員が表示される', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}/edit`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="プランA"');
    expect(html).toContain('インストラクター1');
    expect(html).toContain('value="6"'); // AM定員
  });

  it('プランを更新できる（リソース割当と定員の変更込み）', async () => {
    const res = await app.request(`/admin/plans/${PLAN_A}`, form({
      name: 'プランA改', description: '説明', price: '9000', sort_order: '1', active: '1',
      'resource_ids[]': ['2'],
      slot_active_1: '1', slot_capacity_1: '5',
      slot_active_2: '1', slot_capacity_2: '6'
    }, cookie), env);
    expect(res.status).toBe(302);
    const plan = await env.DB.prepare(`SELECT name, price FROM plans WHERE id = ?`).bind(PLAN_A)
      .first<{ name: string; price: number }>();
    expect(plan).toEqual({ name: 'プランA改', price: 9000 });
    const resources = await env.DB.prepare(`SELECT resource_id FROM plan_resources WHERE plan_id = ? ORDER BY resource_id`)
      .bind(PLAN_A).all<{ resource_id: number }>();
    expect(resources.results.map((r) => r.resource_id)).toEqual([2]);
    const cap = await env.DB.prepare(`SELECT capacity FROM plan_slots WHERE plan_id = ? AND slot_type_id = 1`)
      .bind(PLAN_A).first<{ capacity: number }>();
    expect(cap?.capacity).toBe(5);
  });

  it('リソース変更が在庫連動に反映される（AをボートにするとDと競合）', async () => {
    await app.request(`/admin/plans/${PLAN_A}`, form({
      name: 'プランA', description: '', price: '8000', sort_order: '1', active: '1',
      'resource_ids[]': ['2'],
      slot_active_1: '1', slot_capacity_1: '6',
      slot_active_2: '1', slot_capacity_2: '6'
    }, cookie), env);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A }))).ok).toBe(true);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_D, customerName: '別件' }))).ok).toBe(false);
  });

  it('時間帯の催行を外せる（plan_slotsがinactiveになり予約不可）', async () => {
    await app.request(`/admin/plans/${PLAN_A}`, form({
      name: 'プランA', description: '', price: '8000', sort_order: '1', active: '1',
      'resource_ids[]': ['1'],
      slot_capacity_1: '6',              // slot_active_1 なし = チェック外し
      slot_active_2: '1', slot_capacity_2: '6'
    }, cookie), env);
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: SLOT_AM }))).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npm test -- admin-plans` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`src/routes/admin/plans.tsx`: `export const plans = new Hono<{ Bindings: Bindings }>()`

**GET `/`**: 全プラン（sort_order, id順）を表で表示: 名前/価格/有効(`有効`/`無効`)/割当リソース名（カンマ区切り）/時間帯別定員（`午前便:6` 形式）/`編集` リンク。下に新規作成フォーム（`name` required、`price` number）action=`/admin/plans`

**POST `/`**: 検証（name空NG、price 0以上整数）→ `INSERT INTO plans (name, price, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans))` → `/admin/plans?ok=created`（NGは `?error=invalid`）

**GET `/:id/edit`**: プラン・全リソース・全時間帯・現在の plan_resources / plan_slots を取得。フォーム action=`/admin/plans/{id}`: `name`, `description`(textarea), `price`, `sort_order`, `active`(checkbox value="1"), リソースはチェックボックス群 `name="resource_ids[]"` value=リソースid（現割当をchecked）、時間帯ごとに `slot_active_{slotTypeId}`(checkbox) と `slot_capacity_{slotTypeId}`(number, 現値)

**POST `/:id`**: parseBody（`parseBody({ all: true })` で `resource_ids[]` を配列取得。単一選択時に文字列になるケースに注意）→ 検証 → `db.batch` で:
1. `UPDATE plans SET name=?, description=?, price=?, sort_order=?, active=? WHERE id=?`（active はcheckbox有無で1/0）
2. `DELETE FROM plan_resources WHERE plan_id = ?` → 選択された各リソースを `INSERT`
3. 各時間帯について:
   - `slot_active_{id}` がチェックされている場合: `slot_capacity_{id}` が正整数でなければ全体を `?error=invalid` で弾く。有効なら `INSERT INTO plan_slots (plan_id, slot_type_id, capacity, active) VALUES (?, ?, ?, 1) ON CONFLICT(plan_id, slot_type_id) DO UPDATE SET capacity = excluded.capacity, active = 1`
   - チェックされていない場合: `UPDATE plan_slots SET active = 0 WHERE plan_id = ? AND slot_type_id = ?`（行が無ければ何もしないで良い＝このUPDATEは自然にno-op。capacityは触らない）
→ `/admin/plans?ok=updated`

`src/routes/admin.tsx`: `admin.route('/plans', plans)` を `admin.route('/', calendar)` より**前**に追加。

- [ ] **Step 4: 全テスト green 確認** — Run: `npm test && npm run typecheck`
- [ ] **Step 5: Commit** — `feat: プラン管理(リソース割当・時間帯別定員の編集)`

---

### Task 6: 設定ページ（リソース・時間帯・手動クローズ）

**Files:**
- Create: `src/routes/admin/settings.tsx`, `test/admin-settings.test.ts`
- Modify: `src/routes/admin.tsx`（`admin.route('/settings', settings)` をcalendarより前に）

- [ ] **Step 1: 失敗するテストを書く**

`test/admin-settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, SLOT_AM, PLAN_A } from './fixtures';
import { getAvailability } from '../src/core/availability';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin settings', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('リソース・時間帯・クローズの3セクションが表示される', async () => {
    const res = await app.request('/admin/settings', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('インストラクター1');
    expect(html).toContain('午前便');
    expect(html).toContain('手動クローズ');
  });

  it('リソースを追加・改名できる', async () => {
    let res = await app.request('/admin/settings/resources', form({ name: 'インストラクター2' }, cookie), env);
    expect(res.status).toBe(302);
    const created = await env.DB.prepare(`SELECT id FROM resources WHERE name = 'インストラクター2'`).first<{ id: number }>();
    expect(created).not.toBeNull();
    res = await app.request('/admin/settings/resources/1', form({ name: 'ベテラン', active: '1' }, cookie), env);
    expect(res.status).toBe(302);
    const renamed = await env.DB.prepare(`SELECT name FROM resources WHERE id = 1`).first<{ name: string }>();
    expect(renamed?.name).toBe('ベテラン');
  });

  it('時間帯を追加できる', async () => {
    const res = await app.request('/admin/settings/slot-types', form({ name: '夕方便', start_time: '16:00', sort_order: '3' }, cookie), env);
    expect(res.status).toBe(302);
    const row = await env.DB.prepare(`SELECT name, start_time FROM slot_types WHERE name = '夕方便'`)
      .first<{ name: string; start_time: string }>();
    expect(row).toEqual({ name: '夕方便', start_time: '16:00' });
  });

  it('手動クローズを登録でき、空き状況に反映される（全プラン）', async () => {
    const res = await app.request('/admin/settings/closures', form({
      date: '2026-08-05', slot_type_id: String(SLOT_AM), plan_id: '', reason: '休業'
    }, cookie), env);
    expect(res.status).toBe(302);
    const avail = await getAvailability(env.DB, '2026-08-05', '2026-08-05');
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.status).toBe('manual_closed');
  });

  it('手動クローズを削除できる', async () => {
    await app.request('/admin/settings/closures', form({
      date: '2026-08-05', slot_type_id: String(SLOT_AM), plan_id: String(PLAN_A), reason: 'メンテ'
    }, cookie), env);
    const row = await env.DB.prepare(`SELECT id FROM slot_closures LIMIT 1`).first<{ id: number }>();
    const res = await app.request(`/admin/settings/closures/${row!.id}/delete`, form({}, cookie), env);
    expect(res.status).toBe(302);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM slot_closures`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npm test -- admin-settings` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`src/routes/admin/settings.tsx`: `export const settings = new Hono<{ Bindings: Bindings }>()`

**GET `/`**: 3セクション:
1. `リソース`: 表（名前・有効・行ごとの更新フォーム: `name` input + `active` checkbox + 更新ボタン、action=`/admin/settings/resources/{id}`）＋追加フォーム（`name`、action=`/admin/settings/resources`）
2. `時間帯`: 表（名前・開始時刻・並び順・行ごとの更新フォーム action=`/admin/settings/slot-types/{id}`）＋追加フォーム（`name`,`start_time`,`sort_order`、action=`/admin/settings/slot-types`）
3. `手動クローズ`: 見出しに `手動クローズ` を含む。登録フォーム（`date` type=date、select `slot_type_id`、select `plan_id`（先頭に `全プラン` = value=""）、`reason`、action=`/admin/settings/closures`）＋一覧表（日付・時間帯名・プラン名 or `全プラン`・理由・削除ボタン action=`/admin/settings/closures/{id}/delete`、`date >= 今日(JST)` のもののみ日付順）

**POST ルート**（すべて成功時 `/admin/settings?ok=1`、検証NG `?error=invalid` へ302）:
- `/resources`: name空NG → INSERT
- `/resources/:id`: name空NG → `UPDATE resources SET name=?, active=? WHERE id=?`（activeはcheckbox有無）
- `/slot-types`: name空NG、start_time `/^\d{2}:\d{2}$/`、sort_order整数 → INSERT
- `/slot-types/:id`: 同上 → UPDATE
- `/closures`: date形式、slot_type_id正整数、plan_id空なら NULL → `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, ?, ?, ?)`（created_atはISO now）
- `/closures/:id/delete`: DELETE

`src/routes/admin.tsx`: `admin.route('/settings', settings)` をcalendarより前に追加。

- [ ] **Step 4: 全テスト green 確認** — Run: `npm test && npm run typecheck`
- [ ] **Step 5: Commit** — `feat: 設定ページ(リソース・時間帯・手動クローズ管理)`

---

### Task 7: 仕上げ（README更新・最終検証）

**Files:**
- Modify: `README.md`

- [ ] **Step 1: READMEの「開発ステップ」を更新**

`1. 基盤＋コアロジック（このリポジトリの現状）` の行を `1. 基盤＋コアロジック — 空き状況計算・アトミック予約登録・管理者認証` に、`2. 管理画面（予約台帳カレンダー・マスタ管理）` を `2. 管理画面（このリポジトリの現状） — 予約台帳カレンダー・予約CRUD・マスタ管理` に変更。「管理画面」セクションを追加:

```markdown
## 管理画面の機能

- 予約台帳カレンダー（月表示・空き/満席/連動クローズ/手動クローズの色分け）
- 日別詳細: 空き状況表・予約一覧・新規予約（電話予約の手入力）・変更・キャンセル
- プラン管理: 料金・リソース割当・時間帯別定員
- 設定: リソース / 時間帯 / 手動クローズ日
```

- [ ] **Step 2: 全体検証** — Run: `npm test && npm run typecheck` → 全green
- [ ] **Step 3: Commit** — `docs: README更新(ステップ2完了)`

---

## 完了条件

- `npm test` 全green（ステップ1の41件＋本ステップの約27件）
- `npm run typecheck` エラーなし
- `wrangler dev` で: カレンダー表示 → 日別ページ → 予約登録 → 台帳に反映 → 連動クローズ表示 → キャンセルで解除、が一連で動く（コントローラが手動確認）
- スペック§5「管理画面」の項目（代理店管理・CSVエクスポートを除く = ステップ3/4）がすべて存在する
