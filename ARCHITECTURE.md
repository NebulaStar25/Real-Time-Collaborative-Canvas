# ARCHITECTURE — Collaborative Canvas

## Data Flow Diagram (textual)

1. Client pointer -> local sampling -> local optimistic rendering.
2. Client batches points -> `stroke:chunk` -> server temp storage.
3. Client signals `stroke:end` -> server finalizes temp stroke -> creates authoritative `Operation` with server `id`.
4. Server pushes op to room history and emits `op:create` to all clients.
5. Clients receive `op:create` -> append to canonical operations and render to backing canvas.
6. Undo: client emits `action:undo` -> server pops last op -> emits `op:remove` -> clients remove and rebuild backing.

## WebSocket Protocol (events)

Client -> Server:

- `room:join` { name? }
- `cursor:update` { x, y, name, color }
- `stroke:chunk` { tempId, points[] }
- `stroke:end` { tempId }
- `stroke:final` { tempId, op } (fallback)
- `action:undo` / `action:redo` / `action:clear`

Server -> Client:

- `session:init` { userId, name, color, ops[], users }
- `user:list` { users... }
- `cursor:update` { userId, x, y, name, color }
- `op:create` { id, tempId?, userId, tool, color, width, points, timestamp }
- `op:remove` { id }
- `room:clear`

## Undo/Redo Strategy

- Server maintains `operations[]` and `redoStack[]`.
- `undo` pops last op from `operations` => put on `redoStack` and broadcast `op:remove`.
- `redo` pops from `redoStack` => push to `operations` and broadcast `op:create`.
- This is a global undo model (affects last global operation). It's simple and deterministic; discuss alternatives in interviews (per-user undo, collaborative CRDTs, OT).

## Conflict Resolution

- Conflicts resolved by operation ordering on server. Visual stacking is determined by op order; later ops draw on top.
- Overlapping strokes are not merged — they remain distinct operations.
- This approach is simple and predictable. For pixel-level merging or offline edits, more complex CRDTs or operational transforms would be necessary.

## Performance Decisions

- Offscreen/backing canvas used to avoid full redraw per frame; new canonical ops are composited onto backing.
- Clients optimistically render pending strokes to avoid latency feeling.
- Batching of points (`stroke:chunk`) reduces message frequency.
- Path smoothing using quadratic beziers offers good visual smoothness with fewer points.

## Extension Points / Scaling

- Persist operations in a DB for replay and loading.
- Implement rooms more fully (rooms created by name).
- Use binary serialization (e.g., msgpack) for performance on heavy loads.
- For many users: shard rooms, use horizontal scaling + Redis pub/sub for multi-instance sync.