import type { Child } from 'hono/jsx';
import type { SlotStatus, PaymentMethod, BookingStatus } from '../../types';

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/admin', label: '台帳カレンダー' },
  { href: '/admin/new', label: '新規予約' },
  { href: '/admin/search', label: '予約検索' },
  { href: '/admin/ledger', label: '予約台帳' },
  { href: '/admin/today', label: '本日の台帳' },
  { href: '/admin/slots', label: '予約枠' },
  { href: '/admin/requests', label: '承認待ち' },
  { href: '/admin/plans', label: 'プラン' },
  { href: '/admin/agencies', label: '代理店' },
  { href: '/admin/stats', label: '集計' },
  { href: '/admin/settings', label: '設定' }
];

export const Layout = (props: { title: string; active?: string; narrow?: boolean; children: Child }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title}</title>
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <header class="site-header">
        <div class="inner">
          <a class="brand" href="/admin">
            Sup! Sup!<small>RESERVATION LEDGER</small>
          </a>
          <nav class="nav">
            {NAV_ITEMS.map((item) => (
              <a href={item.href} class={item.href === props.active ? 'is-active' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          <div class="header-actions">
            <form method="post" action="/admin/logout">
              <button class="btn btn-sm btn-onnavy" type="submit">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      <main class={`page${props.narrow ? ' page-narrow' : ''}`}>{props.children}</main>
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

// 日別詳細ページの空き状況マトリクス（c-open/c-full/c-linked/c-manual）用
export const STATUS_CELL_CLASSES: Record<SlotStatus, string> = {
  open: 'c-open',
  full: 'c-full',
  linked_closed: 'c-linked',
  manual_closed: 'c-manual'
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  requested: 'リクエスト',
  confirmed: '確定',
  cancelled: '取消',
  denied: '否認'
};

export const BOOKING_BADGE_CLASSES: Record<BookingStatus, string> = {
  requested: 'bk-request',
  confirmed: 'bk-confirmed',
  cancelled: 'bk-cancelled',
  denied: 'bk-denied'
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  onsite_cash: '現地現金',
  onsite_card: '現地カード',
  invoice: '請求書',
  stripe: '事前決済'
};
