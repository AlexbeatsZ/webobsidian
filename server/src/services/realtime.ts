/** Shared broadcaster so any route/service can push messages to all WS clients. */
type Broadcaster = (msg: unknown) => void;

let _broadcast: Broadcaster = () => {};
let heldNotifications: unknown[] | undefined;

export function holdVaultNotifications(): () => void {
  if (heldNotifications) throw new Error('Vault notifications are already held');
  const notifications: unknown[] = [];
  heldNotifications = notifications;
  return () => {
    if (heldNotifications !== notifications) return;
    heldNotifications = undefined;
    for (const message of notifications) _broadcast(message);
  };
}

export function setBroadcaster(fn: Broadcaster): void {
  _broadcast = fn;
}

export function broadcast(msg: unknown): void {
  if (heldNotifications) heldNotifications.push(msg);
  else _broadcast(msg);
}

let indexVersion = 0;
export function notifyIndexChanged(): void {
  broadcast({ type: 'index', version: ++indexVersion });
}
