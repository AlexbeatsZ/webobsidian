/** Shared broadcaster so any route/service can push messages to all WS clients. */
type Broadcaster = (msg: unknown) => void;

let _broadcast: Broadcaster = () => {};

export function setBroadcaster(fn: Broadcaster): void {
  _broadcast = fn;
}

export function broadcast(msg: unknown): void {
  _broadcast(msg);
}

let indexVersion = 0;
export function notifyIndexChanged(): void {
  broadcast({ type: 'index', version: ++indexVersion });
}
