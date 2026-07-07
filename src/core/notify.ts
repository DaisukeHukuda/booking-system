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
