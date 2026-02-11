import dotenv from 'dotenv';

const MODES = ['paper', 'demo', 'real'];
const NODE_ENVS = ['development', 'production'];
const BYBIT_ENVS = ['demo', 'testnet', 'mainnet'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ENV] ${message}`);
  }
}

export function loadEnv() {
  dotenv.config({ path: process.env.ENV_FILE || '.env' });

  const env = {
    PORT: Number(process.env.PORT || 3000),
    WS_PATH: process.env.WS_PATH || '/ws',
    NODE_ENV: process.env.NODE_ENV || 'development',
    LOG_DIR: process.env.LOG_DIR || './data/logs',

    TRADING_MODE: process.env.TRADING_MODE || 'paper',
    ENABLE_TRADING: process.env.ENABLE_TRADING || '0',
    BYBIT_ENV: process.env.BYBIT_ENV || 'demo',
    BYBIT_ALLOW_MAINNET: process.env.BYBIT_ALLOW_MAINNET || '0',
    BYBIT_API_KEY: process.env.BYBIT_API_KEY || '',
    BYBIT_API_SECRET: process.env.BYBIT_API_SECRET || '',
    CMC_API_KEY: process.env.CMC_API_KEY || ''
  };

  assert(Number.isInteger(env.PORT) && env.PORT > 0, 'PORT must be a positive integer');
  assert(NODE_ENVS.includes(env.NODE_ENV), 'NODE_ENV must be development|production');
  assert(env.WS_PATH.startsWith('/'), 'WS_PATH must start with /');
  assert(MODES.includes(env.TRADING_MODE), 'TRADING_MODE must be paper|demo|real');
  assert(['0', '1'].includes(env.ENABLE_TRADING), 'ENABLE_TRADING must be 0|1');
  assert(BYBIT_ENVS.includes(env.BYBIT_ENV), 'BYBIT_ENV must be demo|testnet|mainnet');
  assert(['0', '1'].includes(env.BYBIT_ALLOW_MAINNET), 'BYBIT_ALLOW_MAINNET must be 0|1');

  if (env.TRADING_MODE !== 'paper') {
    assert(env.BYBIT_API_KEY && env.BYBIT_API_SECRET, 'BYBIT_API_KEY/BYBIT_API_SECRET required in demo/real');
  }
  if (env.BYBIT_ENV === 'mainnet' && env.BYBIT_ALLOW_MAINNET !== '1') {
    assert(env.TRADING_MODE === 'paper', 'mainnet usage disabled unless BYBIT_ALLOW_MAINNET=1');
  }

  return env;
}

export function getSafetyGates(env) {
  const tradingEnabled = env.ENABLE_TRADING === '1';
  const mainnetAllowed = env.BYBIT_ENV !== 'mainnet' || env.BYBIT_ALLOW_MAINNET === '1';
  return {
    tradingEnabled,
    mainnetAllowed,
    canLiveTrade: tradingEnabled && mainnetAllowed
  };
}
