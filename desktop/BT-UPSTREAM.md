# BT Desktop provenance

This directory is a derivative of [isWittHere/pi-web-desktop](https://github.com/isWittHere/pi-web-desktop),
MIT licensed, snapshot `1d975bd347d597cf6e382ff4d2a8869605c366e0` (0.8.10-f), retrieved 2026-09-16.
Upstream itself derives from agegr/pi-web v0.7.16. The original LICENSE is retained.

BT reuses the upstream chat renderer, SSE transport, Pi SDK session lifecycle, attachments,
session sidebar, model/auth configuration and Electron shell. BT additions live mainly in
`components/BT*.tsx`, `lib/bt-*.ts`, `app/api/bt/route.ts` and `app/bt.css`.
The shared agent remains the parent repository's `.pi/extensions/bt.ts` and Markdown rules.

The user's GUI upgrade supersedes the original parent V0.1 restriction on frontends. BT disables
the inherited subagent toggle and editor-history auto-discovery; it does not run multiple agents.
Upstream AGENTS.md describes upstream architecture; BT-specific product decisions here and in
the parent AGENTS.md take precedence for this derivative. No upstream code or dependencies are
published by the build/launch scripts. Local source changes are retained for review and maintenance.
