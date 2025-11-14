// client/canvas.js
class CanvasController {
  constructor(mainCanvas, overlayCanvas, cursorCanvas) {
    this.canvas = mainCanvas;
    this.overlay = overlayCanvas;
    this.cursorCanvas = cursorCanvas;

    this.ctx = this.canvas.getContext("2d");
    this.ovCtx = this.overlay.getContext("2d");
    this.cursorCtx = this.cursorCanvas.getContext("2d");

    this.devicePixelRatio = window.devicePixelRatio || 1;
    this.operations = []; // finalized ops (server canonical)
    this.pendingLocal = new Map(); // tempId -> op
    this.remoteInProgress = new Map(); // tempId -> {points, meta, userId}
    this.localCursorMeta = { color: "#0b66ff", width: 4, tool: "brush" };

    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.overlay.style.touchAction = "none";

    // FPS tracking
    this._fps = 0;
    this._frameCount = 0;
    this._lastFpsTime = performance.now();

    requestAnimationFrame(() => this._frame());
  }

  // For external UI
  getFPS() {
    return this._fps;
  }

  resize() {
    const rect = this.overlay.parentElement.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(200, Math.floor(rect.height));
    const sw = Math.floor(w * this.devicePixelRatio);
    const sh = Math.floor(h * this.devicePixelRatio);

    [this.canvas, this.overlay, this.cursorCanvas].forEach((c) => {
      c.width = sw;
      c.height = sh;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    });

    this.ctx.setTransform(
      this.devicePixelRatio,
      0,
      0,
      this.devicePixelRatio,
      0,
      0
    );
    this.ovCtx.setTransform(
      this.devicePixelRatio,
      0,
      0,
      this.devicePixelRatio,
      0,
      0
    );
    this.cursorCtx.setTransform(
      this.devicePixelRatio,
      0,
      0,
      this.devicePixelRatio,
      0,
      0
    );

    this._rebuildBacking();
  }

  // start optimistic local stroke
  startLocalStroke(tempId, meta, startPoint) {
    this.localCursorMeta = { ...meta };
    const op = {
      tempId,
      userId: meta.userId,
      tool: meta.tool,
      color: meta.color,
      width: meta.width,
      points: [startPoint],
      timestamp: Date.now(),
    };
    this.pendingLocal.set(tempId, op);
  }

  appendLocalPoints(tempId, points) {
    const op = this.pendingLocal.get(tempId);
    if (!op) return;
    op.points.push(...points);
  }

  endLocalStroke(tempId) {
    // keep op in pendingLocal until server confirms
  }

  updateRemoteChunk(tempId, userId, meta, points) {
    if (!this.remoteInProgress.has(tempId)) {
      this.remoteInProgress.set(tempId, {
        points: [],
        meta: meta || { color: "#000", width: 4, tool: "brush" },
        userId,
      });
    }
    const rec = this.remoteInProgress.get(tempId);
    rec.points.push(...(points || []));
  }

  confirmOpFromServer(op) {
    if (!op || !op.id) return;
    // remove any in-progress with same tempId
    if (op.tempId) {
      if (this.remoteInProgress.has(op.tempId))
        this.remoteInProgress.delete(op.tempId);
      if (this.pendingLocal.has(op.tempId)) this.pendingLocal.delete(op.tempId);
    }
    // insert and maintain seq ordering
    this.operations.push(op);
    this.operations.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    this._rebuildBacking();
  }

  addOperation(op) {
    this.confirmOpFromServer(op);
  }

  removeOperationById(id) {
    this.operations = this.operations.filter((o) => o.id !== id);
    this._rebuildBacking();
  }

  clearAll() {
    this.operations = [];
    this.pendingLocal.clear();
    this.remoteInProgress.clear();
    this._rebuildBacking();
  }

  updateCursor(userId, x, y, meta) {
    this.cursorsMap = this.cursorsMap || {};
    this.cursorsMap[userId] = {
      x,
      y,
      color: meta?.color,
      name: meta?.name,
      lastSeen: Date.now(),
    };
  }

  updateLocalCursorPreview(meta) {
    this.localCursorMeta = { ...meta };
  }

  // _renderOpToBacking(op) {
  //   const ctx = this.ctx;
  //   ctx.save();
  //   ctx.lineJoin = "round";
  //   ctx.lineCap = "round";

