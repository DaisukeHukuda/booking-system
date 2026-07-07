# 予約管理システム

「ウラカタ予約」をモデルにした自社専用の予約管理システム。
Cloudflare Workers + Hono + D1 で動作します。

## セットアップ

    npm install
    cp .dev.vars.example .dev.vars   # パスワード等を書き換える
    npm run dev                      # http://localhost:8787

- ヘルスチェック: GET /health
- 管理画面: /admin （.dev.vars の ADMIN_PASSWORD でログイン）

## テスト

    npm test           # 全テスト実行
    npm run typecheck  # 型チェック

## ドキュメント

- 設計書: docs/superpowers/specs/2026-07-07-booking-system-design.md
- 実装計画: docs/superpowers/plans/

## 開発ステップ

1. 基盤＋コアロジック（このリポジトリの現状） — 空き状況計算・アトミック予約登録・管理者認証
2. 管理画面（予約台帳カレンダー・マスタ管理）
3. 代理店連携（専用リンク・メール通知）
4. 運用機能（CSVエクスポート・集計・本番デプロイ）
