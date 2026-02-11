export function buildRiskChecks(env, config) {
  return {
    canEnter: env.ENABLE_TRADING === '1' || env.TRADING_MODE === 'paper',
    hardMaxHoldHours: 24,
    slPctDefault: config.slPctDefault
  };
}
