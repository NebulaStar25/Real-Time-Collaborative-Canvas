// // client/websocket.js
// const SocketClient = (() => {
//   let socket = null;
//   function connect() {
//     if (!socket) socket = io();
//     return socket;
//   }
//   function on(event, cb) {
//     connect().on(event, cb);
//   }
//   function emit(event, data, ack) {
//     connect().emit(event, data, ack);
//   }
//   return { connect, on, emit };
// })();

// // client/websocket.js
// export class WebSocketClient {
//   constructor(canvasController) {
//     this.canvasController = canvasController;
//     this.socket = null;
//     this.userId = null;
//     this.color = "#000";
//   }

//   connect() {
//     this.socket = new WebSocket(`ws://${window.location.host}`);
//     this.socket.addEventListener("open", () => console.log("✅ Connected"));

//     this.socket.addEventListener("message", (event) => {
//       const msg = JSON.parse(event.data);

//       if (msg.type === "init") {
//         this.userId = msg.userId;
//         this.color = msg.color;
//         for (const op of msg.operations) {
//           this.canvasController.operations.push(op);
//         }
//         this.canvasController._rebuildBacking();
//       }

//       if (msg.type === "stroke") {
//         this.canvasController.addOperation(msg.op);
//       }

//       if (msg.type === "cursor") {
//         this.canvasController.updateCursor(msg.userId, msg.x, msg.y, {
//           color: msg.color,
//         });
//       }
//     });
//   }

//   sendStroke(stroke) {
//     if (this.socket?.readyState === WebSocket.OPEN) {
//       this.socket.send(JSON.stringify({ type: "stroke", stroke }));
//     }
//   }

//   sendCursor(x, y) {
//     if (this.socket?.readyState === WebSocket.OPEN && this.userId) {
//       this.socket.send(
//         JSON.stringify({
//           type: "cursor",
//           userId: this.userId,
//           x,
//           y,
//         })
//       );
//     }
//   }
// }

// client/websocket.js
// Simple Socket.IO wrapper for the client
const SocketClient = (() => {
  let socket = null;
  function connect() {
    if (!socket) socket = io();
    return socket;
  }
  function on(ev, cb) {
    connect().on(ev, cb);
  }
  function emit(ev, data, ack) {
    connect().emit(ev, data, ack);
  }
  return { connect, on, emit };
})();
