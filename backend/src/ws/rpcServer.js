import { WebSocketServer } from 'ws';
import { ok, fail } from './rpcProtocol.js';
import { configSchema } from '../bot/configSchema.js';

export function createRpcServer({ server, path, bot, configStore, logger }) {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (socket) => {
    const push = (event) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(event));
    const unsubscribe = (event) => push(event);
    bot.on('event', unsubscribe);

    socket.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify(fail(null, 'BAD_JSON', 'Invalid JSON')));
        return;
      }

      if (message.type !== 'request') return;
      try {
        const result = await dispatch(message.method, message.params || {});
        socket.send(JSON.stringify(ok(message.id, result)));
      } catch (error) {
        socket.send(JSON.stringify(fail(message.id, 'RPC_ERROR', error.message)));
      }
    });

    socket.on('close', () => bot.off('event', unsubscribe));
  });

  async function dispatch(method, params) {
    switch (method) {
      case 'ping': return { pong: true };
      case 'getConfigSchema': return configSchema;
      case 'getConfig': return configStore.get();
      case 'setConfig': return configStore.set(params);
      case 'botStart': await bot.start(); return bot.getStatus();
      case 'botStop': bot.stop(); return bot.getStatus();
      case 'emergencyStop': return bot.emergencyStop(Boolean(params.closePositions));
      case 'getStatus': return bot.getStatus();
      case 'getUniverse': return bot.getUniverse();
      case 'getCandidates': return bot.getCandidates();
      case 'getPositions': return bot.gateway.getPositions ? bot.gateway.getPositions() : [];
      case 'getOpenOrders': return bot.gateway.getOpenOrders ? bot.gateway.getOpenOrders() : [];
      default: throw new Error(`Unknown method: ${method}`);
    }
  }

  logger.info({ path }, 'RPC WebSocket server started');
  return wss;
}
