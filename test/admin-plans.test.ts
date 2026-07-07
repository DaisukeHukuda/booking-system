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
    const row = await env.DB.prepare(`SELECT name, price_adult, active FROM plans WHERE name = '新プラン'`)
      .first<{ name: string; price_adult: number; active: number }>();
    expect(row).toEqual({ name: '新プラン', price_adult: 5000, active: 1 });
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
    const plan = await env.DB.prepare(`SELECT name, price_adult FROM plans WHERE id = ?`).bind(PLAN_A)
      .first<{ name: string; price_adult: number }>();
    expect(plan).toEqual({ name: 'プランA改', price_adult: 9000 });
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
