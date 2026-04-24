# CrateSwipe

Tinder-style DJ music discovery app. Private tool for a small group of friends, over Tailscale.

**Full spec and task list:** `~/.openclaw/workspace-coder/CRATESWIPE_BRIEF.md`

## Stack

- **Backend:** Fastify + TypeScript, `better-sqlite3`, Node 22+
- **Mobile:** Expo (prebuild) + React Native
- **Data:** Deezer (catalogue + previews) · Last.fm (similarity) · GetSongBPM (BPM/key) · Odesli (buy/listen links)
- **Download:** yt-dlp (server-side)

## Development

```bash
npm install
npm run typecheck
npm run test
npm run dev:api
```

## Deployment

Runs on Gregor's VPS as `crateswipe-api.service` (systemd user service), bound to `127.0.0.1:3000`. Access via Tailscale only.
