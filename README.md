# Collaborative Canvas

## Overview

A minimal real-time collaborative drawing app using Node.js + Socket.IO and Vanilla JS canvas.

## Run locally

1. `npm install`
2. `npm start`
3. Open `http://localhost:3000` in multiple browser tabs to test multi-user.

## Files

- `client/` — frontend assets (index.html, canvas logic).
- `server/` — Node server, room & drawing state management.
- `package.json` — scripts & deps.

## How to test with multiple users

Open two or more browser windows to `http://localhost:3000`. Draw — strokes will sync across windows. Use Undo/Redo buttons (global behavior).

## Known limitations

- Current server logic uses a simplified metadata model (some stroke meta comes from user defaults).
- Undo/Redo is global and removes last operation (server-ordered). It may be surprising if you expect per-user undos.
- No persistence storage (on server restart, canvas clears).
- No authentication.
- Smoothing is basic (midpoint quadratic curves). For very high-frequency inputs, memory/CPU could be optimized further.

## Time spent

~4–6 hours (design + implementation + comments).

## Suggestions

See `ARCHITECTURE.md` for design reasoning and trade-offs.
