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
