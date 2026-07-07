import type { Child } from 'hono/jsx';
import type { SlotStatus, PaymentMethod, BookingStatus } from '../../types';

const LAYOUT_STYLE = `
  body { font-family: sans-serif; margin: 0; padding: 0; }
  header { background: #f4f4f4; border-bottom: 1px solid #ccc; padding: 0.5rem 1rem; }
  header nav { display: flex; align-items: center; gap: 1rem; }
  header nav a { text-decoration: none; color: #333; }
  header nav form { margin: 0 0 0 auto; }
  main { padding: 1rem; }
  table { border-collapse: collapse; }
  table th, table td { border: 1px solid #ccc; padding: 0.25rem 0.5rem; }
  .st-open { color: #0a7d33; }
  .st-full { color: #c0392b; }
  .st-linked { color: #d35400; }
  .st-manual { color: #7f8c8d; }
  .msg-ok { color: green; }
  .msg-error { color: red; }
`;

export const Layout = (props: { title: string; children: Child }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title}</title>
      <style>{LAYOUT_STYLE}</style>
    </head>
    <body>
      <header>
        <nav>
          <a href="/admin">予約台帳</a>
          <a href="/admin/requests">承認待ち</a>
          <a href="/admin/plans">プラン</a>
          <a href="/admin/settings">設定</a>
          <form method="post" action="/admin/logout">
            <button type="submit">ログアウト</button>
          </form>
        </nav>
      </header>
      <main>{props.children}</main>
    </body>
  </html>
);

export const STATUS_LABELS: Record<SlotStatus, string> = {
  open: '空き',
  full: '満席',
  linked_closed: '連動クローズ',
  manual_closed: '手動クローズ'
};

export const STATUS_CLASSES: Record<SlotStatus, string> = {
  open: 'st-open',
  full: 'st-full',
  linked_closed: 'st-linked',
  manual_closed: 'st-manual'
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  requested: 'リクエスト',
  confirmed: '確定',
  cancelled: '取消',
  denied: '否認'
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  onsite_cash: '現地現金',
  onsite_card: '現地カード',
  invoice: '請求書',
  stripe: '事前決済'
};
