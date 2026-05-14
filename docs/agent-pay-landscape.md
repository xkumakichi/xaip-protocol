# Agent Payment Landscape (2026-05-14)

> **前提修正（重要）**: 当初の想定「trust signal を埋め込む前に先手を打つ」は、2026-05 時点で半分崩れている。
> Mastercard Verifiable Intent（2026-03）、Lyrie ATP（2026-05-11）、FIDO Alliance Agentic WG（2026-04-28）、ERC-8004 mainnet（2026-01）と、trust/identity の標準化は既に走っている。
> XAIP の正しいポジションは「pre-empt」ではなく「既存の registry / receipt format に plug-in できる外部 evidence provider」である。

---

## Summary table

| Project | Maintainer | Spec URL | Status | Trust signal stance | Attach point | Text-only contributable |
|---|---|---|---|---|---|---|
| Google AP2 (→FIDO) | Google / FIDO Alliance | https://github.com/google-agentic-commerce/AP2 | Active (→FIDO に移管) | 内部実装（Mandate + VC）| Mandate の additionalProperties / extension VC | GitHub Issues/PR は Yes; FIDO WG は No（有料 membership 必須） |
| A2A v1.0 | Linux Foundation / a2aproject | https://github.com/a2aproject/A2A | Active (v1.0, 150+ orgs) | 内部実装（Signed Agent Card） | Agent Card の capability hint フィールド | Yes（GitHub Discussions/Issues） |
| ACP / UCP (Stripe + OpenAI + Google) | Stripe / OpenAI / Google | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol, https://github.com/universal-commerce-protocol/ucp | Active (ACP 2026-04-17, UCP 2026-04-08) | 未対応（trust は外部依存、Permission Signature のみ） | Extensions Framework (RFC 形式) | Yes（GitHub Issues、acp@stripe.com） |
| x402 v2 | x402 Foundation (Coinbase + Cloudflare) | https://github.com/x402-foundation/x402 (main), https://github.com/coinbase/x402 (dev fork) | Active (119M+ txn) | 未対応（暗号署名はあるが trust scoring なし） | Lifecycle hooks / scheme field / plugin-driven SDK | Yes（CONTRIBUTING.md + GitHub PR） |
| Visa TAP | Visa | https://github.com/visa/trusted-agent-protocol, https://developer.visa.com/capabilities/trusted-agent-protocol | Active | 内部実装（RFC 9421 署名 + Agent Recognition Signature） | Signature-Input タグ / Payment Container 拡張 | 不明（GitHub はサンプル公開だが spec 参加は Visa 関係者限定の可能性） |
| Mastercard Verifiable Intent + Agent Pay | Mastercard / Google (共同) | https://github.com/agent-intent/verifiable-intent/ | Draft v0.1 (Active) | 内部実装（SD-JWT 3層 trust chain） | L2/L3 の制約フィールド / out-of-scope と明示された部分（transport、key management） | Yes（CONTRIBUTING.md、Issues 12件）|
| ERC-8004 | Marco De Rossi 他 | https://eips.ethereum.org/EIPS/eip-8004 | Draft Standards Track (mainnet 2026-01) | 外部 plug-in **歓迎**（supportedTrust は拡張可能文字列配列） | proofOfPayment / supportedTrust / Reputation Registry の appendResponse | Yes（ethereum-magicians.org + GitHub） |
| FIDO Alliance Agentic Auth WG | FIDO Alliance (Chairs: CVS/Google/OpenAI) | https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/ | Active (WG 発足 2026-04-28) | 規格策定中（AP2 + VI の統合受け皿） | 規格がまだ draft 前 — 今が意見投入の窓 | **No**（有料 membership 必須） |
| IETF draft-sharif-agent-payment-trust | Raza Sharif (CyberSecAI) | https://datatracker.ietf.org/doc/html/draft-sharif-agent-payment-trust-00 | Individual Draft (expires 2026-09-26) | 内部定義（5次元 trust scoring） | 実装固有の重み調整 / anomaly threshold | Yes（IETF mailing list + GitHub） |
| IETF draft-singla-agent-identity (AIP) | Paras Singla (独立) | https://datatracker.ietf.org/doc/draft-singla-agent-identity-protocol/00/ | Individual Draft (expires 2026-10-19) | 外部 plug-in（Endorsement objects + custom namespace） | aip_chain 内 capability scope / Endorsement object | Yes（github.com/provai-dev/aip-spec） |
| IETF KYAPay Profile | Skyfire / Michael B. Jones | https://datatracker.ietf.org/doc/draft-skyfire-kyapayprofile/ | Individual Draft | 内部定義（KYA + PAY JWT token 3種） | JWT claim の拡張 | Yes（IETF mailing list） |
| IETF draft-oauth-txn-tokens-for-agents | Ashay Raut (Amazon) | https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/00/ | Individual Draft (superseded) | 外部依存（actor/principal claim のみ） | actor context フィールド | Yes（IETF mailing list） |
| W3C AI Agent Protocol CG | Gaowei Chang, Song XU | https://www.w3.org/groups/cg/agentprotocol/ | Active CG | 未対応（payment なし、identity は検討中） | Charter に trust を明示追加の余地あり | Yes（W3C アカウント無料） |
| W3C A2WF CG (提案中) | Wolfgang Wimmer 他 | https://www.w3.org/community/blog/2026/03/25/proposed-group-agent-to-web-framework-a2wf-community-group/ | Proposed (5名 supporter 待ち) | 未対応（ガバナンスポリシーが主眼） | agent action policy の trust hook | Yes（W3C アカウント無料） |
| Lyrie ATP | OTT Cybersecurity (Lyrie.ai) | https://github.com/OTT-Cybersecurity-LLC/lyrie-ai (予定) | Published spec (IETF 提出予定) | 内部定義（5プリミティブ: Identity/Scope/Attestation/Delegation/Revocation） | 拡張可能（open spec、MIT） | Yes（GitHub） |
| ERC-8004 上の x402 receipt bridge | x402 Ecosystem / ERC-8004 コミュニティ | https://www.x402.org/ecosystem | 非公式実装例（EAS attestation） | 外部 plug-in（x402 receipt を ERC-8004 reputation signal として使う） | proofOfPayment + EAS attestation | Yes（x402 ecosystem + ethereum-magicians） |
| Linux Foundation AAIF (MCP受け皿) | Linux Foundation (Platinum: Anthropic, Google, Microsoft, OpenAI 他) | https://aaif.io/ | Active (2025-12-09 発足) | 未対応（MCP 自体は trust scoring なし） | MCP Extensions / SEP（Spec Extension Proposal）プロセス | Yes（GitHub + AAIF Slack、membership は有料だが OSS 貢献は無料） |

