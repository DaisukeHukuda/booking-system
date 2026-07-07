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
