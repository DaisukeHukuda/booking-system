# 予約管理システム ステップ3（代理店連携）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 代理店マスタ管理（予約モード設定・専用リンク発行/再発行）、代理店向け予約ページ（`/a/{token}`）、メール通知（Resend・fail-soft）を実装し、代理店に本番リンクを配布できる状態にする。

**Architecture:** 代理店ページは認証レスの専用トークンURL。予約は代理店の `booking_mode` により requested（在庫は押さえる）/ confirmed で登録。通知はコア関数 `sendBookingNotification` に集約し、APIキー未設定なら送信スキップ＋`email_log` に記録（**メール失敗で予約は失敗しない**）。

**参照:** スペック `docs/superpowers/specs/2026-07-07-booking-system-design.md` §5〜§6（v2）
**前提:** ステップ2.5完了（87テストgreen）。ブランチ `step3-agency` を main から切る。

---

## ファイル構成

| パス | 責務 |
|---|---|
| `src/core/notify.ts` | メール通知（本文組立・Resend送信・email_logへの記録） |
| `src/routes/admin/agencies.tsx` | 代理店マスタ（一覧/作成/編集/トークン再発行） |
| `src/routes/agency.tsx` | 代理店向けページ（空き表・予約・自店一覧・キャンセル） |
| `src/core/booking.ts` | `cancelBookingForAgency` を追加（自店予約のみキャンセル可） |
| `src/types.ts` / `test/env.d.ts` / `vitest.config.ts` / `.dev.vars.example` | 通知用env追加 |

## 共通コントラクト

- 通知envは**全て任意**: `RESEND_API_KEY`（未設定→送信スキップ）, `NOTIFY_EMAIL_TO`（自社宛先）, `NOTIFY_EMAIL_FROM`
- 通知種別と件名ラベル: created→`新規予約` / requested→`予約リクエスト` / approved→`予約承認` / denied→`予約否認` / cancelled→`キャンセル`
- 代理店ページのフィードバックは管理画面と同じ `?ok=` / `?error=unavailable|invalid` 方式
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 各タスク末で `npm test && npm run typecheck` 全green

---

### Task 1: 通知コア（このタスクのコードは設計済み。一字一句そのまま使うこと）

**Files:**
- Create: `src/core/notify.ts`, `test/notify.test.ts`
- Modify: `src/types.ts`（Bindingsに `RESEND_API_KEY?: string; NOTIFY_EMAIL_TO?: string; NOTIFY_EMAIL_FROM?: string;` を追加）, `test/env.d.ts`（同様に任意項目追加）, `vitest.config.ts`（bindingsに `NOTIFY_EMAIL_TO: 'owner@example.com', NOTIFY_EMAIL_FROM: 'noreply@example.com'` を追加。RESEND_API_KEYは追加しない＝未設定）, `.dev.vars.example`（3行追記: `RESEND_API_KEY=` / `NOTIFY_EMAIL_TO=you@example.com` / `NOTIFY_EMAIL_FROM=onboarding@resend.dev`）

- [ ] **Step 1: 失敗するテストを書く**