---

## Per-project deep dive

### 1. Google AP2 → FIDO Alliance

**Primary source URLs:**
- Blog: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol (2025-09)
- GitHub: https://github.com/google-agentic-commerce/AP2
- FIDO 移管発表: https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/ (2026-04-28)
- Google blog（AP2 移管）: https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/

**現状 spec の構造:**
- コアオブジェクト: **Intent Mandate** / **Cart Mandate** / **Payment Mandate** の3層
- Verifiable Credentials（VC）を Mandate の署名機構として使用
- Mandate は tamper-proof の cryptographically signed digital contract
- A2A / MCP の extension として実装（独立プロトコルではなく拡張）
- Python SDK、TypeScript、Go、Android サンプル公開。3k stars、444 forks（2026-05時点）
- 60社以上のパートナー（PayPal, Mastercard, Coinbase, Salesforce, ServiceNow 等）

**Trust signal:**
- **内部実装**。Authorization（購入権限の証明）/ Authenticity（真の intent 反映）/ Accountability（責任者特定）の3要素
- Non-repudiation 監査証跡を User→Agent→Cart→Payment の署名チェーンで実現
- Trust evidence の外部 plug-in は spec に定義なし（Mandate の VC を外部 issuer が発行する余地はある）

**Attach point candidate:**
- Mandate の `additionalProperties`（VC の未定義フィールド） — 外部 trust receipt を embedded VC として添付する候補
- A2A x402 extension（Coinbase 等との協業で定義済み）— ここに XAIP signed receipt を hook できる可能性

**Contribution method:**
- GitHub Issues/PR（Apache 2.0、CONTRIBUTING.md あり）— **text-only で完結**
- FIDO Alliance WG への参加は **有料 membership 必須（non-member は不可）**

**確実性レベル: high**（Google Cloud Blog + GitHub で一次資料確認済み。FIDO 移管も公式アナウンス確認済み）

---

### 2. A2A v1.0（Agent2Agent Protocol）

**Primary source URLs:**
- Spec: https://a2a-protocol.org/latest/
- GitHub: https://github.com/a2aproject/A2A
- 150+ org 到達記事: https://stellagent.ai/insights/a2a-protocol-google-agent-to-agent

**現状 spec の構造:**
- v1.0 の最大変更点: **Signed Agent Cards**（Agent Card に cryptographic signature 追加）
- Agent Card：エージェントの能力を記述する JSON-LD 形式のメタデータ
- OpenAPI の authentication scheme と同等の認証対応
- 150+ 組織が採用（Microsoft, AWS, Salesforce, SAP, ServiceNow, Workday, IBM 等）
- Linux Foundation 傘下でガバナンス

