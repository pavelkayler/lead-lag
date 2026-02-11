# lead-lag v2

## Dev

- Backend (TS): `cd backend && npm i && npm run dev`
- Frontend (new): `cd frontend && npm i && npm run dev`
- Frontend (old): `cd frontend/old && npm i && npm run dev`

## Production build

1. `cd frontend && npm run build`
2. `cd frontend/old && npm run build` (base=`/old/`)
3. `cd backend && npm run build && npm run start`

Backend serves:
- `/` -> `frontend/dist`
- `/old` -> `frontend/old/dist`