`test/notify.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { sendBookingNotification } from '../src/core/notify';
import { seedBasic, makeBooking, AGENCY_1 } from './fixtures';
import { createBooking } from '../src/core/booking';

async function setup(overrides = {}): Promise<number> {
  const created = await createBooking(env.DB, makeBooking(overrides));
  if (!created.ok) throw new Error('setup failed');
  return created.bookingId;
}

function lastLog() {
  return env.DB.prepare(`SELECT * FROM email_log ORDER BY id DESC LIMIT 1`)
    .first<{ booking_id: number; to_address: string; type: string; status: string; error: string | null }>();
}

describe('sendBookingNotification', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('APIキー未設定なら送信せず skipped でログされる', async () => {
    const id = await setup();
    let called = 0;
    const fakeFetch = (async () => { called++; return new Response('{}', { status: 200 }); }) as typeof fetch;
    await sendBookingNotification(env.DB, { NOTIFY_EMAIL_TO: 'owner@example.com' }, id, 'created', fakeFetch);
    expect(called).toBe(0);
    const log = await lastLog();
    expect(log?.status).toBe('skipped');
    expect(log?.type).toBe('created');
    expect(log?.booking_id).toBe(id);
  });

  it('キーがあれば送信され sent でログ。件名にラベルと顧客名入り、代理店メールも宛先に含む', async () => {
    const id = await setup({ agencyId: AGENCY_1, createdBy: 'agency', status: 'requested' });
    const calls: { url: string; body: any }[] = [];
    const fakeFetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response('{"id":"x"}', { status: 200 });
    }) as typeof fetch;
    await sendBookingNotification(
      env.DB,
      { RESEND_API_KEY: 'k', NOTIFY_EMAIL_TO: 'owner@example.com', NOTIFY_EMAIL_FROM: 'noreply@example.com' },
      id, 'requested', fakeFetch
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('api.resend.com');
    expect(calls[0].body.subject).toContain('予約リクエスト');
    expect(calls[0].body.subject).toContain('テスト太郎');
    expect(calls[0].body.to).toContain('owner@example.com');
    expect(calls[0].body.to).toContain('agency@example.com');
    expect(calls[0].body.text).toContain('プランA');
    const log = await lastLog();
    expect(log?.status).toBe('sent');
    expect(log?.to_address).toContain('owner@example.com');
  });

  it('fetchが例外を投げても通知関数は投げず error でログされる', async () => {
    const id = await setup();
    const fakeFetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    await sendBookingNotification(env.DB, { RESEND_API_KEY: 'k', NOTIFY_EMAIL_TO: 'o@example.com' }, id, 'created', fakeFetch);
    const log = await lastLog();
    expect(log?.status).toBe('error');
    expect(log?.error).toContain('network down');
  });

  it('APIが非2xxを返したら error でログされる', async () => {
    const id = await setup();
    const fakeFetch = (async () => new Response('bad key', { status: 401 })) as typeof fetch;
    await sendBookingNotification(env.DB, { RESEND_API_KEY: 'k', NOTIFY_EMAIL_TO: 'o@example.com' }, id, 'created', fakeFetch);
    const log = await lastLog();
    expect(log?.status).toBe('error');
    expect(log?.error).toContain('401');
  });

  it('NOTIFY_EMAIL_TO 未設定でも skipped でログされ例外は出ない', async () => {
    const id = await setup();
    await sendBookingNotification(env.DB, { RESEND_API_KEY: 'k' }, id, 'created');
    const log = await lastLog();
    expect(log?.status).toBe('skipped');
  });

  it('存在しない予約IDでは何もしない（ログも増えない）', async () => {
    await sendBookingNotification(env.DB, { NOTIFY_EMAIL_TO: 'o@example.com' }, 9999, 'created');
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_log`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- notify` → FAIL

- [ ] **Step 3: 実装（そのまま使う）**

`src/core/notify.ts`:
```ts
export type EmailType = 'created' | 'requested' | 'approved' | 'denied' | 'cancelled';

export interface NotifyEnv {
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL_TO?: string;
  NOTIFY_EMAIL_FROM?: string;
}

const TYPE_LABELS: Record<EmailType, string> = {
  created: '新規予約',
  requested: '予約リクエスト',
  approved: '予約承認',
  denied: '予約否認',
  cancelled: 'キャンセル'
};

interface BookingInfo {
  id: number;
  date: string;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  num_adults: number;
  num_children: number;
  total_amount: number;
  notes: string;
  plan_name: string;
  slot_name: string;
  start_time: string;
  agency_name: string | null;
  agency_email: string | null;
}