**Trust signal:**
- **内部実装**（Signed Agent Card = trust の主要機構）
- Agent Card に記載された capability を署名で検証する形態
- AP2 が A2A の payment extension として位置付けられているため、trust も AP2 層で実装

**Attach point candidate:**
- Agent Card の capability フィールドに、外部 trust score の参照 URL を埋め込む
- Agent Card 自体を XAIP signed receipt の配布チャネルとして活用する可能性

**Contribution method:**
- GitHub Discussions（質問）/ Issues（フィードバック）/ CONTRIBUTING.md — **text-only で完結**
- パートナープログラムは Google Form 経由

**確実性レベル: high**（GitHub + a2a-protocol.org で直接確認済み）

---

### 3. ACP（Agentic Commerce Protocol）— Stripe + OpenAI

**Primary source URLs:**
- GitHub: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- Spec site: https://www.agenticcommerce.dev/
- Stripe blog: https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce (2025-09)

**現状 spec の構造:**
- 日付ベースバージョニング（最新: 2026-04-17）
- カバレッジ: checkout / payment delegation / cart / feed / orders / authentication / MCP 統合
- **Extensions Framework**（2026-01-30 導入）— RFC 形式で composable な optional capability を追加可能
- 初期 extension: Discount Extension
- OpenAPI / JSON Schema で定義

**Trust signal:**
- **未対応**（Permission Signature でユーザーの intent を証明するが、trust score/receipt の外部 plug-in は spec になし）
- 「fraud signals に基づいて良い bot と悪い bot を区別する」と記載されているが、実装は merchant 側に委ねる
- Shared Payment Token（SPT）が payment credential の保護を担う

**Attach point candidate:**
- **Extensions Framework（RFC 形式）** — `rfc.extensions.md` に新 extension を提案できる。Trust attestation extension の提案が最も有望
- Webhook インフラ（Tealium 等が対応済み）— trust event の propagation に使える

**Contribution method:**
- GitHub Issues/PR（Apache 2.0、CLA 必要）
- **acp@stripe.com** にメールで contributor 申請 — **text-only で完結**

**確実性レベル: high**（GitHub で直接確認、Stripe blog で一次情報確認済み）

---

### 4. UCP（Universal Commerce Protocol）— Google + Shopify

**Primary source URLs:**
- GitHub: https://github.com/universal-commerce-protocol/ucp
- Spec site: http://ucp.dev/
- NRF 2026 発表: https://developers.google.com/merchant/ucp

**現状 spec の構造:**
- Google が 2026-01-11（NRF）に発表。Shopify, Walmart, Target, Etsy, Wayfair 等 20+ パートナー
- 4ステージ: product discovery / capability negotiation / checkout / post-purchase handoff
- Capabilities（核心）と Extensions（オプション）を分離する composable 設計
- 最新: v2026-04-08、163 commits、活発
- A2A / AP2 / MCP と互換を明示

**Trust signal:**
- **未対応**（「AP2 mandates と verifiable credentials のような advanced security patterns」と言及あり、ただし UCP 自体には trust signal 機構なし）
- Trust は AP2 層に委譲する設計

**Attach point candidate:**
- **Extensions 機構** — UCP の capability negotiation フェーズに trust attestation を capability として追加する提案が可能
- AP2 との統合経路（UCP → AP2 → Mandate）でXAIP receipt を AP2 Mandate に埋め込む

**Contribution method:**
- GitHub Discussions / Issues / CONTRIBUTING.md — **text-only で完結**

**確実性レベル: high**（GitHub で直接確認済み）

---

### 5. x402 v2 — x402 Foundation（Coinbase + Cloudflare）

**Primary source URLs:**
- Main repo: https://github.com/x402-foundation/x402
- Dev fork: https://github.com/coinbase/x402
- Whitepaper: https://www.x402.org/x402-whitepaper.pdf
- v2 launch: https://www.x402.org/writing/x402-v2-launch

**現状 spec の構造:**
- HTTP 402 status code を resurrect した internet-native payment protocol
- **scheme field** で payment 手段を抽象化（`exact`, `upto` 等、各 network ごとに実装が異なる）
- v2 の主要変更: plugin-driven SDK（新 chain / scheme を core 編集なしで追加可能）
- Lifecycle hooks: payment flow の key points に custom logic を注入可能
- `PAYMENT-SIGNATURE` ヘッダー + `Sign-In-With-X (SIWx)` による検証
- 119M+ txn on Base, 35M+ on Solana（2026-03 時点）
- x402 Foundation（Cloudflare + Coinbase 設立）に members: Google, Visa, AWS, Circle, Anthropic, Vercel