  //   if (op.tool === "eraser") {
  //     ctx.globalCompositeOperation = "destination-out";
  //     ctx.strokeStyle = "rgba(0,0,0,1)";
  //   } else {
  //     ctx.globalCompositeOperation = "source-over";
  //     ctx.strokeStyle = op.color || "#000000";
  //   }
  //   ctx.lineWidth = op.width;

  //   this._strokePoints(ctx, op.points);
  //   ctx.restore();
  // }
  _renderOpToBacking(op) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (op.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = op.color || "#000000";
    }

    ctx.lineWidth = op.width;
    this._strokePoints(ctx, op.points);

    ctx.restore();
  }

  _strokePoints(ctx, pts) {
    if (!pts || !pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1],
        p = pts[i];
      const mx = (prev.x + p.x) / 2,
        my = (prev.y + p.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }

  _rebuildBacking() {
    const w = this.canvas.width / this.devicePixelRatio;
    const h = this.canvas.height / this.devicePixelRatio;
    this.ctx.clearRect(0, 0, w, h);
    // draw all ops in order
    for (const op of this.operations) this._renderOpToBacking(op);
  }

  _frame() {
    // FPS calc
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
      // expose fps globally for UI polling
      if (window.__updateFPS) window.__updateFPS(this._fps);
    }

    const w = this.canvas.width / this.devicePixelRatio;
    const h = this.canvas.height / this.devicePixelRatio;
    // overlay: pending and remote previews
    this.ovCtx.clearRect(0, 0, w, h);
    // pending local
    for (const op of this.pendingLocal.values()) {
      this.ovCtx.save();
      this.ovCtx.lineJoin = "round";
      this.ovCtx.lineCap = "round";

      if (op.tool === "eraser") {
        this.ovCtx.globalCompositeOperation = "destination-out";
        this.ovCtx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        this.ovCtx.globalCompositeOperation = "source-over";
        this.ovCtx.strokeStyle = op.color;
      }

      this.ovCtx.lineWidth = op.width;
      this._strokePoints(this.ovCtx, op.points);
      this.ovCtx.restore();
    }

    // remote in-progress
    for (const rec of this.remoteInProgress.values()) {
      const meta = rec.meta;

      this.ovCtx.save();
      this.ovCtx.lineJoin = "round";
      this.ovCtx.lineCap = "round";

      if (meta.tool === "eraser") {
        this.ovCtx.globalCompositeOperation = "destination-out";
        this.ovCtx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        this.ovCtx.globalCompositeOperation = "source-over";
        this.ovCtx.strokeStyle = meta.color;
      }

      this.ovCtx.lineWidth = meta.width;
      this._strokePoints(this.ovCtx, rec.points);
      this.ovCtx.restore();
    }

    // cursors
    this.cursorCtx.clearRect(0, 0, w, h);
    const nowT = Date.now();
    for (const [uid, c] of Object.entries(this.cursorsMap || {})) {
      if (!c || nowT - (c.lastSeen || 0) > 3000) continue;
      this.cursorCtx.beginPath();
      this.cursorCtx.fillStyle = c.color || "#000";
      this.cursorCtx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      this.cursorCtx.fill();
      this.cursorCtx.font = "12px Arial";
      this.cursorCtx.fillStyle = "#111";
      this.cursorCtx.fillText(c.name || uid, c.x + 8, c.y + 4);
    }

    // draw local cursor preview near pointer if provided via global variable
    if (window.__localPointerPos) {
      const pos = window.__localPointerPos;
      const m = this.localCursorMeta || {
        color: "#000",
        width: 4,
        tool: "brush",
      };
      this.cursorCtx.beginPath();
      this.cursorCtx.strokeStyle = m.tool === "eraser" ? "#666" : m.color;
      this.cursorCtx.lineWidth = 1;
      this.cursorCtx.arc(
        pos.x,
        pos.y,
        Math.max(2, m.width / 2),
        0,
        Math.PI * 2
      );
      this.cursorCtx.stroke();
    } else {
      // fallback: show preview at top-right small indicator
      const m = this.localCursorMeta || {
        color: "#000",
        width: 4,
        tool: "brush",
      };
      this.cursorCtx.beginPath();
      this.cursorCtx.strokeStyle = m.tool === "eraser" ? "#666" : m.color;
      this.cursorCtx.lineWidth = 1;
      this.cursorCtx.arc(w - 40, 40, Math.max(2, m.width / 2), 0, Math.PI * 2);
      this.cursorCtx.stroke();
    }

    requestAnimationFrame(() => this._frame());
  }
}
