# 予約管理システム ステップ6（運用ページ拡充）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** ウラカタのナビ構成に倣い、新規予約（日付自由・仮予約対応）／予約検索／予約台帳（期間リスト）／本日の台帳（現場ロスター・印刷対応）／予約枠（14日マトリクスの定員・クローズ一括調整）の5ページを追加する。

**Architecture:** 既存コア（createBooking/getAvailability/capacity_overrides/slot_closures）の上に読み取り中心のページを足すだけ。スキーマ変更なし。デザインはstep5の語彙（page-head/tbl-cards/badge/btn/form-grid）をそのまま使う。

**前提:** 119テストgreen。ブランチ `step6-ops-pages`。**テストファイルの変更は各タスクで明示された新規作成のみ**（既存assertの変更は一切禁止。ただしT1のナビ改名で壊れる既存assertは存在しない — admin-layoutはhrefのみ検証）。

## ファイル構成

| パス | 責務 |
|---|---|
| `src/routes/admin/util.ts` | `resolveBack`・`todayJst`（calendar.tsxから移設・共用） |
| `src/routes/admin/new-booking.tsx` | GET `/admin/new`（日付自由の新規予約フォーム） |
| `src/routes/admin/lists.tsx` | `/admin/search`・`/admin/ledger`・`/admin/today` |
| `src/routes/admin/slots.tsx` | `/admin/slots`（予約枠マトリクス）＋close/unclose |
| `src/routes/admin/calendar.tsx` | POST /bookings の `as_request` 対応、util移設に伴うimport変更 |
| `src/routes/admin/ui.tsx` | ナビ更新（11項目・「台帳カレンダー」に改名） |
| `src/routes/style-css.ts` | 印刷用CSSを末尾に追記 |

## 共通コントラクト

- ナビ（左から）: `台帳カレンダー`(/admin) `新規予約`(/admin/new) `予約検索`(/admin/search) `予約台帳`(/admin/ledger) `本日の台帳`(/admin/today) `予約枠`(/admin/slots) `承認待ち`(/admin/requests) `プラン`(/admin/plans) `代理店`(/admin/agencies) `集計`(/admin/stats) `設定`(/admin/settings)
- すべて認証必須（マウントはcalendarより前）。Layoutの`active`に自ページのhrefを渡す
- 一覧の行表示は日別詳細の予約一覧と同じ列語彙＋`data-label`＋`badge bk-*`＋`row-muted`
- コミット末尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。各タスク末で全テストgreen

---

### Task 1: util移設・新規予約ページ・仮予約対応・ナビ更新

**Files:**
- Create: `src/routes/admin/util.ts`, `src/routes/admin/new-booking.tsx`, `test/admin-new.test.ts`
- Modify: `src/routes/admin/calendar.tsx`, `src/routes/admin/ui.tsx`, `src/routes/admin.tsx`

- [ ] **Step 1: 失敗するテスト**

`test/admin-new.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';

const D = '2026-08-01';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin new booking page', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('新規予約ページに日付入力付きフォームが表示される', async () => {
    const res = await app.request('/admin/new', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/admin/bookings"');
    expect(html).toContain('name="date"');
    expect(html).toContain('仮予約');
  });

  it('仮予約チェックで requested として登録され、リクエスト通知が記録される', async () => {
    const res = await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '電話の仮予約', customer_phone: '', num_adults: '2', num_children: '0',
      total_amount: '', payment_method: 'onsite_cash', notes: '', as_request: '1'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/admin/day/${D}?ok=requested`);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE customer_name = '電話の仮予約'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('requested');
    const log = await env.DB.prepare(`SELECT type FROM email_log ORDER BY id DESC LIMIT 1`).first<{ type: string }>();
    expect(log?.type).toBe('requested');
  });

  it('as_requestなしは従来どおり confirmed', async () => {
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '通常予約', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE customer_name = '通常予約'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('confirmed');
  });

  it('未ログインは302', async () => {
    expect((await app.request('/admin/new', {}, env)).status).toBe(302);
  });
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- admin-new` → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  - `util.ts`: calendar.tsx から `resolveBack`（デフォルトfallback引数を取れる形に一般化: `resolveBack(v: unknown, fallback: string)`）と JSTの今日を返す `todayJst(): string` を移設。calendar.tsx は import に変更（挙動不変）
  - `new-booking.tsx`: GET `/` — 日別詳細の新規予約フォームと同じフィールド構成＋ `date`（type=date, value=今日JST）＋ チェックボックス `as_request` value="1"（ラベル `仮予約（リクエスト）として登録`）。action は既存の `/admin/bookings`。Layout active=/admin/new、page-head（eyebrow `New Booking`、h1 `新規予約`）
  - `calendar.tsx` POST `/bookings`: form の `as_request === '1'` なら `createBooking(..., status: 'requested')` とし、成功リダイレクトを `?ok=requested`、通知typeを `requested` に。day page の OK_MESSAGES に `requested: 'リクエストとして登録しました'` を追加
  - `ui.tsx`: ナビを共通コントラクトの11項目に（既存ラベル `予約台帳`→`台帳カレンダー` 改名）
  - `admin.tsx`: `admin.route('/new', newBooking)` をcalendarより前に
- [ ] **Step 4: 全テストgreen**（123件） — `npm test && npm run typecheck`
- [ ] **Step 5: Commit** — `feat: 新規予約ページ(日付自由・仮予約登録)とナビ拡充`

---

### Task 2: 予約検索

**Files:**
- Create: `test/admin-search.test.ts`
- Create/Modify: `src/routes/admin/lists.tsx`（新規）, `src/routes/admin.tsx`（mount `/search` 以下lists）

- [ ] **Step 1: 失敗するテスト**

`test/admin-search.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, PLAN_D, SLOT_PM } from './fixtures';
import { createBooking } from '../src/core/booking';

