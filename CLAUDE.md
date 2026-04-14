読んでいないコードは変更しないで。

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
