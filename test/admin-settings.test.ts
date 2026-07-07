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