**Trust signal:**
- **未対応**（暗号署名はあるが trust scoring / receipt 機構は spec にない）
- ただし **非公式 bridge** 存在: x402 signed offers + receipts を on-chain EAS attestation として ERC-8004 Reputation Registry に送るパターンが ecosystem で実装されている

**Attach point candidate:**
- **Lifecycle hooks** — payment 完了後に XAIP signed receipt 生成と registry への書き込みを hook で実行
- **scheme field** の拡張 — trust-verified payment scheme として XAIP を scheme provider として登録
- ERC-8004 の `proofOfPayment` フィールド — x402 txHash + XAIP receipt を同時に付与

**Contribution method:**
- GitHub CONTRIBUTING.md に受け入れ基準（新 chain / scheme の追加条件）— **text-only で完結**
- x402 Foundation への参加は member 制だが、GitHub OSS 貢献は open

**確実性レベル: high**（GitHub + x402.org で直接確認済み）

---

### 6. Visa TAP（Trusted Agent Protocol）

**Primary source URLs:**
- 発表: https://investor.visa.com/news/news-details/2025/Visa-Introduces-Trusted-Agent-Protocol-An-Ecosystem-Led-Framework-for-AI-Commerce/default.aspx (2025-10-14)
- Developer spec: https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications
- GitHub sample: https://github.com/visa/trusted-agent-protocol

**現状 spec の構造:**
- 3層モデル: **Agent Recognition Signature**（HTTP header）/ **Consumer Recognition Object**（body）/ **Payment Container**
- RFC 9421 準拠の cryptographic HTTP message signature
- 必須フィールド: `Signature-Input`（`@authority`, `@path`, `created`, `expires`±8分, `nonce`, `tag`）
- JWKS endpoint: `https://mcp.visa.com/.well-known/jwks`
- Mastercard Agent Pay と Web Bot Auth standard を共有
- 2025 年中に hundreds of transactions を完了

**Trust signal:**
- **内部実装**（Agent Recognition Signature が trust の主要機構）
- Consumer Identity: OpenID Connect 準拠 JWT（ハッシュ化された email/phone）
- trust score の外部 plug-in は spec に定義なし

**Attach point candidate:**
- `Signature-Input` の `tag` フィールド拡張（現在は `agent-browser-auth` / `agent-payer-auth` の2値）
- Payment Container の payment scheme 固有追加フィールド

**Contribution method:**
- GitHub にサンプル実装は公開（6 commits、167 stars）だが spec 自体の governance 参加条件は **不明**
- Visa Developer Portal からの登録が必要と推定

**確実性レベル: medium**（Developer spec は直接確認済み。governance 参加条件は未確認）

---

### 7. Mastercard Verifiable Intent + Agent Pay

**Primary source URLs:**
- 発表: https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html (2026-03-05)
- GitHub: https://github.com/agent-intent/verifiable-intent/
- PYMNTS: https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/

**現状 spec の構造:**
- **Verifiable Intent**: Google と共同開発、SD-JWT（Selective Disclosure JWT）3層構造
  - Layer 1: 認証情報提供者 → ユーザー（identity claims、PAN last4、scheme、有効期限~1年）
  - Layer 2: ユーザー → エージェント（Instant mode / Autonomous mode、ユーザーデバイスキー署名、15分〜30日）
  - Layer 3: エージェント → 決済ネットワーク/マーチャント（L3a: payment value / L3b: checkout hash、約5分）
- 各層が次層の公開鍵をバインド（RFC 7800 `cnf.jwk`）
- Selective Disclosure（最小情報開示）を privacy 設計として組み込み
- FIDO Alliance / EMVCo / IETF / W3C 標準との整合

**Trust signal:**
- **内部実装**（SD-JWT の trust chain 自体が trust signal）
- 外部 trust score の plug-in は spec に定義なし
- ただし out-of-scope として明示された「transport protocol / key management / credential provider registration」の部分が外部 trust service の差し込み余地

**Attach point candidate:**
- **Layer 2 の制約フィールド**（Autonomous mode の `constraints` セクション）に XAIP trust score を条件として追加する提案が可能
- SD-JWT の undisclosed claims 機能を使って XAIP receipt をオプション添付
- GitHub Issues でこの extension を提案（Issues 12件、PR 9件で活発）

