読んでいないコードは変更しないで。

## プライバシー・ID運用ルール（絶対）
- **public 露出する名前は `xkumakichi`（GitHubハンドル）のみ**。本名（"Hiro" など）は公開物・メール署名・記事・DMのいずれでも絶対に使わない
- **Gmail 送信・下書き作成は `kuma.github@gmail.com` のみ**。`proof210413@gmail.com` は別人（Makiko）のアカウントで、このプロジェクトでは一切使わない
- 現状の Gmail MCP 認証は `proof210413@gmail.com` 側。そのためメール作業はこのプロジェクトでは原則 **user がブラウザで手動**。自動 draft 作成は禁止
- DID / 暗号鍵もこのルールに従う（xkumakichi 公開、個人名は出さない）

## Agent Strategy
- リサーチ・検索系のサブエージェントは model: "sonnet" を使う
- コード実装のサブエージェントは model: "sonnet" を使う
- 戦略・分析・文案はメイン会話（Opus）で行う

## Plugins（有効）
- typescript-lsp — TypeScript型チェック
- security-guidance — OWASPセキュリティスキャン
- context7 — リアルタイムドキュメント取得（MCP SDK, xrpl.js等）
- code-review — コードレビュー（npm publish前に実行）
- discord — Discord連携
