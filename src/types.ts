export type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
};

export type PaymentMethod = 'onsite_cash' | 'onsite_card' | 'invoice' | 'stripe';

export type BookingStatus = 'requested' | 'confirmed' | 'cancelled' | 'denied';

export interface NewBooking {
  planId: number;
  date: string; // 'YYYY-MM-DD'
  slotTypeId: number;
  agencyId?: number | null;
  customerName: string;
  customerPhone?: string;
  numAdults: number;
  numChildren: number;
  priceAdult: number;   // 予約時点の単価スナップショット
  priceChild: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
  createdBy: 'admin' | 'agency';
  status?: 'confirmed' | 'requested'; // 省略時 confirmed
}

export type BookingResult =
  | { ok: true; bookingId: number }
  | { ok: false; reason: 'slot_unavailable' };

export type SlotStatus = 'open' | 'full' | 'linked_closed' | 'manual_closed';

export interface SlotAvailability {
  planId: number;
  date: string;
  slotTypeId: number;
  status: SlotStatus;
  capacity: number;
  booked: number;
  remaining: number;
  blockingPlanIds: number[]; // linked_closed の原因プラン（それ以外は空配列）
}