**Contribution method:**
- GitHub CONTRIBUTING.md（Apache 2.0）— **text-only で完結**
- verifiableintent.dev で仕様公開
- 8社が endorser として参加（IBM, Adyen, Fiserv, Worldpay 等）

**確実性レベル: high**（GitHub で直接確認済み。SD-JWT 構造を spec から抽出）

---

### 8. ERC-8004（Trustless Agents）

**Primary source URLs:**
- EIP: https://eips.ethereum.org/EIPS/eip-8004
- Discussion: https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098
- Contracts: https://github.com/erc-8004/erc-8004-contracts

**現状 spec の構造:**
- **3つの on-chain registry** を定義:
  - **Identity Registry**: ERC-721 + URIStorage による portable agent ID（`{namespace}:{chainId}:{identityRegistry}` 形式）
  - **Reputation Registry**: feedback score の on-chain 集積 API（`int128 value`, `uint8 valueDecimals`, `tag1`, `tag2`, `endpoint`, `feedbackURI`, `feedbackHash`）
  - **Validation Registry**: validator smart contract による検証スコア（0-100）+ evidence URI
- off-chain feedback file の `supportedTrust` array: `["reputation", "crypto-economic", "tee-attestation"]` — **enum ではなく拡張可能な文字列配列**（最重要！）
  - EIP 本文の verbatim 定義: *"supportedTrust field is OPTIONAL. If absent or empty, this ERC is used only for discovery, not for trust."* — 値のリストは例示であり、規定 enum ではない。開発者が追加値を定義できる設計であることを EIP 本文から直接確認
- `appendResponse()` 関数: anyone が検証情報を追加可能
- mainnet 稼働 2026-01-29（L2 registration は $1 未満）

**Trust signal:**
- **外部 plug-in を明示的に想定**（XAIP にとって最有力の attach 先）
- off-chain feedback file 内の `proofOfPayment` フィールド: `{"fromAddress", "toAddress", "chainId", "txHash"}` — x402 receipt との統合を明示
- Trust model が pluggable かつ tiered: reputation / crypto-economic / zkML / TEE のいずれでも可

**Attach point candidate（最重要）:**
- `supportedTrust` に `"xaip-signed-receipt"` を新たな trust model として登録（拡張可能文字列配列のため enum 追加不要）
- Reputation Registry の `feedbackURI` / `feedbackHash` に XAIP signed receipt を参照させる
- `proofOfPayment` + XAIP receipt を同時に含む off-chain feedback file を発行
- ERC-8004 の EAS attestation bridge 経由で x402 receipt と XAIP trust score を on-chain に記録

**Contribution method:**
- ethereum-magicians.org フォーラム（text-only で議論可能）
- GitHub Issues/PR — **text-only で完結**
- Authors: Marco De Rossi、Davide Crapis、Jordan Ellis、Erik Reppel（全員 GitHub + ethereum-magicians で contact 可能）

**確実性レベル: high**（EIP 本文を直接読んで `supportedTrust` の型定義、`proofOfPayment` の JSON 構造を確認）

---

### 9. FIDO Alliance Agentic Authentication WG + Payments WG

**Primary source URLs:**
- 発表: https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/ (2026-04-28)
- Google blog（AP2 移管）: https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/

**現状 spec の構造:**
- 2つの WG が並行稼働:
  - **Agentic Authentication Technical WG**: ユーザーの agent への権限委譲。Chairs: CVS Health, Google, OpenAI。Vice-chairs: Amazon, Google, Okta
  - **Payments Technical WG**: agent-initiated commerce の仕様。Chairs: Mastercard, Visa
- 技術貢献の初期 input: Google AP2（→FIDO に移管）+ Mastercard Verifiable Intent
- OpenAI が FIDO Alliance に join（agent authentication push のため）
- 2026-04-28 発足。まだ draft が出ていない段階（今が意見投入の窓）

**Trust signal:**
- **規格策定中**。AP2（Mandate + VC）と Verifiable Intent（SD-JWT）を統合・洗練する予定
- 結果として出てくる spec が 2026-2027 年の業界標準になる可能性が高い

**Attach point candidate:**
- 規格が draft 前のため、今 XAIP を external trust evidence provider として positioning すれば spec に組み込まれる可能性がある
- AP2 の Mandate VC の issuer として XAIP を推奨する proposal を FIDO WG に送れるか（→ membership 問題あり）

**Contribution method:**
- **FIDO Alliance 有料 membership 必須**（Liaison や observer の非 member 参加制度の詳細は公式サイトに明記なし）
- **text-only では参加不可**（会員制 WG）
- 迂回路: AP2 の GitHub（まだ open）に Issues を出しておき、FIDO WG に引き継がせる

