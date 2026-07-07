import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('schema', () => {
  it('全テーブルが存在する', async () => {
    const res = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name`
    ).all<{ name: string }>();
    expect(res.results.map((r) => r.name)).toEqual([
      'agencies', 'bookings', 'capacity_overrides', 'email_log', 'plan_fields', 'plan_resources',
      'plan_slots', 'plans', 'price_overrides', 'resources', 'slot_closures', 'slot_types'
    ]);
  });
});
