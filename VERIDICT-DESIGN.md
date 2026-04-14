# Veridict — AI Agent Trust Decision Layer

## 一言で

> 「AIエージェントが、別のエージェントを信頼していいかを即判断できるインフラ」

---

## 経緯

XAIPプロジェクト（XRPL Agent Identity Protocol）の設計・実装・公開を経て、
第一原理分析 + 複数AIによるクロス評価を実施。結論として：

- XAIPは「正しい問い」を持っていたが「早すぎた」
- 「IDを作る」ではなく「信頼を判断する」が本当のニーズ
- Identity(XAIP) × Behavior(実行検証) = Trust という構造が最適解

XAIPの技術スタックを活かしつつ、プロダクトの切り口を再設計した結果が Veridict。

---

## コアAPI

```
can_I_trust("agent_X") → {
  verdict: "yes",
  confidence: 0.97,
  success_rate: 99.2%,
  verified_runs: 82%,
  risk_flags: ["timeout_history"],
  identity: {              ← XAIP層
    did: "did:xrpl:...",
    credentials: [...]
  },
  behavior: {              ← Veridict層
    total_executions: 1247,
    replay_verified: 82%,
    last_failure: "2026-03-15"
  }
}
```

---

## アーキテクチャ

```
┌─────────────────────────────────┐
│       Trust Layer (Veridict)     │
│  "このエージェントを信頼できるか"      │
├────────────────┬────────────────┤
│   Identity     │   Behavior     │
│   (XAIP)      │   (Veridict)   │
│   誰であるか     │   何をしたか      │
│   DID         │   実行ログ       │
│   Credentials  │   検証結果       │
│   Memory      │   成功率        │
└────────────────┴────────────────┘
         ↕
┌─────────────────────────────────┐
│       Agent Layer               │
│   MCP / A2A / Tool Selection    │
└─────────────────────────────────┘
```

---

## Phase構造

### Phase 1: COLLECT（今すぐ — MCP開発者向け）

- MCPサーバーに3行追加するミドルウェア
- 実行ログ: input hash, output hash, latency, success/fail
- リプレイ検証: 同じ入力で再実行し結果照合
- メトリクス: 成功率、エラー率、レイテンシ
- ストレージ: SQLite（ローカル）
- 配布: npm、完全無料OSS

**差別化ポイント（ログツールで終わらないために）:**
- リプレイ検証機能（同じ入力→同じ出力か？）
- can_I_trust() APIの最小版（成功率ベースのYES/NO判定）

### Phase 2: JUDGE（次 — エージェント開発者・企業向け）

- Trust Score算出（検証済み率、リスクフラグ、障害パターン）
- Trust判定API（本格版）
- アクション署名（DID紐付け — XAIPのIdentity層を統合）
- 監査ダッシュボード
- 収益: SaaS月額

### Phase 3: GOVERN（未来 — エンタープライズ・規制対応）

- 要点のみXRPLにアンカー（全部オンチェーンではない）
- コンプライアンス対応の監査レポート生成
- AI間契約 + エスクロー（XAIP技術転用）
- 収益: エンタープライズ契約

---

## XRPLの扱い

> 「裏で仕込むが、表に出さない」

- Phase 1-2: 普通のDB（SQLite / Postgres）
- Phase 3: 必要なログだけハッシュをXRPLへアンカー
- XRPLは「最後の武器」— 改ざん不可能性が法的要件になったとき投入

---

## XAIPとの関係

- XAIPは独立プロジェクトとして公開維持（npm, GitHub, MCPレジストリ）
- Veridict Phase 2でXAIPのIdentity/Credentials技術を統合
- 二つで一つ: 「存在の信頼(XAIP)」×「行動の信頼(Veridict)」

---

## 最初のユースケース

### ターゲット: MCPサーバー開発者

**痛み:** 外部APIを叩くエージェントで、どのツールが安定しているか分からない

**シナリオ:**
```
開発者: MCPサーバーを公開したい
Veridict: ミドルウェアを3行追加
→ 実行ログが自動収集される
→ 成功率・レイテンシが可視化される
→ 「このサーバーは信頼できる」というバッジが付く
```

**検証方法:**
MCPサーバー作ってる個人開発者に聞く:
「どのエージェント信用していいか分からなくて困ってる？」
YES → 作る / NO → ズレてる

---

## 競合と差別化

| 競合 | 領域 | Veridictの差別化 |
|---|---|---|
| LangSmith | Observability | Veridictは「観測」ではなく「判断」を提供 |
| Helicone | LLMモニタリング | Veridictはツール実行に特化 |
| OpenAI/Google/Anthropic | プラットフォーム内信頼 | Veridictはプラットフォーム横断の中立レイヤー |

唯一の勝ち筋: **中立性** — 特定プロバイダに依存しない信頼判定

---

## 収益モデル

- Phase 1: 無料OSS（採用最大化）
- Phase 2: ホスティングSaaS（$5-20/月/サーバー）
- Phase 3: エンタープライズ監査レポート

---

## Day 1-7 計画

- Day 1-2: コンセプト再定義 + リポジトリ作成
- Day 3-4: MVP（MCPミドルウェア + SQLiteログ + メトリクスCLI）
- Day 5: リプレイ検証 or can_I_trust()最小版（差別化要素）
- Day 6: デモ動画
- Day 7: npm公開 + GitHub + MCPレジストリ登録

---

## 設計原則（XAIPの教訓）

1. 問題から始める（技術から始めない）
2. 最初の1ユーザーを見つけてから作る
3. フルスタックを一気に作らない
4. 「誰が使うか」が不明確なものは作らない
5. ブロックチェーンは手段であって価値ではない
6. 未来を作りながら、現在に刺さる入口を持つ

---

## 分析に参加したAI

- Claude (Anthropic) — 第一原理分解、XAIP現状評価、技術設計
- GPT (OpenAI) — プロダクト評価、戦略補正、ユースケース設計

3つの異なる視点が同じ結論に収束したことが、この方向性の信頼性を示している。

---

*Created: 2026-03-30*
*Authors: Hiro (xkumakichi) + Claude + GPT*
