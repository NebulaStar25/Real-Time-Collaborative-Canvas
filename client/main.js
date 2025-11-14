// client/main.js
(function () {
  const socket = SocketClient.connect();

  // DOM
  const mainCanvas = document.getElementById("mainCanvas");
  const overlayCanvas = document.getElementById("overlayCanvas");
  const cursorCanvas = document.getElementById("cursorCanvas");

  const toolEl = document.getElementById("tool");
  const colorEl = document.getElementById("color");
  const sizeEl = document.getElementById("size");
  const undoBtn = document.getElementById("undo");
  const redoBtn = document.getElementById("redo");
  const clearBtn = document.getElementById("clear");
  const userListEl = document.getElementById("userList");

  // add FPS & latency display to topbar
  const fpsEl = document.createElement("span");
  fpsEl.style.marginLeft = "12px";
  fpsEl.textContent = "FPS: -";
  userListEl.parentElement.appendChild(fpsEl);

  const latEl = document.createElement("span");
  latEl.style.marginLeft = "12px";
  latEl.textContent = "RTT: - ms";
  userListEl.parentElement.appendChild(latEl);

  // determine room from URL
  function getRoomFromURL() {
    const url = new URL(window.location.href);
    let room = url.searchParams.get("room");
    if (!room) {
      const m = window.location.pathname.match(/^\/r\/([^\/]+)/);
      if (m) room = decodeURIComponent(m[1]);
    }
    return room || "main";
  }
  const ROOM = getRoomFromURL();

  const controller = new CanvasController(
    mainCanvas,
    overlayCanvas,
    cursorCanvas
  );

  let localUser = {
    userId: null,
    name: null,
    tool: toolEl.value,
    color: colorEl.value,
    width: parseInt(sizeEl.value, 10),
  };

  // update preview when controls change
  function updatePreviewAndLocal() {
    localUser.tool = toolEl.value;
    localUser.color = colorEl.value;
    localUser.width = parseInt(sizeEl.value, 10);
    controller.updateLocalCursorPreview({
      color: localUser.color,
      tool: localUser.tool,
      width: localUser.width,
    });
  }
  toolEl.addEventListener("change", updatePreviewAndLocal);
  colorEl.addEventListener("input", updatePreviewAndLocal);
  sizeEl.addEventListener("input", updatePreviewAndLocal);

  function updateUserList(users) {
    userListEl.textContent = Object.values(users)
      .map((u) => u.name)
      .join(", ");
  }

  socket.on("connect", () => {
    socket.emit("room:join", {
      room: ROOM,
      name: `Guest-${Math.floor(Math.random() * 10000)}`,
    });
  });

  socket.on("session:init", (payload) => {
    localUser.userId = payload.userId;
    localUser.name =
      payload.name || "Guest-" + Math.floor(Math.random() * 10000);
    localUser.color = payload.color || localUser.color;
    colorEl.value = localUser.color;
    if (payload.ops?.length)
      payload.ops.forEach((op) => controller.addOperation(op));
    updatePreviewAndLocal();
  });

  socket.on("user:list", (users) => updateUserList(users));
  socket.on("stroke:chunk", (d) =>
    controller.updateRemoteChunk(d.tempId, d.userId, d.meta, d.points)
  );
  socket.on("op:create", (op) => controller.confirmOpFromServer(op));
  socket.on("op:remove", ({ id }) => controller.removeOperationById(id));
  socket.on("room:clear", () => controller.clearAll());
  socket.on("cursor:update", (p) =>
    controller.updateCursor(p.userId, p.x, p.y, p)
  );

  // track pointer pos globally so canvasController can draw preview at pointer
  function setGlobalPointerPos(evt) {
    const rect = overlayCanvas.getBoundingClientRect();
    const pos = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    window.__localPointerPos = pos;
  }

  // FPS update handler from controller
  window.__updateFPS = (f) => {
    fpsEl.textContent = `FPS: ${f}`;
  };

  // Latency measurement: ping/pong
  let lastPingTs = 0;
  function pingServer() {
    lastPingTs = Date.now();
    socket.emit("ping:client", { ts: lastPingTs });
  }
  socket.on("pong:server", (payload) => {
    const rtt = Date.now() - (payload?.clientTs || lastPingTs || Date.now());
    latEl.textContent = `RTT: ${rtt} ms`;
  });
  setInterval(pingServer, 2000);

  // Drawing state
  let currentTempId = null;
  let chunkBuffer = [];

  // pointer handlers (pointer events unify mouse/touch/stylus)
  overlayCanvas.style.touchAction = "none";

  overlayCanvas.addEventListener("pointerdown", (e) => {
    overlayCanvas.setPointerCapture(e.pointerId);
    setGlobalPointerPos(e);

    const rect = overlayCanvas.getBoundingClientRect();
    const p = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      t: Date.now(),
    };

    // read latest UI
    localUser.tool = toolEl.value;
    localUser.color = colorEl.value;
    localUser.width = parseInt(sizeEl.value, 10);

    currentTempId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const meta = {
      userId: localUser.userId,
      tool: localUser.tool,
      color: localUser.color, // real color for brush, irrelevant for eraser
      width: localUser.width,
    };

    controller.startLocalStroke(currentTempId, meta, p);
    socket.emit("stroke:chunk", { tempId: currentTempId, points: [p], meta });
    socket.emit("cursor:update", {
      x: p.x,
      y: p.y,
      name: localUser.name,
      color: localUser.color,
    });

    chunkBuffer = [];
  });

  overlayCanvas.addEventListener("pointermove", (e) => {
    setGlobalPointerPos(e);
    const rect = overlayCanvas.getBoundingClientRect();
    const p = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      t: Date.now(),
    };
    socket.emit("cursor:update", {
      x: p.x,
      y: p.y,
      name: localUser.name,
      color: localUser.color,
    });

    if (!currentTempId) return;
    controller.appendLocalPoints(currentTempId, [p]);
    chunkBuffer.push(p);
    // send batched every N points to reduce traffic
    if (chunkBuffer.length >= 6) {
      socket.emit("stroke:chunk", {
        tempId: currentTempId,
        points: chunkBuffer.slice(),
        meta: null,
      });
      chunkBuffer = [];
    }
  });

  function finishStroke() {
    if (!currentTempId) return;
    if (chunkBuffer.length) {
      socket.emit("stroke:chunk", {
        tempId: currentTempId,
        points: chunkBuffer.slice(),
        meta: null,
      });
      chunkBuffer = [];
    }
    socket.emit("stroke:end", {
      tempId: currentTempId,
      meta: {
        color: localUser.color,
        tool: localUser.tool,
        width: localUser.width,
      },
    });
    controller.endLocalStroke(currentTempId);
    currentTempId = null;
  }

  overlayCanvas.addEventListener("pointerup", (e) => {
    overlayCanvas.releasePointerCapture(e.pointerId);
    finishStroke();
  });
  overlayCanvas.addEventListener("pointercancel", (e) => {
    overlayCanvas.releasePointerCapture(e.pointerId);
    finishStroke();
  });

  // fallback for older browsers (touch)
  if (!window.PointerEvent) {
    overlayCanvas.addEventListener(
      "touchstart",
      (ev) => {
        ev.preventDefault();
        const t = ev.touches[0];
        overlayCanvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            clientX: t.clientX,
            clientY: t.clientY,
            pointerId: 1,
          })
        );
      },
      { passive: false }
    );
    overlayCanvas.addEventListener(
      "touchmove",
      (ev) => {
        ev.preventDefault();
        const t = ev.touches[0];
        overlayCanvas.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: t.clientX,
            clientY: t.clientY,
          })
        );
      },
      { passive: false }
    );
    overlayCanvas.addEventListener(
      "touchend",
      (ev) => {
        ev.preventDefault();
        overlayCanvas.dispatchEvent(new PointerEvent("pointerup", {}));
      },
      { passive: false }
    );
  }

  undoBtn.addEventListener("click", () => socket.emit("action:undo"));
  redoBtn.addEventListener("click", () => socket.emit("action:redo"));
  clearBtn.addEventListener("click", () => socket.emit("action:clear"));
})();
