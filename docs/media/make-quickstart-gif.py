# Renders docs/quickstart.gif — a terminal-style replay of the Quick Start.
#
# Every command and output line below is a real capture from the clean-profile
# measurement documented in the README Quick Start (2026-07); this script only
# re-renders those captures as an animated GIF. Regenerate after re-measuring:
#
#   python docs/media/make-quickstart-gif.py
#
# Requires: Pillow, Consolas (or edit FONT_PATH).

from PIL import Image, ImageDraw, ImageFont

W, H = 800, 460
BG = (13, 17, 23)        # GitHub dark
FG = (201, 209, 217)     # default text
DIM = (110, 118, 129)    # comments
GREEN = (63, 185, 80)
YELLOW = (210, 153, 34)
CYAN = (121, 192, 255)
FONT_PATH = "C:/Windows/Fonts/consola.ttf"
FONT_SIZE = 15
LINE_H = 22
PAD = 16
TOP = 40

font = ImageFont.truetype(FONT_PATH, FONT_SIZE)

# (kind, text) — kind: cmd | out | ok | warn | dim | json
SCENES = [
    [("cmd", "npm install -g xaip-claude-hook"),
     ("out", "added 1 package in 637ms")],
    [("cmd", "xaip-claude-hook install"),
     ("ok",  "√ XAIP Claude Code hook installed."),
     ("out", "Next MCP tool call will emit a signed receipt to"),
     ("out", "  https://xaip-aggregator.kuma-github.workers.dev")],
    [("dim", "# ...in a Claude Code session, any MCP tool call fires the hook...")],
    [("cmd", "cat ~/.xaip/hook.log"),
     ("out", "POST context7/resolve-library-id ok=true lat=2402ms"),
     ("ok",  '  → 200 {"ok":true,"callerVerified":true}')],
    [("cmd", "curl https://xaip-trust-api.kuma-github.workers.dev/v1/trust/context7"),
     ("json", '{ "slug": "context7", "trust": 0.926, "receipts": 1044,'),
     ("json", '  "source": "xaip-aggregator-1 (single aggregator)" }')],
    [("cmd", "curl -X POST .../v1/select -d '{\"task\":\"summarize a webpage\","),
     ("cmd2", "  \"candidates\":[\"context7\",\"my-brand-new-server\"]}'"),
     ("json", '{ "selected": "context7",'),
     ("warn", '  "rejected": [{ "slug": "my-brand-new-server",'),
     ("warn", '    "reason": "unscored — no execution evidence available" }] }')],
    [("dim", ""),
     ("ok", "Evidence before delegation.")],
]

COLORS = {"cmd": FG, "cmd2": FG, "out": DIM, "ok": GREEN,
          "warn": YELLOW, "dim": DIM, "json": CYAN}

frames, durations = [], []
lines = []  # committed (kind, text) lines


def render(partial=None):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 26], fill=(22, 27, 34))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([12 + i * 20, 8, 22 + i * 20, 18], fill=c)
    d.text((86, 6), "quick start — first signed receipt", font=font, fill=DIM)
    shown = lines + ([partial] if partial else [])
    visible = shown[-((H - TOP - PAD) // LINE_H):]
    y = TOP
    for kind, text in visible:
        prefix = "$ " if kind == "cmd" else "  "
        if kind == "cmd":
            d.text((PAD, y), "$", font=font, fill=GREEN)
            d.text((PAD + font.getlength("$ "), y), text, font=font, fill=COLORS[kind])
        else:
            d.text((PAD, y), prefix + text, font=font, fill=COLORS[kind])
        y += LINE_H
    return img


def push(img, ms):
    frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=64))
    durations.append(ms)


for scene in SCENES:
    for kind, text in scene:
        if kind in ("cmd", "cmd2"):
            for i in range(0, len(text) + 1, 3):  # type 3 chars per frame
                push(render((kind, text[:i] + "█")), 30)
            push(render((kind, text)), 150)
            lines.append((kind, text))
        else:
            lines.append((kind, text))
            push(render(), 120)
    push(render(), 1500)  # scene pause
    lines.append(("dim", ""))
push(render(), 3000)  # hold the end card

frames[0].save(
    "docs/quickstart.gif",
    save_all=True, append_images=frames[1:],
    duration=durations, loop=0, optimize=True,
)
print(f"frames: {len(frames)}")
import os
print(f"size: {os.path.getsize('docs/quickstart.gif') / 1024:.0f} KB")
