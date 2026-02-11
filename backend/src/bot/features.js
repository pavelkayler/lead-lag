import { zScore } from '../utils/math.js';

export function calcFeatures(state) {
  const vols = state.volumes.slice(-48);
  return {
    volZ: zScore(vols),
    liqLong15m: state.liqLong15m || 0,
    liqShort15m: state.liqShort15m || 0,
    oiDeltaPct15m: state.oiDeltaPct15m || 0,
    cvdSlope: state.cvdSlope || 0,
    atrPct15m: state.atrPct15m || 0,
    nearSupport: state.nearSupport || false,
    nearResistance: state.nearResistance || false
  };
}
