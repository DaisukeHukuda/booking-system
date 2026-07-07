export const STYLE_CSS: string = `/* ============================================================
   Sup! Sup! 予約管理システム — style.css
   単一ファイル・クラスベース・外部フォント/CDNなし
   ベース: Yamamotoya Design System（紺 #16294f / コバルト #0050b0 /
   フラット塗り / 直角 / 1px罫線）を業務ツール向けに適用
   ============================================================ */

:root {
  /* ink */
  --ink:    #131619;
  --ink-2:  #3b424b;
  --ink-3:  #6c727b;
  --ink-4:  #9aa0a8;
  /* surfaces */
  --canvas: #ffffff;
  --paper:  #f6f4ee;
  --paper-2:#edeae1;
  --paper-3:#e3dfd3;
  /* brand */
  --navy:     #16294f;
  --navy-2:   #22345c;
  --navy-ink: #0e1a34;
  --cobalt:   #0050b0;
  --cobalt-2: #0a63cf;
  --cobalt-ink:#003f8c;
  --lake:     #9ec3bd;
  --sky:      #a9c4d6;
  /* semantic status */
  --open:        #3f7d4e;  --open-soft:   #e4efe4;
  --full:        #b23a34;  --full-soft:   #f6e0dd;
  --linked:      #c98a2b;  --linked-soft: #f6ecd6;
  --manual:      #6c727b;  --manual-soft: #e9e9e7;
  /* borders */
  --line:      #131619;
  --line-soft: #d8d4c8;
  /* type */
  --sans: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI",
          "Yu Gothic", "Meiryo", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "SFMono-Regular", "Menlo", "Consolas",
          "Osaka-Mono", "MS Gothic", monospace;
  /* controls */
  --tap: 44px;
  --focus: 0 0 0 3px rgba(0, 80, 176, .35);
}

/* ---------- base ---------- */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 400 15px/1.7 var(--sans);
  letter-spacing: .03em;
  font-feature-settings: "palt";
}
a { color: var(--cobalt); text-underline-offset: 3px; }
a:hover { color: var(--cobalt-2); }
h1, h2, h3 { line-height: 1.3; letter-spacing: .02em; }
h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
h2 { font-size: 17px; font-weight: 700; margin: 32px 0 12px;
     padding-left: 10px; border-left: 4px solid var(--navy); }
h3 { font-size: 15px; font-weight: 700; margin: 20px 0 8px; }

/* 数字はモノスペースで揃える */
.num { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: 0; }

/* 欧文小ラベル（アイブロー） */
.eyebrow {
  font: 700 11px/1 var(--mono);
  letter-spacing: .18em; text-transform: uppercase;
  color: var(--cobalt);
}

/* ---------- header（紺の帯） ---------- */
.site-header {
  background: var(--navy); color: #fff;
  border-bottom: 3px solid var(--navy-ink);
}
.site-header .inner {
  max-width: 1240px; margin: 0 auto; padding: 0 16px;
  display: flex; align-items: center; gap: 20px; min-height: 52px; flex-wrap: wrap;
}
.brand {
  font: 700 16px/1 var(--mono); letter-spacing: .08em;
  color: #fff; text-decoration: none; white-space: nowrap;
  padding: 8px 0;
}
.brand small { display: block; font: 400 9px/1 var(--mono); letter-spacing: .22em; color: var(--sky); margin-top: 4px; }
.nav { display: flex; gap: 2px; flex-wrap: wrap; margin-left: 8px; }
.nav a {
  display: flex; align-items: center; min-height: var(--tap);
  padding: 0 12px; color: rgba(255,255,255,.85);
  text-decoration: none; font-size: 13.5px; font-weight: 500;
  border-bottom: 3px solid transparent; margin-bottom: -3px;
  white-space: nowrap;
}
.nav a:hover { color: #fff; background: var(--navy-2); }
.nav a.is-active { color: #fff; border-bottom-color: #fff; font-weight: 700; }
.header-actions { margin-left: auto; }
.btn-onnavy { background: transparent; color: #fff; border-color: rgba(255,255,255,.55); }
.btn-onnavy:hover { background: var(--navy-2); color: #fff; }

/* ---------- layout ---------- */
.page { max-width: 1240px; margin: 0 auto; padding: 24px 16px 64px; }
.page-head { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.page-head .sub { color: var(--ink-3); font-size: 13px; }
.page-narrow { max-width: 760px; }

/* カード（白面 + 1px罫） */
.card { background: var(--canvas); border: 1px solid var(--line); }
.card-pad { padding: 16px; }

/* ---------- buttons ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 36px; padding: 4px 14px;
  background: var(--canvas); color: var(--ink);
  border: 1px solid var(--line); border-radius: 0;
  font: 700 13.5px/1 var(--sans); letter-spacing: .04em;
  cursor: pointer; text-decoration: none; white-space: nowrap;
  transition: background .12s;
}
.btn:hover { background: var(--paper-2); color: var(--ink); }
.btn:active { background: var(--paper-3); }
.btn:focus-visible { outline: none; box-shadow: var(--focus); }
.btn-primary { background: var(--navy); border-color: var(--navy); color: #fff; }
.btn-primary:hover { background: var(--navy-2); color: #fff; }
.btn-primary:active { background: var(--navy-ink); }
.btn-danger { color: var(--full); border-color: var(--full); background: var(--canvas); }
.btn-danger:hover { background: var(--full-soft); color: var(--full); }
.btn-ok { color: var(--open); border-color: var(--open); background: var(--canvas); }
.btn-ok:hover { background: var(--open-soft); color: var(--open); }
.btn-sm { min-height: 30px; padding: 2px 10px; font-size: 12.5px; }
.btn-lg { min-height: var(--tap); padding: 8px 22px; font-size: 15px; }
.btn-block { display: flex; width: 100%; }

/* ---------- forms ---------- */
input[type="text"], input[type="tel"], input[type="number"], input[type="date"],
input[type="time"], input[type="password"], input[type="email"], select, textarea {
  font: 400 15px/1.4 var(--sans);
  color: var(--ink); background: var(--canvas);
  border: 1px solid var(--ink-3); border-radius: 0;
  min-height: 38px; padding: 6px 10px;
  max-width: 100%;
}
input[type="number"] { font-family: var(--mono); letter-spacing: 0; }
textarea { line-height: 1.6; }
input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: none; border-color: var(--cobalt); box-shadow: var(--focus);
}
input:disabled, select:disabled { background: var(--paper-2); color: var(--ink-4); }
::placeholder { color: var(--ink-4); }
label { font-size: 13px; font-weight: 700; color: var(--ink-2); }

.field { display: flex; flex-direction: column; gap: 4px; }
.field .hint { font-size: 12px; font-weight: 400; color: var(--ink-3); }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 16px; align-items: end; }
.form-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
.w-sm { width: 90px; } .w-md { width: 160px; } .w-lg { width: 240px; }

.check { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 400; min-height: 32px; cursor: pointer; }
.check input { width: 18px; height: 18px; accent-color: var(--navy); }

/* ---------- tables ---------- */
.tbl-wrap { overflow-x: auto; background: var(--canvas); border: 1px solid var(--line); }
.tbl { border-collapse: collapse; width: 100%; background: var(--canvas); font-size: 14px; }
.tbl th, .tbl td { border: 1px solid var(--line-soft); padding: 8px 10px; text-align: left; vertical-align: middle; }
.tbl thead th {
  background: var(--paper); border-bottom: 2px solid var(--line);
  font-size: 12px; letter-spacing: .06em; color: var(--ink-2);
  white-space: nowrap;
}
.tbl tbody tr:nth-child(even) { background: #fbfaf7; }
.tbl .num, .tbl td.r { text-align: right; }
.tbl .actions { white-space: nowrap; }
.tbl .actions form { display: inline-block; margin: 0; }
.tbl tfoot td { border-top: 2px solid var(--line); font-weight: 700; background: var(--paper); }

/* 取消・否認行は薄く */
.row-muted { color: var(--ink-4); }
.row-muted td { color: var(--ink-4); }
.row-muted .badge { opacity: .55; }

/* ---------- badges（状態） ---------- */
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 1px 8px; border: 1px solid; border-radius: 0;
  font-size: 12px; font-weight: 700; white-space: nowrap; line-height: 1.6;
}
.badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.st-open   { color: var(--open);   background: var(--open-soft);   border-color: var(--open); }
.st-full   { color: var(--full);   background: var(--full-soft);   border-color: var(--full); }
.st-linked { color: var(--linked); background: var(--linked-soft); border-color: var(--linked); }
.st-manual { color: var(--manual); background: var(--manual-soft); border-color: var(--manual); }

/* 予約状態 */
.bk-confirmed { color: var(--navy);   background: #e8ecf4; border-color: var(--navy); }
.bk-request   { color: var(--linked); background: var(--linked-soft); border-color: var(--linked); }
.bk-cancelled { color: var(--ink-4);  background: var(--paper-2); border-color: var(--ink-4); }
.bk-denied    { color: var(--ink-4);  background: var(--paper-2); border-color: var(--ink-4); }

/* ---------- messages ---------- */
.msg-ok, .msg-error, .banner-warn {
  padding: 10px 14px; border: 1px solid; margin: 0 0 16px;
  font-size: 14px; font-weight: 500;
}
.msg-ok    { color: var(--open); background: var(--open-soft); border-color: var(--open); }
.msg-error { color: var(--full); background: var(--full-soft); border-color: var(--full); }
.banner-warn {
  color: var(--ink); background: var(--linked-soft); border-color: var(--linked);
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
}
.banner-warn strong { color: var(--linked); }
.banner-warn .btn { margin-left: auto; }

/* ---------- 台帳カレンダー ---------- */
.cal-nav { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
.cal-nav .spacer { flex: 1; }

.cal { display: grid; grid-template-columns: repeat(7, 1fr); background: var(--canvas); border: 1px solid var(--line); }
.cal-dow {
  padding: 6px 8px; background: var(--paper);
  border-bottom: 2px solid var(--line); border-right: 1px solid var(--line-soft);
  font-size: 12px; font-weight: 700; color: var(--ink-2); text-align: center;
}
.cal-dow:last-child { border-right: none; }
.cal-dow.sun, .cal-daynum.sun { color: var(--full); }
.cal-dow.sat, .cal-daynum.sat { color: var(--cobalt); }

.cal-cell {
  min-height: 108px; padding: 4px;
  border-right: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft);
  display: block; color: inherit; text-decoration: none; background: var(--canvas);
}
.cal-cell:nth-child(7n) { border-right: none; }
a.cal-cell:hover { background: #eef3f9; }
.cal-cell.is-empty { background: var(--paper); }
.cal-cell.is-today { outline: 2px solid var(--cobalt); outline-offset: -2px; }
.cal-daynum { font: 700 13px/1 var(--mono); padding: 3px 4px 5px; display: flex; gap: 6px; align-items: baseline; }
.cal-daynum .today-label { font: 700 9px/1 var(--mono); letter-spacing: .1em; color: var(--cobalt); }

/* 日セル内の時間帯行: ドット + 時間帯名 + 人数 */
.cal-slot {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; line-height: 1.3; padding: 2px 3px; min-width: 0;
}
.cal-slot + .cal-slot { border-top: 1px dotted var(--line-soft); }
.cal-slot .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.cal-slot .t { color: var(--ink-2); flex: none; }
.cal-slot .n { font-family: var(--mono); font-weight: 700; margin-left: auto; letter-spacing: 0; }
.cal-slot.s-open   .dot { background: var(--open); }
.cal-slot.s-full   .dot { background: var(--full); }
.cal-slot.s-full   .n   { color: var(--full); }
.cal-slot.s-linked .dot { background: var(--linked); }
.cal-slot.s-manual .dot { background: var(--manual); }
.cal-slot.s-manual { color: var(--ink-4); }
.cal-slot.s-manual .t { color: var(--ink-4); }

.cal-legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 10px 2px 0; font-size: 12px; color: var(--ink-2); }
.cal-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cal-legend i { width: 9px; height: 9px; border-radius: 50%; }
.cal-legend .lg-open i { background: var(--open); }
.cal-legend .lg-full i { background: var(--full); }
.cal-legend .lg-linked i { background: var(--linked); }
.cal-legend .lg-manual i { background: var(--manual); }

/* ---------- 空き状況マトリクス（日別詳細） ---------- */
.avail td { padding: 0; height: 1px; }
.avail .cell { display: block; box-sizing: border-box; height: 100%; padding: 8px 10px; min-height: 58px; }
.avail .state { font-weight: 700; font-size: 13px; display: block; }
.avail .zan { font-family: var(--mono); font-size: 16px; font-weight: 700; letter-spacing: 0; }
.avail .why { font-size: 11px; color: var(--ink-3); display: block; }
.avail .c-open   { background: var(--open-soft); }
.avail .c-open .state { color: var(--open); }
.avail .c-full   { background: var(--full-soft); }
.avail .c-full .state { color: var(--full); }
.avail .c-linked { background: var(--linked-soft); }
.avail .c-linked .state { color: var(--linked); }
.avail .c-manual { background: var(--manual-soft); color: var(--ink-3); }
.avail .cap-form { display: flex; gap: 4px; align-items: center; margin-top: 6px; }
.avail .cap-form input { min-height: 28px; width: 56px; padding: 2px 6px; font-size: 13px; }
.avail .cap-form .btn { min-height: 28px; padding: 1px 8px; font-size: 11.5px; font-weight: 500; }

/* ---------- 代理店ページ（柔らかめトーン） ---------- */
.agency body, body.agency { background: #f2f6f5; }
.agency-hero {
  background: var(--lake); border-bottom: 3px solid var(--navy);
  color: var(--ink);
}
.agency-hero .inner { max-width: 1080px; margin: 0 auto; padding: 20px 16px; }
.agency-hero h1 { font-size: 21px; margin: 2px 0 0; }
.agency-hero .for { font-size: 13px; font-weight: 700; color: var(--navy); }
.agency-page { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
.agency-note {
  background: #eef3f2; border: 1px solid var(--lake);
  padding: 10px 14px; font-size: 13.5px; color: var(--ink-2); margin: 0 0 16px;
}

/* 14日空き表 */
.grid14 th.day { min-width: 52px; text-align: center; font-family: var(--mono); letter-spacing: 0; }
.grid14 th.day .dow { display: block; font-size: 10px; color: var(--ink-3); }
.grid14 th.day.sun, .grid14 th.day.sun .dow { color: var(--full); }
.grid14 th.day.sat, .grid14 th.day.sat .dow { color: var(--cobalt); }
.grid14 td.slot-cell { text-align: center; padding: 4px 2px; font-family: var(--mono); font-weight: 700; letter-spacing: 0; }
.grid14 .ok   { color: var(--open); background: var(--open-soft); }
.grid14 .last { color: var(--linked); background: var(--linked-soft); }  /* 残りわずか */
.grid14 .ng   { color: var(--full); background: var(--full-soft); }
.grid14 .off  { color: var(--ink-4); background: var(--manual-soft); }
.grid14 .plan-name { white-space: nowrap; font-weight: 700; }
.grid14 .plan-name .time { font-family: var(--mono); font-weight: 400; color: var(--ink-3); font-size: 12px; letter-spacing: 0; }

/* ---------- ログイン ---------- */
.login-wrap { min-height: 70vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login-card { width: 360px; max-width: 100%; background: var(--canvas); border: 1px solid var(--line); border-top: 4px solid var(--navy); padding: 28px; }
.login-card .brand-lg { font: 700 22px/1 var(--mono); letter-spacing: .06em; }
.login-card .brand-lg small { display: block; font-size: 10px; letter-spacing: .22em; color: var(--cobalt); margin-top: 6px; }

/* ---------- utility ---------- */
.stack-24 > * + * { margin-top: 24px; }
.muted { color: var(--ink-3); }
.small { font-size: 12.5px; }
.nowrap { white-space: nowrap; }
.copy-link { display: flex; gap: 6px; align-items: center; }
.copy-link input { font-family: var(--mono); font-size: 12px; letter-spacing: 0; min-height: 30px; padding: 3px 8px; width: 210px; color: var(--ink-3); }

/* ============================================================
   レスポンシブ
   ============================================================ */
@media (max-width: 900px) {
  .page { padding: 16px 10px 56px; }
  h1 { font-size: 20px; }
}

@media (max-width: 720px) {
  /* タップターゲット拡大 */
  .btn { min-height: var(--tap); }
  .btn-sm { min-height: 38px; }

  /* --- 台帳カレンダー: 7列 → 1列リスト --- */
  .cal { grid-template-columns: 1fr; border-top: none; }
  .cal-dow { display: none; }
  .cal-cell { min-height: 0; display: grid; grid-template-columns: 64px 1fr; gap: 0 8px; padding: 8px; border-right: none; }
  .cal-cell.is-empty { display: none; }
  .cal-daynum { font-size: 15px; flex-direction: column; gap: 2px; }
  .cal-daynum .dow-inline { display: inline; font: 400 11px/1 var(--mono); color: var(--ink-3); }
  .cal-slots { grid-column: 2; }
  .cal-slot { font-size: 13px; min-height: 30px; }

  /* --- 空き状況マトリクス: 横スクロール維持 + セル簡略 --- */
  .avail .cell { min-height: 48px; padding: 6px 8px; }

  /* --- 予約一覧テーブル: カード化（data-label 方式） --- */
  .tbl-cards table, .tbl-cards thead, .tbl-cards tbody, .tbl-cards tr, .tbl-cards th, .tbl-cards td { display: block; }
  .tbl-cards { border: none; background: none; overflow: visible; }
  .tbl-cards .tbl { border: none; background: none; }
  .tbl-cards thead { position: absolute; left: -9999px; }
  .tbl-cards tbody tr {
    background: var(--canvas); border: 1px solid var(--line);
    margin-bottom: 10px; padding: 4px 0;
  }
  .tbl-cards td {
    border: none; border-bottom: 1px dotted var(--line-soft);
    display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
    padding: 6px 12px; text-align: left !important;
  }
  .tbl-cards td:last-child { border-bottom: none; }
  .tbl-cards td::before {
    content: attr(data-label);
    font-size: 11px; font-weight: 700; color: var(--ink-3); flex: none;
  }
  .tbl-cards td.actions { justify-content: flex-end; flex-wrap: wrap; }
  .tbl-cards td[data-label=""]::before { content: none; }

  .form-row .field { flex: 1 1 140px; }
  .header-actions .btn { min-height: 38px; }
}

@media (max-width: 480px) {
  .nav a { padding: 0 9px; font-size: 12.5px; }
}

/* ---------- print (本日の台帳) ---------- */
@media print {
  .site-header, .cal-nav, .no-print { display: none !important; }
  body { background: #fff; }
  .page { max-width: none; padding: 0; }
}
`;
