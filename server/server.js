// server/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { RoomManager } = require("./rooms");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000 });

const PORT = process.env.PORT || 3000;
const rooms = new RoomManager();

app.use("/static", express.static(path.join(__dirname, "..", "client")));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "client", "index.html"))
);
app.get("/r/:room", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "client", "index.html"))
);

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  // join room - client should send { room }
  socket.on("room:join", (data) => {
    try {
      const ROOM = data && data.room ? data.room : "main";
      const displayName = data?.name || null;
      const user = rooms.addUserToRoom(ROOM, socket.id, displayName);
      socket.join(ROOM);
      socket.emit("session:init", {
        userId: user.userId,
        name: user.name,
        color: user.color,
        ops: rooms.getOps(ROOM),
      });
      io.to(ROOM).emit("user:list", rooms.getUsers(ROOM));
      // attach current room to socket for easier lookup
      socket.data = socket.data || {};
      socket.data.room = ROOM;
    } catch (err) {
      console.error("room:join error", err);
    }
  });

  socket.on("stroke:chunk", (data) => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      if (!data || !data.tempId || !Array.isArray(data.points)) return;
      rooms.appendTemp(ROOM, socket.id, data.tempId, data.points);
      const roomObj = rooms.getRoom(ROOM);
      const user = roomObj?.users[socket.id];
      if (!user) return;
      const payload = {
        tempId: data.tempId,
        userId: user.userId,
        points: data.points,
        // meta: data.meta || {
        //   color: user.color,
        //   width: data.width || 4,
        //   tool: data.tool || "brush",
        // },
        meta: data.meta || null,
      };
      socket.to(ROOM).emit("stroke:chunk", payload);
    } catch (err) {
      console.error("stroke:chunk error", err);
    }
  });

  socket.on("stroke:end", (data) => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      if (!data || !data.tempId) return;
      const op = rooms.finalizeTemp(ROOM, socket.id, data.meta || null);
      if (op) io.to(ROOM).emit("op:create", op);
    } catch (err) {
      console.error("stroke:end error", err);
    }
  });

  socket.on("stroke:final", (payload) => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      if (!payload || !payload.op) return;
      const roomObj = rooms.getRoom(ROOM);
      const user = roomObj?.users[socket.id];
      if (!user) return;
      const opClient = payload.op;
      const serverOp = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 6),
        seq: roomObj.nextSeq || roomObj.operations.length + 1,
        tempId: opClient.tempId || null,
        userId: user.userId,
        tool: opClient.tool,
        color: opClient.color || user.color,
        width: opClient.width,
        points: opClient.points,
        timestamp: Date.now(),
      };
      rooms.pushOp(ROOM, serverOp);
      io.to(ROOM).emit("op:create", serverOp);
    } catch (err) {
      console.error("stroke:final error", err);
    }
  });

  socket.on("cursor:update", (c) => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      if (!c) return;
      const roomObj = rooms.getRoom(ROOM);
      const user = roomObj?.users[socket.id];
      if (!user) return;
      const payload = {
        userId: user.userId,
        x: c.x,
        y: c.y,
        name: user.name,
        color: user.color,
      };
      socket.to(ROOM).emit("cursor:update", payload);
    } catch (err) {
      console.error("cursor:update error", err);
    }
  });

  socket.on("action:undo", () => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      const op = rooms.undo(ROOM);
      if (op) io.to(ROOM).emit("op:remove", { id: op.id });
    } catch (err) {
      console.error("action:undo error", err);
    }
  });

  socket.on("action:redo", () => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      const op = rooms.redo(ROOM);
      if (op) io.to(ROOM).emit("op:create", op);
    } catch (err) {
      console.error("action:redo error", err);
    }
  });

  socket.on("action:clear", () => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      rooms.clear(ROOM);
      io.to(ROOM).emit("room:clear");
    } catch (err) {
      console.error("action:clear error", err);
    }
  });

  // latency ping from client; reply immediately with server timestamp
  socket.on("ping:client", (payload) => {
    socket.emit("pong:server", {
      clientTs: payload?.ts || 0,
      serverTs: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    try {
      const ROOM = socket.data && socket.data.room ? socket.data.room : "main";
      rooms.removeUserFromRoom(ROOM, socket.id);
      io.to(ROOM).emit("user:list", rooms.getUsers(ROOM));
      console.log("disconnected", socket.id);
    } catch (err) {
      console.error("disconnect error", err);
    }
  });
});

server.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);