// 予約に関する通知メールを送る。絶対に例外を投げない（メール失敗で予約処理を失敗させないため）。
// APIキーまたは自社宛先が未設定なら送信せず email_log に skipped を記録する。
export async function sendBookingNotification(
  db: D1Database,
  env: NotifyEnv,
  bookingId: number,
  type: EmailType,
  fetcher: typeof fetch = fetch
): Promise<void> {
  try {
    const b = await db.prepare(
      `SELECT b.id, b.date, b.customer_name, b.customer_phone, b.party_size, b.num_adults, b.num_children,
              b.total_amount, b.notes, p.name AS plan_name, st.name AS slot_name, st.start_time,
              a.name AS agency_name, a.email AS agency_email
       FROM bookings b
       JOIN plans p ON p.id = b.plan_id
       JOIN slot_types st ON st.id = b.slot_type_id
       LEFT JOIN agencies a ON a.id = b.agency_id
       WHERE b.id = ?`
    ).bind(bookingId).first<BookingInfo>();
    if (!b) return;

    const subject = `【予約システム】${TYPE_LABELS[type]}: ${b.date} ${b.start_time} ${b.plan_name} ${b.customer_name}様 ${b.party_size}名`;
    const text = [
      `${TYPE_LABELS[type]}の通知です。`,
      ``,
      `参加日: ${b.date} ${b.start_time}（${b.slot_name}）`,
      `プラン: ${b.plan_name}`,
      `お名前: ${b.customer_name}様（大人${b.num_adults} 小人${b.num_children}）`,
      `電話: ${b.customer_phone || '-'}`,
      `金額: ${b.total_amount}円`,
      `経路: ${b.agency_name ?? '自社'}`,
      b.notes ? `備考: ${b.notes}` : '',
      ``,
      `予約ID: ${b.id}`
    ].filter((line) => line !== '').join('\n');

    const to = [env.NOTIFY_EMAIL_TO, b.agency_email].filter((x): x is string => !!x);

    if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL_TO) {
      await logEmail(db, bookingId, to.join(','), type, 'skipped', null);
      return;
    }

    try {
      const res = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: env.NOTIFY_EMAIL_FROM ?? 'onboarding@resend.dev',
          to,
          subject,
          text
        })
      });
      if (res.ok) {
        await logEmail(db, bookingId, to.join(','), type, 'sent', null);
      } else {
        await logEmail(db, bookingId, to.join(','), type, 'error', `HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (e) {
      await logEmail(db, bookingId, to.join(','), type, 'error', e instanceof Error ? e.message : String(e));
    }
  } catch {
    // ログ書き込みすら失敗しても呼び出し元には影響させない
  }
}

function logEmail(db: D1Database, bookingId: number, to: string, type: string, status: string, error: string | null) {
  return db.prepare(
    `INSERT INTO email_log (booking_id, to_address, type, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(bookingId, to, type, status, error, new Date().toISOString()).run();
}
```

- [ ] **Step 4: 全テスト green** — `npm test && npm run typecheck`（93件）
- [ ] **Step 5: Commit** — `feat: メール通知コア(Resend・fail-soft・email_log記録)`

---

### Task 2: 代理店マスタ管理

**Files:**
- Create: `src/routes/admin/agencies.tsx`, `test/admin-agencies.test.ts`
- Modify: `src/routes/admin.tsx`（`admin.route('/agencies', agencies)` を calendar より前に）, `src/routes/admin/ui.tsx`（ナビに `代理店` を 設定 の前に追加）

- [ ] **Step 1: 失敗するテストを書く**

`test/admin-agencies.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, AGENCY_1 } from './fixtures';

function form(data: Record<string, string>, cookie: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(data).toString()
  };
}

