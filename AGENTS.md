# BT-Agent development instructions

- BT is the personal agent; Codex is the developer. These are repository development instructions, not BT's persona. BT's runtime instructions live in `.pi/SYSTEM.md` and `.pi/modes/`.
- Extend the published Pi package; do not fork or patch its core. Verify APIs against the pinned package's docs and TypeScript declarations before use.
- V0.1 core: five modes, Markdown memory, official Pi sessions and Windows launchers. The user has now authorized a desktop GUI upgrade based on an existing Pi GUI. Keep vector databases, MCP, multi-agent orchestration and background memory automation out of BT's enabled feature set.
- Keep dependency versions exact and preserve `package-lock.json`. Install with `--ignore-scripts`.
- Never read or print credentials for debugging. Never commit API keys, `.bt/`, `.tools/`, or personal memory. Local memory updates are user data; do not overwrite them when updating templates.
- Test with `npm run check` and `npm test`. The integration tests use local fixtures, never paid providers or real personal memory.
- Preserve fact / user view / AI explanation / shared question distinctions. Do not infer knowledge levels from vocabulary familiarity.
- Record behavior/API decisions in `docs/PI-RESEARCH.md`; future features belong in `ROADMAP.md`.
