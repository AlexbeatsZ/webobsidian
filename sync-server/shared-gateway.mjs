import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { routeWebObsidian } from './gateway-route.mjs';

export function addFileSyncRoute(gateway, routeMojian) {
  const listeners = gateway.server.listeners('request');
  if (listeners.length !== 1) throw new Error('Unexpected shared gateway handler; no service was started');
  gateway.server.removeListener('request', listeners[0]);
  gateway.server.on('request', (request, response) => {
    if (!routeWebObsidian(request, response) && !routeMojian(request, response)) listeners[0].call(gateway.server, request, response);
  });
  gateway.server.requestTimeout = 10 * 60 * 1000;
  return gateway;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Existing Dayweave gateway module and Mojian route module paths are required');
  const { createGateway } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
  const { routeMojian } = await import(pathToFileURL(path.resolve(process.argv[3])).href);
  const gateway = addFileSyncRoute(createGateway(), routeMojian);
  await gateway.listen();
  console.log('Shared Sakura gateway ready; existing services preserved');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => gateway.server.close(() => process.exit(0)));
}
