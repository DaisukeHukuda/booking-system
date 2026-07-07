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