**確実性レベル: high**（FIDO 公式発表で確認。membership 必須は FIDO Alliance 全 WG の基本構造）

---

### 10. IETF 関連 drafts（agent-trust / agent-identity / agent-payment 群）

**Primary source URLs（全てデータトラッカー直リンク）:**

| Draft | URL | Expires |
|---|---|---|
| draft-sharif-agent-payment-trust-00 | https://datatracker.ietf.org/doc/html/draft-sharif-agent-payment-trust-00 | 2026-09-26 |
| draft-singla-agent-identity-protocol-00 (AIP) | https://datatracker.ietf.org/doc/draft-singla-agent-identity-protocol/00/ | 2026-10-19 |
| draft-skyfire-kyapayprofile (KYAPay) | https://datatracker.ietf.org/doc/draft-skyfire-kyapayprofile/ | 不明 |
| draft-kiliram-agent-trust-auth-framework | https://datatracker.ietf.org/doc/draft-kiliram-agent-trust-auth-framework/ | 不明 |
| draft-oauth-transaction-tokens-for-agents | https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/00/ | superseded |
| draft-yl-agent-id-requirements | https://datatracker.ietf.org/doc/draft-yl-agent-id-requirements/ | 2026-01（失効） |
| draft-zheng-dispatch-agent-identity-management | https://datatracker.ietf.org/doc/draft-zheng-dispatch-agent-identity-management/ | **2026-05-07（失効済み：本日 2026-05-14 時点）** |

**各 draft の特徴:**

- **draft-sharif-agent-payment-trust-00**: 5次元（Code Attestation / Execution Success Rate / Behavioural Consistency / Operational Tenure / Anomaly History、各 20%）trust scoring。ECDSA P-256 鍵ペアで per-agent identity。Trust level L0〜L4 と spend limit を対応付け。WG なし（individual submission）。Author: Raza Sharif、contact@agentsign.dev
- **AIP（draft-singla）**: W3C DID + capability-based authorization + delegation chain。`aip_chain` で sequential delegation。Endorsement objects（positive interaction を signed statement で attestation）。Custom namespace は W3C に登録可能。Author: Paras Singla、paras.singla@inviscel.com。spec repo: github.com/provai-dev/aip-spec
- **KYAPay**: KYA（Know Your Agent）+ PAY token の JWT profile。human identity（hid）+ agent platform（apd）+ agent identity（aid）の3層 claim。Skyfire（Ankit Agarwal）+ Michael B. Jones（JOSE 標準の著者）が authors
- **draft-kiliram**: Cross-domain agent-to-agent の trust framework。OAuth 2.0 Token Exchange（RFC 8693）を採用。credential format は X.509/JWT/CWT/W3C VC から選択可能。Authors: Daniel King（Lancaster Univ）/ Rajiv Ramdhany（BBC）/ Peter Chunchi Liu（Huawei）
- **Lyrie ATP**（IETF 提出予定）: 5プリミティブ（Identity / Scope / Attestation / Delegation / Revocation）。open, royalty-free。ref impl: MIT。IETF 提出前の今が最もフラットな窓

**全 draft に共通する Attach point:**
- trust query API の response body に XAIP receipt への参照を追加するフィールド提案
- IETF mailing list への text comment（IETF アカウント不要、mailing list への投稿のみ）

**Contribution method:**
- IETF mailing list + GitHub（draft authors に直接 PR or email）— **全て text-only で完結**
- Individual draft のため WG adoption なし → author が receptive なら反映されやすい

**確実性レベル: high**（datatracker.ietf.org の一次資料を直接確認）

---

### 11. W3C Community Groups

**Primary source URLs:**
- AI Agent Protocol CG: https://www.w3.org/groups/cg/agentprotocol/
- A2WF CG（提案中）: https://www.w3.org/community/blog/2026/03/25/proposed-group-agent-to-web-framework-a2wf-community-group/
- Agentic Integrity Verification Spec CG（提案中）: https://www.w3.org/community/blog/2026/03/30/proposed-group-agentic-integrity-verification-specification-community-group/

**各 CG の状況:**

- **AI Agent Protocol CG**: Chairs: Gaowei Chang, Song XU。agent discovery / identity / security / privacy / interoperability が領域。Verifiable credential-based trust を明示。決済は scope 外。参加: W3C アカウント（無料）のみ — **text-only で完結**
- **A2WF CG（提案中）**: Wolfgang Wimmer が proposer。agent が web を操作するためのガバナンスポリシー spec が目的。trust signal なし（trust より governance focus）。5名 supporter が揃えば発足（2026-03-25 時点）
- **Agentic Integrity Verification Spec CG（提案中）**: Ben Stone が proposer。AI エージェントのセッション記録に対する暗号証明（EU AI Act / ISO 42001 / NIST AI RMF 対応）。XAIP の signed receipt コンセプトと最も近い W3C CG — supporter になることで発足を後押しできる

