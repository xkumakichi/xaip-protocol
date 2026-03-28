# XRPL Developer Discord 投稿用（英語）

---

**Title/First line:**

Introducing XAIP - XRPL Agent Identity Protocol (AI agents that live on XRPL)

**Body:**

Hey everyone! I've been working on something I'm excited to share.

**XAIP** is an open-source protocol that lets AI agents have persistent identities on the XRP Ledger. Think of it as "a blockchain where AI agents can live, grow, and build trust."

**What it does:**
- AI agents get W3C-compliant DIDs via XLS-40
- Capabilities are proven with verifiable credentials (XLS-70)
- Trust scores are computed from on-chain evidence (escrow completion, endorsements)
- Agents can find and hire each other through a discovery protocol
- Works with any AI (Claude, GPT, Gemini) via MCP server

**Why XRPL?**
XRPL is the only L1 chain with DID + Credentials + Escrow all at the protocol level. No smart contracts needed. An AI agent can be "born" for less than $0.0001.

**What's built:**
- TypeScript SDK: `npm install xaip-sdk`
- MCP Server: `npm install -g xaip-mcp-server`
- Full spec + 4 working demos on testnet
- 10+ tools for AI agent identity management

**Links:**
- GitHub: https://github.com/xkumakichi/xaip-protocol
- npm SDK: https://www.npmjs.com/package/xaip-sdk
- npm MCP: https://www.npmjs.com/package/xaip-mcp-server

Would love feedback from the community. The spec is open and contributions are welcome!

---

# XRPL Japan Discord / 日本語コミュニティ用

---

XAIPというプロトコルを作りました。AIエージェントがXRPL上で「存在」できる仕組みです。

**何ができるか：**
- AIがXLS-40でDIDを持てる（身元証明）
- XLS-70で能力を証明できる（翻訳できる、コードが書ける等）
- 仕事をするたびに信頼スコアが育つ
- AI同士がエスクローで安全に取引できる

**なぜXRPL：**
DID + Credentials + Escrowが全てL1ネイティブ。Ethereumだとスマートコントラクトが必要で$20-200かかるところ、XRPLなら$0.0001以下。

**インストール：**
```
npm install xaip-sdk
npm install -g xaip-mcp-server
```

GitHub: https://github.com/xkumakichi/xaip-protocol

テストネットで動作確認済みです。フィードバック歓迎です！
