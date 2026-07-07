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