**Contribution method:**
- W3C アカウント作成（無料）→ CG support ボタン — **text-only で完結**
- 参加後は mailing list / GitHub での spec 作業に参加可能

**確実性レベル: high**（W3C 公式ページを直接確認）

---

### 12. ERC-8004 と x402 の ecosystem bridge（非公式 trust layer）

**Primary source URLs:**
- x402 ecosystem: https://www.x402.org/ecosystem
- ERC-8004 feedback file: https://eips.ethereum.org/EIPS/eip-8004（off-chain feedback file の `proofOfPayment` セクション）

**現状:**
- x402 signed receipts を EAS（Ethereum Attestation Service）attestation として発行し、ERC-8004 Reputation Registry に reputation signal として登録するパターンが ecosystem で実装されている（非公式、XAIP のアーキテクチャと構造的に同一）
- これは XAIP が「独立提案ではなく、既存 bridge の formally specified 版として contribute する」という positioning の根拠になる

**Trust signal:**
- 外部 plug-in。x402 proof-of-payment + EAS attestation の組み合わせで economically-backed trust を実現

**Attach point candidate:**
- XAIP を「ERC-8004 の正式な trust model として登録し、`supportedTrust: ["xaip"]` を使えるようにする仕様提案」として ethereum-magicians に投稿する

**確実性レベル: medium**（x402.org ecosystem ページで言及あり。EAS attestation の具体的な contract アドレスは未確認）

---

### 13. Linux Foundation AAIF（Agentic AI Foundation）

**Primary source URLs:**
- 発表: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation (2025-12-09)
- AAIF: https://aaif.io/
- MCP 参加: https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/
- Anthropic 発表: https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation

**現状 spec の構造:**
- 2025-12-09 発足。founding projects: MCP（Anthropic 寄贈）/ goose（Block）/ AGENTS.md（OpenAI）
- Platinum members: Amazon Web Services、Anthropic、Block、Bloomberg、Cloudflare、Google、Microsoft、OpenAI
- MCP は 10,000+ active public MCP servers、ChatGPT/Cursor/Gemini/Microsoft Copilot に採用済み
- MCP は SEP（Spec Extension Proposal）プロセスで拡張を管理（SEP-1932: DPoP、SEP-1933: Workload Identity Federation が active review）

**Trust signal:**
- **未対応**（現在の3プロジェクトに trust signal / payment layer はない）
- MCP の 2026 Roadmap には "deeper security and authorization work" が "On the Horizon" として記載
- Workload Identity（non-human clients の identity）は open challenge として認識されている

**Attach point candidate:**
- **MCP Extensions**: 「Extensions let us experiment with new capabilities outside the core spec」— trust attestation extension を SEP 形式で提案
- SEP プロセス（github.com/modelcontextprotocol）に `SEP-xxxx: Signed Receipt for MCP Tool Invocation` として提案する経路が理論上存在する

**Contribution method:**
- MCP GitHub（github.com/modelcontextprotocol）への Issues/PR — **text-only で完結**
- AAIF membership は有料だが、OSS プロジェクト（MCP）への貢献は membership なしで可能
- MCP Dev Summit（2026-04-02/03 NYC で開催済み）— 次回イベントは text-only では完結しない

**確実性レベル: high**（Linux Foundation + Anthropic + MCP blog の一次資料を直接確認。MCP Roadmap は WebFetch で確認済み）

---

## XAIP の発信レイヤー（chain-neutral）

XAIP の設計原則は **チェーン非依存**。発信は単一チェーンのコミュニティではなく、**中立な標準化レイヤーと自前 channel** に限定する。チェーン側のプロジェクト（ERC-8004, XRPL trust registries, その他）が興味を持った場合、向こうが中立 spec を参照する形を想定する。こちらから特定チェーンのコミュニティに出向くことはしない。

### 中立レイヤーでの発信先

| レイヤー | 場所 | 期待される到達 |
|---|---|---|
| **IETF individual draft** | datatracker.ietf.org | プロトコル設計者全体（チェーン非依存）。citable URL を確保 |
| **W3C Community Group** | w3.org の Agentic Integrity Verification Spec CG (提案中) | Web 標準コミュニティ。AI agent integrity 領域に最も近い枠 |
| **自前 channel** | dev.to / Zenn / 自分の repo | チェーン色なしの記事として書く。検索で辿り着いた人が読む |
| **個別 IETF draft author** との text 対話 | draft-sharif / Lyrie ATP author など | individual draft 同士の相互参照。author の裁量で進む |