describe('admin agencies', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('一覧に代理店名・専用リンク・モードが表示される', async () => {
    const res = await app.request('/admin/agencies', { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト代理店');
    expect(html).toContain('/a/test-agency-token-0123456789abcdef');
    expect(html).toContain('リクエスト');
  });

  it('代理店を作成でき、32文字以上のトークンが発行される', async () => {
    const res = await app.request('/admin/agencies', form({
      name: 'ホテル金谷', email: 'kanaya@example.com', booking_mode: 'realtime'
    }, cookie), env);
    expect(res.status).toBe(302);
    const row = await env.DB.prepare(`SELECT token, booking_mode, active, email FROM agencies WHERE name = 'ホテル金谷'`)
      .first<{ token: string; booking_mode: string; active: number; email: string }>();
    expect(row?.token.length).toBeGreaterThanOrEqual(32);
    expect(row?.booking_mode).toBe('realtime');
    expect(row?.active).toBe(1);
  });

  it('編集でモード・有効フラグを変更できる', async () => {
    const res = await app.request(`/admin/agencies/${AGENCY_1}`, form({
      name: 'テスト代理店', email: 'agency@example.com', booking_mode: 'realtime', notes: ''
      // active チェックなし = 無効化
    }, cookie), env);
    expect(res.status).toBe(302);
    const row = await env.DB.prepare(`SELECT booking_mode, active FROM agencies WHERE id = ?`).bind(AGENCY_1)
      .first<{ booking_mode: string; active: number }>();
    expect(row).toEqual({ booking_mode: 'realtime', active: 0 });
  });

  it('トークンを再発行すると値が変わる', async () => {
    const before = await env.DB.prepare(`SELECT token FROM agencies WHERE id = ?`).bind(AGENCY_1).first<{ token: string }>();
    const res = await app.request(`/admin/agencies/${AGENCY_1}/reissue`, form({}, cookie), env);
    expect(res.status).toBe(302);
    const after = await env.DB.prepare(`SELECT token FROM agencies WHERE id = ?`).bind(AGENCY_1).first<{ token: string }>();
    expect(after?.token).not.toBe(before?.token);
    expect(after?.token.length).toBeGreaterThanOrEqual(32);
  });

  it('名前が空の作成は error=invalid', async () => {
    const res = await app.request('/admin/agencies', form({ name: '', email: '', booking_mode: 'request' }, cookie), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=invalid');
  });
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- admin-agencies` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`src/routes/admin/agencies.tsx`: `export const agencies = new Hono<{ Bindings: Bindings }>()`

- トークン生成: `function newToken(): string { return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); }`（32桁hex）
- **GET `/`**: 一覧表（名前 / モード表示 `即時確定`(realtime)・`リクエスト`(request) / メール / 有効(`有効`/`無効`) / 専用リンク（`{new URL(c.req.url).origin}/a/{token}` をそのままテキスト表示、コピーしやすいよう `<code>`）/ 再発行フォーム（POST `/admin/agencies/{id}/reissue`、ボタン `再発行`）/ `編集` リンク）。下に作成フォーム（`name` required、`email`、select `booking_mode`: request=リクエスト（承認制）/ realtime=即時確定）。`?ok=`/`?error=` メッセージ（ok=created→`代理店を作成しました`、ok=updated→`更新しました`、ok=reissued→`専用リンクを再発行しました。旧リンクは無効です`）
- **POST `/`**: name非空・booking_modeがrealtime/request → NG `?error=invalid`。OK: `INSERT INTO agencies (name, token, email, booking_mode, created_at) VALUES (?, ?, ?, ?, ?)`（email空→NULL）→ `?ok=created`
- **GET `/:id/edit`**: フォーム（name, email, select booking_mode 現値, active checkbox, notes textarea）action=`/admin/agencies/{id}`
- **POST `/:id`**: 検証同上 → `UPDATE agencies SET name=?, email=?, booking_mode=?, active=?, notes=? WHERE id=?` → `/admin/agencies?ok=updated`
- **POST `/:id/reissue`**: `UPDATE agencies SET token=? WHERE id=?` → `?ok=reissued`

`admin.tsx`: mount。`ui.tsx`: ナビ `代理店`（/admin/agencies）を 設定 の前に追加。

- [ ] **Step 4: 全テスト green** — `npm test && npm run typecheck`（98件）
- [ ] **Step 5: Commit** — `feat: 代理店マスタ管理(モード設定・専用リンク発行/再発行)`

---

### Task 3: 代理店向けページ

**Files:**
- Create: `src/routes/agency.tsx`, `test/agency-page.test.ts`
- Modify: `src/index.ts`（`app.route('/a', agency)` を追加）, `src/core/booking.ts`（`cancelBookingForAgency` 追加）

- [ ] **Step 1: 失敗するテストを書く**

`test/agency-page.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { seedBasic, makeBooking, PLAN_A, PLAN_B, SLOT_AM, AGENCY_1 } from './fixtures';
import { createBooking } from '../src/core/booking';

const TOKEN = 'test-agency-token-0123456789abcdef';
const D = '2026-08-01';

function form(data: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  };
}

const bookingForm = (over: Record<string, string> = {}) => form({
  plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
  customer_name: '代理店経由の客', customer_phone: '090-1111-2222',
  num_adults: '2', num_children: '0', notes: '', ...over
});

describe('agency page', () => {
  beforeEach(async () => {
    await seedBasic(env.DB);
  });

  it('有効トークンで空き状況とフォームが表示される', async () => {
    const res = await app.request(`/a/${TOKEN}`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('テスト代理店');
    expect(html).toContain('プランA');
    expect(html).toContain(`action="/a/${TOKEN}/bookings"`);
  });

  it('無効トークン・無効化された代理店は404', async () => {
    expect((await app.request('/a/wrong-token', {}, env)).status).toBe(404);
    await env.DB.prepare(`UPDATE agencies SET active = 0 WHERE id = ?`).bind(AGENCY_1).run();
    expect((await app.request(`/a/${TOKEN}`, {}, env)).status).toBe(404);
  });

  it('リクエストモードの代理店の予約は requested で登録され、在庫を押さえる', async () => {
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?ok=requested`);
    const row = await env.DB.prepare(
      `SELECT status, agency_id, created_by, payment_method, total_amount FROM bookings WHERE customer_name = '代理店経由の客'`
    ).first<{ status: string; agency_id: number; created_by: string; payment_method: string; total_amount: number }>();
    expect(row).toEqual({ status: 'requested', agency_id: AGENCY_1, created_by: 'agency', payment_method: 'invoice', total_amount: 16000 });
    // 在庫を押さえている: 同時間帯の連動プランは不可
    expect((await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '別件' }))).ok).toBe(false);
  });

  it('即時確定モードなら confirmed で登録される', async () => {
    await env.DB.prepare(`UPDATE agencies SET booking_mode = 'realtime' WHERE id = ?`).bind(AGENCY_1).run();
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?ok=created`);
    const row = await env.DB.prepare(`SELECT status FROM bookings WHERE customer_name = '代理店経由の客'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('confirmed');
  });

  it('埋まっている枠には error=unavailable', async () => {
    await createBooking(env.DB, makeBooking({ planId: PLAN_B, customerName: '先客' }));
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    expect(res.headers.get('location')).toBe(`/a/${TOKEN}?error=unavailable`);
  });

  it('自店の予約だけが一覧に見える', async () => {
    await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: 2, customerName: '自社の客' }));
    const html = await (await app.request(`/a/${TOKEN}`, {}, env)).text();
    expect(html).toContain('代理店経由の客');
    expect(html).not.toContain('自社の客');
  });

  it('自店の予約をキャンセルできる。自社の予約はキャンセルできない', async () => {
    await app.request(`/a/${TOKEN}/bookings`, bookingForm(), env);
    const own = await env.DB.prepare(`SELECT id FROM bookings WHERE customer_name = '代理店経由の客'`).first<{ id: number }>();
    const other = await createBooking(env.DB, makeBooking({ planId: PLAN_A, slotTypeId: 2, customerName: '自社の客' }));
    if (!other.ok) throw new Error('setup failed');

    let res = await app.request(`/a/${TOKEN}/bookings/${own!.id}/cancel`, form({}), env);
    expect(res.status).toBe(302);
    const cancelled = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(own!.id).first<{ status: string }>();
    expect(cancelled?.status).toBe('cancelled');

    res = await app.request(`/a/${TOKEN}/bookings/${other.bookingId}/cancel`, form({}), env);
    const untouched = await env.DB.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(other.bookingId).first<{ status: string }>();
    expect(untouched?.status).toBe('confirmed');
  });

  it('人数合計0は error=invalid', async () => {
    const res = await app.request(`/a/${TOKEN}/bookings`, bookingForm({ num_adults: '0', num_children: '0' }), env);
    expect(res.headers.get('location')).toContain('error=invalid');
  });
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- agency-page` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

`src/core/booking.ts` に追加:
```ts
// 代理店は自店の予約のみキャンセルできる（agency_id 条件込みの1文UPDATEで所有権チェックも原子的に行う）
export async function cancelBookingForAgency(db: D1Database, bookingId: number, agencyId: number): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = ?
     WHERE id = ? AND agency_id = ? AND status IN ('confirmed', 'requested')`
  ).bind(new Date().toISOString(), bookingId, agencyId).run();
  return res.meta.changes === 1;
}
```

`src/routes/agency.tsx`: `export const agency = new Hono<{ Bindings: Bindings }>()`

- 全ルート冒頭で `SELECT * FROM agencies WHERE token = ? AND active = 1` により代理店を解決。無ければ `c.notFound()`（`:token` はパスパラメータ）
- **GET `/:token`**: 独自の簡易レイアウト（管理画面のLayoutは使わない。`<title>{代理店名}様専用 予約ページ`、ヘッダに代理店名。CSSは最小限のインライン）
  1. `?ok=`/`?error=` メッセージ（ok=created→`予約を登録しました`、ok=requested→`予約リクエストを送信しました。承認後に確定します`、ok=cancelled→`キャンセルしました`）
  2. **空き状況表**: クエリ `from`（YYYY-MM-DD、既定=今日JST）から14日分。`getAvailability` を利用。行=プラン×時刻（activeのみ、プランsort→時刻sort）、列=日付（`M/D`表示）。セル: open→残席数 / full・linked_closed→`×` / manual_closed→`休`。表の上に `前の14日` `次の14日` リンク（`?from=` を±14日。範囲は今日〜今日+60日にクランプ）
  3. **予約フォーム** action=`/a/{token}/bookings`: select `plan_id`（activeプラン）、select `slot_type_id`（全時刻。名前と時刻表示）、`date`（type=date）、`num_adults`（min0 value1）、`num_children`（min0 value0）、`customer_name` required、`customer_phone`、`notes`。booking_modeがrequestなら注記 `※ご予約はリクエストとして送信され、承認後に確定します`。**料金・支払方法の入力欄は無し**（単価はプランから自動、支払方法は invoice 固定）
  4. **自店予約一覧**: `WHERE agency_id = ?` の予約を日付降順（列: 参加日/時刻/プラン/顧客名/人数(大X小Y)/金額/状態）。状態は `BOOKING_STATUS_LABELS`（ui.tsxからimport可）。requested/confirmed の行に キャンセルフォーム（POST `/a/{token}/bookings/{id}/cancel`）
- **POST `/:token/bookings`**: 検証（管理画面と同基準。date形式・非空名前・人数計1以上）→ NG `?error=invalid`。プランの単価取得→ `createBooking(db, { ..., agencyId: 代理店id, createdBy: 'agency', paymentMethod: 'invoice', totalAmount: 自動計算, priceAdult/priceChild: プラン値, status: 代理店.booking_mode === 'request' ? 'requested' : 'confirmed' })` → 成功: `?ok=requested|created` / 失敗: `?error=unavailable`
- **POST `/:token/bookings/:id/cancel`**: `cancelBookingForAgency(db, id, 代理店id)` → `?ok=cancelled` / `?error=invalid`

`src/index.ts`: `app.route('/a', agency)` を追加。

- [ ] **Step 4: 全テスト green** — `npm test && npm run typecheck`（106件）
- [ ] **Step 5: Commit** — `feat: 代理店向け予約ページ(空き表・予約・自店一覧・キャンセル)`

---

### Task 4: 通知の結線と管理画面のエラーバナー

**Files:**
- Modify: `src/routes/agency.tsx`, `src/routes/admin/calendar.tsx`
- Create: `test/notify-wiring.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/notify-wiring.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';
import { adminCookie } from './helpers';
import { seedBasic, makeBooking, PLAN_A, SLOT_AM } from './fixtures';
import { createBooking } from '../src/core/booking';

const TOKEN = 'test-agency-token-0123456789abcdef';
const D = '2026-08-01';

function form(data: Record<string, string>, cookie = '') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(data).toString()
  };
}

async function logsByType(type: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_log WHERE type = ?`).bind(type).first<{ n: number }>();
  return r?.n ?? 0;
}

describe('notification wiring', () => {
  let cookie: string;
  beforeEach(async () => {
    await seedBasic(env.DB);
    cookie = await adminCookie();
  });

  it('代理店の予約リクエストで requested 通知が記録される（キー未設定なので skipped）', async () => {
    await app.request(`/a/${TOKEN}/bookings`, form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '通知客', customer_phone: '', num_adults: '1', num_children: '0', notes: ''
    }), env);
    expect(await logsByType('requested')).toBe(1);
    const log = await env.DB.prepare(`SELECT status FROM email_log LIMIT 1`).first<{ status: string }>();
    expect(log?.status).toBe('skipped');
  });

  it('管理画面の承認・否認で approved / denied 通知が記録される', async () => {
    const r1 = await createBooking(env.DB, makeBooking({ status: 'requested' }));
    const r2 = await createBooking(env.DB, makeBooking({ status: 'requested', slotTypeId: 2, customerName: '否認される客' }));
    if (!r1.ok || !r2.ok) throw new Error('setup failed');
    await app.request(`/admin/bookings/${r1.bookingId}/approve`, form({ back: '/admin/requests' }, cookie), env);
    await app.request(`/admin/bookings/${r2.bookingId}/deny`, form({ back: '/admin/requests' }, cookie), env);
    expect(await logsByType('approved')).toBe(1);
    expect(await logsByType('denied')).toBe(1);
  });

  it('管理画面の新規予約とキャンセルでも created / cancelled 通知が記録される', async () => {
    await app.request('/admin/bookings', form({
      plan_id: String(PLAN_A), slot_type_id: String(SLOT_AM), date: D,
      customer_name: '電話の客', customer_phone: '', num_adults: '1', num_children: '0',
      total_amount: '0', payment_method: 'onsite_cash', notes: ''
    }, cookie), env);
    expect(await logsByType('created')).toBe(1);
    const b = await env.DB.prepare(`SELECT id FROM bookings LIMIT 1`).first<{ id: number }>();
    await app.request(`/admin/bookings/${b!.id}/cancel`, form({ date: D }, cookie), env);
    expect(await logsByType('cancelled')).toBe(1);
  });

  it('email_log にエラーがあると管理画面ホームに警告が出る', async () => {
    await env.DB.prepare(
      `INSERT INTO email_log (booking_id, to_address, type, status, error, created_at)
       VALUES (NULL, 'x@example.com', 'created', 'error', 'HTTP 401', '2026-07-07T00:00:00.000Z')`
    ).run();
    const res = await app.request('/admin', { headers: { cookie } }, env);
    const html = await res.text();
    expect(html).toContain('メール送信エラー');
  });
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- notify-wiring` → FAIL

- [ ] **Step 3: 実装（コントラクト）**

- `agency.tsx`: 予約成功後 `await sendBookingNotification(c.env.DB, c.env, id, status === 'requested' ? 'requested' : 'created')`。キャンセル成功後 `'cancelled'`
- `calendar.tsx`: POST `/bookings` 成功後 `'created'`、`/bookings/:id/cancel` 成功後 `'cancelled'`、`/approve` 成功後 `'approved'`、`/deny` 成功後 `'denied'`（変更 POST `/bookings/:id` は通知しない — 頻度が高くノイズになるため。コメントで明記）
- `calendar.tsx` GET `/`（カレンダー）: `SELECT COUNT(*) AS n FROM email_log WHERE status = 'error'` が1以上なら、ページ上部に `class="msg-error"` で `メール送信エラーが{n}件あります（email_logを確認してください）` を表示

- [ ] **Step 4: 全テスト green** — `npm test && npm run typecheck`（110件）
- [ ] **Step 5: Commit** — `feat: 予約フローへのメール通知結線と送信エラーの管理画面警告`

---

### Task 5: 仕上げ（README・E2E・マージ）

- [ ] **Step 1: README** — 「管理画面の機能」に `代理店管理: 専用リンク発行/再発行・予約モード（即時確定/リクエスト）` を追加。新セクション:
```markdown
## 代理店ページ

- 専用リンク `/a/{トークン}`（ログイン不要）から空き確認と予約・キャンセル
- 代理店の予約モードにより即時確定またはリクエスト（承認制）
- 予約・承認・否認・キャンセル時にメール通知（Resend。RESEND_API_KEY 未設定時は送信スキップしログのみ）
```
開発ステップ: `4. 代理店連携` に `（このリポジトリの現状）` を移動。
- [ ] **Step 2: 検証** — `npm test && npm run typecheck` 全green
- [ ] **Step 3: Commit** — `docs: README更新(ステップ3完了)`
- [ ] **Step 4: コントローラによるE2E**（代理店リンク発行→代理店ページで予約→承認待ち→承認→代理店ページで状態確認→キャンセル、email_logの記録確認）→ mainへマージ→push

## 完了条件

- 全テストgreen（87 + notify 6 + agencies 5 + agency-page 8 + wiring 4 = 110件）
- 代理店リンクを知らない限り予約ページに到達できない（トークン404・無効化404がテスト済み）
- メール未設定でも全フローが動作し、email_log に記録される
