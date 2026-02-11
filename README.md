# Range/Liquidation Bot (Bybit Linear USDT Perps)

> ⚠️ Не финансовый совет. Использование на реальном рынке на ваш риск.

## Быстрый старт (dev)
1. Скопируйте `.env.example` в `.env`.
2. `npm install`
3. `npm run dev`
4. Откройте `http://localhost:5173`.

## Production
1. `npm run build`
2. `npm start`
3. Backend отдает frontend build и WS-RPC на одном процессе Node.js.

## TRADING_MODE
- `paper`: симуляция заявок и позиций (без реальных ордеров).
- `demo`: торговля через Bybit REST private endpoints.
- `real`: торговля через Bybit Trade WebSocket (REST fallback).

## Ключевые safety-gates
- Если `ENABLE_TRADING != 1` — фактическая торговля блокируется, используется paper gateway.
- Если `BYBIT_ENV=mainnet` и `BYBIT_ALLOW_MAINNET != 1` — реальная торговля запрещена.
- Стратегия использует только `category=linear`.
- У ордеров уникальные `orderLinkId`.
- Есть RPC `emergencyStop` (остановка входов, отмена ордеров, опциональное закрытие позиций).

## Основные параметры стратегии
- Universe: `minTurnover24hUSDT`, `minATRPct15m`, `maxSymbols`, `tradeOnlyCrab`.
- Signals: `liqThreshUSDT`, `volZThresh`, `cvdLookbackBars`.
- Risk/Execution: `entrySplitPct`, `addMovePct`, `slPctDefault`, `tp1Pct`, `tp2Pct`, `tp1ClosePct`, `beBufferBps`, `maxHoldHoursAlt`, `maxHoldHoursBtc`.

## Архитектура
- `backend/`: express + ws rpc + bot engine + gateways (paper/rest/ws).
- `frontend/`: Vite + React + Router + Bootstrap (dashboard/config/symbols/positions/logs).
- `data/`: config/logs/state.