### 独立 spec として publish するなら IETF か W3C か

**推奨: IETF individual draft（短期）+ W3C Community Group note（中期）の二段階**

| | IETF | W3C |
|---|---|---|
| 速度 | draft-00 は 48 時間以内に datatracker に出せる | CG note は数ヶ月かかる |
| 信頼性 | RFC 番号が取れれば最高。individual draft だけでも引用される | W3C Recommendation は最も重いが、CG note でも引用実績あり |
| 現状の競合 | draft-sharif、draft-singla、draft-kiliram が同領域で submit 済み — 差別化が必要 | Agentic Integrity Verification CG が提案中（ここに co-contribute が最速） |
| XAIP の強み | signed receipt + Bayesian trust scoring の具体実装がある（他の draft は実装なし） | なし（現状） |
| 推奨アクション | `draft-xkumakichi-xaip-trust-evidence-00` として、signed receipt format + trust score derivation を individual draft で提出 | W3C Agentic Integrity Verification CG の co-contributor として spec を共同執筆 |

**差別化ポイント**: 他の IETF individual draft は概念定義が中心。XAIP は `npm publish` 済みの実装がある。「working code + formal spec」という組み合わせは引用される上で強力な根拠になる。

---

## Open questions / 未解決

1. **FIDO Alliance Agentic WG への非 member アクセス**: Public consultation や liaison observer のような制度があるかは未確認。FIDO Alliance に直接メールで問い合わせると実態がわかる可能性がある（ただし個人名を出さず xkumakichi + XAIP project 名で行うこと）。

2. **Visa TAP の spec governance**: GitHub にサンプルはあるが（6 commits, 167 stars）、spec 自体の改訂プロセスや external contributor 受け入れ条件が developer.visa.com には記載なし。Visa Developer Forum から確認が必要。

3. **AIP（draft-singla）の `supportedTrust` との関係**: AIP は W3C DID + capability + endorsement objects という構造で、XAIP の trust receipt を endorsement object として添付する経路がある可能性がある。spec repo（github.com/provai-dev/aip-spec）を直接読んで endorsement object のスキーマを確認する必要がある。

4. **AAIF（Agentic AI Foundation）の payment/trust 関連作業項目**: 現在の3プロジェクト（MCP / goose / AGENTS.md）には trust signal がない。AAIF に新規プロジェクトを提案するプロセスがあるかは未確認（GitHub の公式プロセス経由とのこと）。

5. **draft-sharif の trust score と XAIP の Bayesian score の互換性**: sharif draft は 5次元均等重み付け（各 20%）、XAIP は caller diversity weighting を持つ Bayesian model。両者の相互参照可能性（XAIP score を sharif の trust score input として使う）は、technical レビューが必要。

6. **ERC-8004 の `supportedTrust` 拡張登録プロセス**: spec には「開発者が追加可能」と書かれているが、registry（on-chain or off-chain）で値を管理する公式プロセスがあるかは未確認。chain-neutral 方針のため、こちらから ERC-8004 コミュニティに照会することはしない。中立 spec として IETF/W3C にエントリが published されれば、関心がある実装者が向こうから参照する経路を期待する。

7. **Lyrie ATP との競合・協調**: XAIP の signed receipt と Lyrie ATP の 5プリミティブは役割が重複する部分がある（Attestation、特に）。Lyrie.ai が IETF に提出した際に competing draft vs. complementary spec のどちらのスタンスを取るかは戦略上の決断が必要。

---

## 付記：リサーチ確実性の説明

- **high**: 公式 GitHub / 公式 blog / IETF datatracker の一次資料を WebFetch で直接確認したもの
- **medium**: WebSearch の二次資料が複数一致しているが、primary spec の全文を直接読んでいないもの
- **low / 不明**: 資料が見つからなかった、または access 不可（403 等）だったもの

Anthropic の独自 ACP については、「ACP = OpenAI + Stripe のものであり、Anthropic は独自の agent-payment protocol を出していない」ことを複数の一次資料で確認した。Anthropic が agent payment に関連しているのは: (1) x402 Foundation の member、(2) Visa Trusted Agent Protocol の partner、(3) AAIF の Platinum member（MCP 寄贈）、(4) Lyrie.ai を Anthropic Cyber Verification Program に採択 — の4経路であり、独立した payment spec は存在しない（2026-05-14 時点）。
