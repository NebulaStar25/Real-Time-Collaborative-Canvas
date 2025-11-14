// server/rooms.js
const fs = require("fs");
const path = require("path");

function roomDataPath(roomName) {
  const dir = path.join(__dirname, "..", "data", "rooms");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${roomName}.json`);
}

class Room {
  constructor(name) {
    this.name = name;
    this.users = {}; // socketId -> { userId, name, color }
    this.operations = []; // finalized ops
    this.redoStack = [];
    this.tempBuffers = new Map(); // socketId -> { tempId -> points[] }
    this.nextSeq = 1;
    this._saveTimer = null;
    this._loadFromDisk();
  }

  _loadFromDisk() {
    const p = roomDataPath(this.name);
    if (!fs.existsSync(p)) return;
    try {
      const json = JSON.parse(fs.readFileSync(p, "utf8"));
      this.operations = json.ops || [];
      this.nextSeq =
        json.nextSeq ||
        (this.operations.length
          ? this.operations[this.operations.length - 1].seq + 1
          : 1);
      // Ensure redoStack empty on load
      this.redoStack = [];
    } catch (err) {
      console.warn("Failed to load room data", this.name, err);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      try {
        const p = roomDataPath(this.name);
        fs.writeFileSync(
          p,
          JSON.stringify(
            { ops: this.operations, nextSeq: this.nextSeq },
            null,
            2
          ),
          "utf8"
        );
      } catch (err) {
        console.error("Failed to save room data", this.name, err);
      } finally {
        this._saveTimer = null;
      }
    }, 300); // debounce 300ms
  }

  addUser(socketId, displayName) {
    const userId = `u-${Math.random().toString(36).slice(2, 8)}`;
    const palette = [
      "#0b66ff",
      "#ff4d6d",
      "#1bbc9b",
      "#ff8f3d",
      "#8e44ad",
      "#00bcd4",
      "#ffb300",
    ];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const user = {
      userId,
      name: displayName || `Guest-${userId.slice(2, 6)}`,
      color,
    };
    this.users[socketId] = user;
    return user;
  }

  removeUser(socketId) {
    delete this.users[socketId];
    this.tempBuffers.delete(socketId);
  }

  getUsers() {
    const out = {};
    for (const sid in this.users) {
      const u = this.users[sid];
      out[u.userId] = { userId: u.userId, name: u.name, color: u.color };
    }
    return out;
  }

  appendTempPoints(socketId, tempId, points) {
    if (!this.tempBuffers.has(socketId)) this.tempBuffers.set(socketId, {});
    const map = this.tempBuffers.get(socketId);
    if (!map[tempId]) map[tempId] = [];
    map[tempId].push(...(points || []));
  }

  finalizeTemp(socketId, tempId, meta) {
    const map = this.tempBuffers.get(socketId) || {};
    const pts = map[tempId] || [];
    delete map[tempId];
    if (!pts.length) return null;
    const user = this.users[socketId];
    const op = {
      id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6),
      seq: this.nextSeq++,
      tempId: tempId || null,
      userId: user.userId,
      tool: (meta && meta.tool) || "brush",
      color: (meta && meta.color) || user.color,
      width: (meta && meta.width) || 4,
      points: pts,
      timestamp: Date.now(),
    };
    this.operations.push(op);
    this.redoStack.length = 0;
    this._scheduleSave();
    return op;
  }

  pushOp(op) {
    // When server receives full op from client
    if (!op.seq) op.seq = this.nextSeq++;
    this.operations.push(op);
    this._scheduleSave();
  }

  undoOne() {
    if (!this.operations.length) return null;
    const op = this.operations.pop();
    this.redoStack.push(op);
    this._scheduleSave();
    return op;
  }

  redoOne() {
    if (!this.redoStack.length) return null;
    const op = this.redoStack.pop();
    this.operations.push(op);
    this._scheduleSave();
    return op;
  }

  getOps() {
    // Return shallow copy sorted by seq (should already be)
    return this.operations.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  clear() {
    this.operations = [];
    this.redoStack = [];
    this.tempBuffers.clear();
    this._scheduleSave();
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.getRoom("main");
  }

  getRoom(name) {
    const key = name || "main";
    if (!this.rooms.has(key)) this.rooms.set(key, new Room(key));
    return this.rooms.get(key);
  }

  addUserToRoom(name, socketId, displayName) {
    return this.getRoom(name).addUser(socketId, displayName);
  }
  removeUserFromRoom(name, socketId) {
    return this.getRoom(name).removeUser(socketId);
  }
  getUsers(name) {
    return this.getRoom(name).getUsers();
  }
  appendTemp(name, socketId, tempId, points) {
    this.getRoom(name).appendTempPoints(socketId, tempId, points);
  }
  finalizeTemp(name, socketId, tempId, meta) {
    return this.getRoom(name).finalizeTemp(socketId, tempId, meta);
  }
  pushOp(name, op) {
    this.getRoom(name).pushOp(op);
  }
  undo(name) {
    return this.getRoom(name).undoOne();
  }
  redo(name) {
    return this.getRoom(name).redoOne();
  }
  getOps(name) {
    return this.getRoom(name).getOps();
  }
  clear(name) {
    this.getRoom(name).clear();
  }
}

module.exports = { RoomManager };