describe('admin search', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
    await createBooking(env.DB, makeBooking({ customerName: '山田花子', customerPhone: '090-1111-2222' }));
    await createBooking(env.DB, makeBooking({ planId: PLAN_D, date: '2026-09-10', customerName: '佐藤次郎', customerPhone: '080-3333-4444' }));
    await createBooking(env.DB, makeBooking({ slotTypeId: SLOT_PM, customerName: '鈴木リクエスト', status: 'requested' }));
  });

  it('検索条件なしはフォームのみ（結果なし）', async () => {
    const res = await app.request('/admin/search', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('検索');
    expect(html).not.toContain('山田花子');
  });

  it('氏名の部分一致で検索できる', async () => {
    const html = await (await app.request('/admin/search?q=山田', { headers: { cookie } }, env)).text();
    expect(html).toContain('山田花子');
    expect(html).not.toContain('佐藤次郎');
  });

  it('電話番号の部分一致で検索できる', async () => {
    const html = await (await app.request('/admin/search?q=3333', { headers: { cookie } }, env)).text();
    expect(html).toContain('佐藤次郎');
    expect(html).not.toContain('山田花子');
  });

  it('期間とプランで絞り込める', async () => {
    const html = await (await app.request('/admin/search?from=2026-09-01&to=2026-09-30', { headers: { cookie } }, env)).text();
    expect(html).toContain('佐藤次郎');
    expect(html).not.toContain('山田花子');
    const html2 = await (await app.request(`/admin/search?plan_id=${PLAN_A}`, { headers: { cookie } }, env)).text();
    expect(html2).toContain('山田花子');
    expect(html2).not.toContain('佐藤次郎');
  });

  it('状態で絞り込める', async () => {
    const html = await (await app.request('/admin/search?status=requested', { headers: { cookie } }, env)).text();
    expect(html).toContain('鈴木リクエスト');
    expect(html).not.toContain('山田花子');
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  `lists.tsx` に GET `/search`: フォーム（`q` テキスト・`from`/`to` date・`plan_id` select（全プラン＋空=すべて）・`status` select（すべて/確定/リクエスト/取消/否認）、GET submit）。クエリパラメータが1つでもあれば検索実行: `WHERE (?q空でなければ (customer_name LIKE '%q%' OR customer_phone LIKE '%q%'))` AND 期間 AND plan AND status、`ORDER BY date DESC, id DESC LIMIT 200`。結果は日別詳細と同じ列＋参加日列（日付は `/admin/day/{date}` へのリンク）＋`変更`リンク。0件は `該当する予約がありません`
- [ ] **Step 4: 全テストgreen**（128件）
- [ ] **Step 5: Commit** — `feat: 予約検索(氏名・電話・期間・プラン・状態)`

---

### Task 3: 予約台帳（期間リスト）

**Files:**
- Create: `test/admin-ledger.test.ts`
- Modify: `src/routes/admin/lists.tsx`

- [ ] **Step 1: 失敗するテスト**

`test/admin-ledger.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, SLOT_PM } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

describe('admin ledger', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
    await createBooking(env.DB, makeBooking({ customerName: '期間内の客', numAdults: 3 }));
    const c = await createBooking(env.DB, makeBooking({ slotTypeId: SLOT_PM, customerName: '取消の客' }));
    if (c.ok) await cancelBooking(env.DB, c.bookingId);
    await createBooking(env.DB, makeBooking({ date: '2026-10-01', customerName: '期間外の客' }));
  });

  it('期間指定で一覧とサマリー（件数・人数）が表示される', async () => {
    const html = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env)).text();
    expect(html).toContain('期間内の客');
    expect(html).not.toContain('期間外の客');
    expect(html).toContain('1件');
    expect(html).toContain('3名');
  });

  it('取消・否認は既定で非表示、include_cancelled=1で表示', async () => {
    const base = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env)).text();
    expect(base).not.toContain('取消の客');
    const all = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31&include_cancelled=1', { headers: { cookie } }, env)).text();
    expect(all).toContain('取消の客');
  });

  it('CSVエクスポートへのリンクが同じ期間で張られる', async () => {
    const html = await (await app.request('/admin/ledger?from=2026-08-01&to=2026-08-31', { headers: { cookie } }, env)).text();
    expect(html).toContain('/admin/stats/export.csv?from=2026-08-01&amp;to=2026-08-31');
  });

  it('期間未指定は今日から30日間で200', async () => {
    expect((await app.request('/admin/ledger', { headers: { cookie } }, env)).status).toBe(200);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  GET `/ledger`: `from`/`to`（既定=今日JST〜+30日）、`include_cancelled`。confirmed+requestedの `WHERE date BETWEEN`（include時は全状態）を日付昇順・時刻順で一覧（列: 参加日リンク/時刻/プラン/顧客/電話/人数/金額/支払/経路/状態）。上部にサマリー `{n}件・{人数}名・{金額合計}円`（confirmed+requestedのみ集計）と期間変更フォーム、`CSVダウンロード` リンク（`/admin/stats/export.csv?from=..&to=..`）
- [ ] **Step 4: 全テストgreen**（132件）
- [ ] **Step 5: Commit** — `feat: 予約台帳(期間リスト・サマリー・CSVリンク)`

---

### Task 4: 本日の台帳（現場ロスター・印刷対応）

**Files:**
- Create: `test/admin-today.test.ts`
- Modify: `src/routes/admin/lists.tsx`, `src/routes/style-css.ts`

- [ ] **Step 1: 失敗するテスト**

`test/admin-today.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, SLOT_PM } from './fixtures';
import { createBooking, cancelBooking } from '../src/core/booking';

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

describe('admin today roster', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('本日の予約が時間帯見出しの下に表示され、取消は出ない', async () => {
    const d = todayJst();
    await createBooking(env.DB, makeBooking({ date: d, customerName: '本日の客', customerPhone: '090-8888-9999' }));
    const c = await createBooking(env.DB, makeBooking({ date: d, slotTypeId: SLOT_PM, customerName: '本日取消' }));
    if (c.ok) await cancelBooking(env.DB, c.bookingId);
    const html = await (await app.request('/admin/today', { headers: { cookie } }, env)).text();
    expect(html).toContain('本日の客');
    expect(html).toContain('090-8888-9999');
    expect(html).toContain('午前便');
    expect(html).not.toContain('本日取消');
  });

  it('予約ゼロの日は空メッセージ', async () => {
    const html = await (await app.request('/admin/today', { headers: { cookie } }, env)).text();
    expect(html).toContain('本日の予約はありません');
  });

  it('日別詳細へのリンクがある', async () => {
    const html = await (await app.request('/admin/today', { headers: { cookie } }, env)).text();
    expect(html).toContain(`/admin/day/${todayJst()}`);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  GET `/today`: 今日JSTの confirmed+requested を時刻順に取得し、**時間帯ごとの見出し（`{時間帯名} {HH:MM}` + 合計人数）→ その予約のカード風リスト**（顧客名を大きく・電話・人数 大X小Y・プラン・経路・備考・リクエストは badge）。0件は `本日の予約はありません`。page-head に日付と `日別詳細へ`（/admin/day/{today}）と `印刷` ボタン（`onclick="window.print()"`、`<button>` 1個だけの最小JS）。
  `style-css.ts` 末尾に追記:
```css
/* ---------- print (本日の台帳) ---------- */
@media print {
  .site-header, .cal-nav, .no-print { display: none !important; }
  body { background: #fff; }
  .page { max-width: none; padding: 0; }
}
```
- [ ] **Step 4: 全テストgreen**（135件）
- [ ] **Step 5: Commit** — `feat: 本日の台帳(時間帯別ロスター・印刷対応)`

---

### Task 5: 予約枠（14日マトリクス）

**Files:**
- Create: `src/routes/admin/slots.tsx`, `test/admin-slots.test.ts`
- Modify: `src/routes/admin.tsx`（mount）, `src/routes/admin/calendar.tsx`（POST /capacity に任意の `back`）

- [ ] **Step 1: 失敗するテスト**

`test/admin-slots.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, PLAN_A, SLOT_AM } from './fixtures';
import { getAvailability } from '../src/core/availability';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin slots matrix', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('マトリクスに定員入力と予約数が表示される', async () => {
    const res = await app.request('/admin/slots?from=2026-08-01', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('プランA');
    expect(html).toContain('value="6"');   // 基本定員
    expect(html).toContain('8/1');
    expect(html).toContain('from=2026-07-18'); // 前の14日
    expect(html).toContain('from=2026-08-15'); // 次の14日
  });

  it('backパラメータ付きの定員変更で予約枠ページに戻る', async () => {
    const res = await app.request('/admin/capacity', form({
      date: '2026-08-01', plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM),
      capacity: '3', back: '/admin/slots?from=2026-08-01'
    }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/slots?from=2026-08-01&ok=capacity');
    const html = await (await app.request('/admin/slots?from=2026-08-01', { headers: { cookie } }, env)).text();
    expect(html).toContain('value="3"');
  });

  it('クローズ/解除がトグルできる', async () => {
    let res = await app.request('/admin/slots/close', form({
      date: '2026-08-02', plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), from: '2026-08-01'
    }, cookie), env);
    expect(res.status).toBe(302);
    let avail = await getAvailability(env.DB, '2026-08-02', '2026-08-02');
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.status).toBe('manual_closed');
    const html = await (await app.request('/admin/slots?from=2026-08-01', { headers: { cookie } }, env)).text();
    expect(html).toContain('/admin/slots/unclose');
    res = await app.request('/admin/slots/unclose', form({
      date: '2026-08-02', plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), from: '2026-08-01'
    }, cookie), env);
    expect(res.status).toBe(302);
    avail = await getAvailability(env.DB, '2026-08-02', '2026-08-02');
    expect(avail.find((a) => a.planId === PLAN_A && a.slotTypeId === SLOT_AM)?.status).toBe('open');
  });

  it('未ログインは302', async () => {
    expect((await app.request('/admin/slots', {}, env)).status).toBe(302);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: 実装（コントラクト）**
  - `calendar.tsx` POST `/capacity`: 任意フィールド `back`（`resolveBack(v, /admin/day/{date})`）→ 成功時 `{back}?ok=capacity`（backに`?`が含まれる場合は `&ok=capacity` で連結）
  - `slots.tsx` GET `/`: `from`（既定=今日JST）から14日。`getAvailability` を範囲取得し、行=催行中のプラン×時刻（agencyのgrid14と同じ絞り方）、列=日付（`M/D`＋曜日、grid14の`th.day`様式）。各セル: 予約数 `{booked}名` ＋ 定員フォーム（`/admin/capacity`、hidden date/plan_id/slot_type_id/back=現ページURL、input `capacity` value=有効定員）＋ その(date,slot,plan)のプラン指定クローズが存在すれば `解除` フォーム（`/admin/slots/unclose`）、なければ `休` フォーム（`/admin/slots/close`）。manual_closed セルは `manual-soft` 背景（`.avail`のセルクラス流用可）。前後14日リンク・`?ok=capacity|closed|unclosed` メッセージ
  - POST `/close`: 検証→ `INSERT INTO slot_closures (date, slot_type_id, plan_id, reason, created_at) VALUES (?, ?, ?, '予約枠ページから', ?)` → `/admin/slots?from={from}&ok=closed`（from検証NGなら今日）
  - POST `/unclose`: `DELETE FROM slot_closures WHERE date = ? AND slot_type_id = ? AND plan_id = ?`（plan指定のもののみ。全体クローズは設定ページの管轄）→ `?ok=unclosed`
- [ ] **Step 4: 全テストgreen**（139件）
- [ ] **Step 5: Commit** — `feat: 予約枠ページ(14日マトリクスで定員・クローズ一括調整)`

---

### Task 6: 仕上げ（コントローラ実施）

- [ ] README更新（管理画面機能に5ページ追記）→ 全テスト → ブラウザで目視確認 → mainマージ → push → `wrangler deploy`

## 完了条件

- 139テストgreen・typecheckクリーン
- ブラウザで: 新規予約（仮予約含む）→ 台帳反映 / 検索ヒット / 台帳サマリー / 本日の台帳表示 / 予約枠で定員変更とクローズ、が動く
