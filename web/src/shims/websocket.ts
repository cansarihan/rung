// The browser already has WebSocket. isomorphic-ws only publishes it as a
// default export, so this re-exports it under both shapes.
export const WebSocket = globalThis.WebSocket;
export default globalThis.WebSocket;
