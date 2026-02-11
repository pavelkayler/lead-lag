export type RpcRequest = { type: string; id?: string; payload?: unknown };
export type RpcResponse = { type: 'response'; id?: string; ok: boolean; payload?: unknown; error?: string };
export type RpcEvent = { type: 'event'; topic: string; payload: unknown };
