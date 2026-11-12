# Smart Greenhouse

Angular 19 dashboard (standalone components, Chart.js) + Node.js/Express/TypeScript backend.

The backend reads two MongoDB collections (`Measures`, `Sprinkler`) – or, until the Raspberry Pi database
is reachable, deterministic **mock JSON files** with the same document structure. The Angular app only talks
to the REST API and never knows which source is active.

```
smart-greenhouse/
  src/                      Angular app
  proxy.conf.js             ng serve forwards /api -> backend (no CORS needed)
  backend/
    data/Measures.json      mock "Measures" collection (11 529 documents, 3 zones)
    data/Sprinkler.json     mock "Sprinkler" collection (18 activations)
    src/
      config/               environment loading + validation
      data/                 DataSource interface, MockDataSource, MongoDataSource (read-only)
      services/             measure logic, sprinkler ON/OFF reconstruction, time windows
      controllers/          validation + response building (framework independent)
      routes/, app.ts       Express wiring and error handling
      utils/                date/time (time-zone aware), run_time parsing, query validation
      scripts/              deterministic mock-data generator
      tests/                node:test suites
```

## Run on Windows (mock mode, no database needed)

Requires Node.js 18 or newer.

```powershell
# Terminal 1 - backend
cd backend
npm install
copy .env.example .env
npm run dev                 # http://127.0.0.1:3000/api  (DATA_SOURCE=mock)

# Terminal 2 - frontend (project root)
npm install
npm start                   # http://localhost:4200
```

The header badge shows **Mock data** (orange) in mock mode and **Live** only when the backend reads MongoDB.
If you change `PORT` in `backend/.env`, start the frontend with the same value:
`$env:BACKEND_PORT=3100; npm start`.

Production-style run of the backend: `npm run build` then `npm start` (inside `backend/`).

### Seeing the sprinkler ON in mock mode

The current sprinkler state is computed against "now". The demo data is from 10-11-2026, so by default the
sprinkler shows OFF. To demo an ON state set in `backend/.env`:

```
MOCK_NOW=2026-11-10T14:45:55
```

(zone 1 has a 14 s activation starting at 14:45:50). Leave it empty to use the real clock. It is ignored in
MongoDB mode. You can also query any instant directly: `/api/sprinkler/state?place=1&at=2026-11-10T14:45:55`.

## Switching to the real MongoDB (Raspberry Pi)

1. Edit `backend/.env` (never commit it; `.gitignore` already excludes it):
   ```
   DATA_SOURCE=mongodb
   MONGODB_URI=mongodb://USER:PASSWORD@<pi-address>:27017/?authSource=admin
   MONGODB_DATABASE=Rpi07            # your real database name; "RpiXX" is rejected
   MEASUREMENT_TIME_ZONE=Europe/Paris
   ```
2. Restart the backend. It fails fast with a clear message if the URI or database name is missing.
3. `GET /api/health` shows `dataSource: "mongodb"` and `dataSourceStatus`. No frontend change is needed.

Security notes
- Credentials live only in `backend/.env` / environment variables. Error messages and logs redact connection strings.
- The backend is **read-only**: it only runs `find`, `distinct` and `ping`; it creates no collections, fields or indexes.
- It listens on `127.0.0.1` by default. Do not expose MongoDB (port 27017) to the internet; prefer a MongoDB user
  with the `read` role on that one database, and reach the Pi over the local network / VPN / SSH tunnel
  (e.g. `ssh -L 27017:localhost:27017 pi@<address>` and `MONGODB_URI=mongodb://USER:PASS@127.0.0.1:27017/`).
- Optional performance tip (your decision, not done by the code): an index on `{ place: 1, date: 1 }` in both
  collections speeds up the per-day queries.

## API

All data endpoints require `place` (1, 2 or 3). Every response carries `meta: { dataSource, isMock, timeZone }`.
Errors: `{ "error": { "code", "message", "details?" } }` with 400 (validation), 404, 503 (data source down), 500.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Backend status, active data source, data-source reachability |
| `GET /api/zones` | `[{ place, id, name }]` for zones 1-3 |
| `GET /api/measures/latest?place=1` | Newest `temperature`, `humidity`, `luminosity` reading (each may be `null`) |
| `GET /api/measures/history?place=1&type=Tmp` | Points of one type (`Tmp`, `Hum`, `Lum`) |
| `GET /api/measures/series?place=1` | The three series of a zone on one shared window (dashboard charts) |
| `GET /api/sprinkler/state?place=1[&at=ISO]` | `ON`/`OFF`, active activations, `onUntil`, last activation |
| `GET /api/sprinkler/history?place=1` | Activations (start, `runTime`, type, calculated end), merged ON intervals, ON/OFF transitions |

Optional range parameters for history, series and sprinkler history:
`from`, `to` (ISO 8601, e.g. `2026-11-10T13:00:00+01:00`; **without an offset the value is read in
`MEASUREMENT_TIME_ZONE`, never as UTC**), and `windowMinutes` (1 – 10080). Rules: `from`+`to` = that range
(max 7 days); only `from` / only `to` = one window after / before it; nothing = the last 120 minutes ending at the
newest record of that zone (not "now", so old or demo data still shows).

Data rules
- `value` is converted to a number; the stored string is kept as `rawValue`. **Humidity is passed through
  unchanged** (258 stays 258, no unit, no ÷10). Temperature is °C, luminosity lux.
- `date` + `date_hour` are combined in `MEASUREMENT_TIME_ZONE` (DST handled), parsed and sorted as real
  instants, never as strings. Original strings are returned as `date` / `dateHour`.
- A measurement type is not assumed to exist at every timestamp. Malformed documents are skipped and counted in
  `invalidRecords`; documents of another zone are never returned.
- Sprinkler: `run_time` is parsed per record (microseconds, whitespace, `1 day, ...` forms; sub-millisecond precision
  is rounded). Each activation is ON for `[start, start + run_time)`. Overlapping or back-to-back activations in a
  zone are merged: it stays ON until the last one ends.
- Assumption to confirm on the real data: `date` is zero-padded `DD-MM-YYYY` and `date_hour` zero-padded `HH:mm:ss`.
  To avoid reading whole days, MongoDB queries narrow by exact `date` and by a time-string range *within one day*
  (valid for fixed-width times); all ordering still uses parsed timestamps.

## Frontend

- Zone cards on the home page, plus a zone selector (Zone 1 / 2 / 3) in the dashboard; `/zone` opens Zone 1.
  Switching zone discards the previous zone's data and reloads everything with the new `place`.
- Temperature, humidity and luminosity charts, the current values, the sprinkler status and the ON/OFF step chart all
  come from the API; charts use real timestamps and print times in the measurement time zone. Data refreshes every 15 s.
- Loading, empty ("No data for this period") and error states (with a retry button) are handled.

Deliberate differences from the old prototype
- "Motor" is now **Sprinkler** everywhere (the data comes from the `Sprinkler` collection).
- The humidity chart no longer shows the 75 % maximum line or `%` unit, because stored humidity values are raw numbers
  with an undefined unit. Re-enable with `THRESHOLDS.humidityMax` in `src/app/config/dashboard.config.ts`.
- The Turn ON/OFF button is shown but disabled: the backend is read-only and has no command endpoint yet.
- The "Live" badge is replaced by Mock data / Live / Backend offline depending on the backend.
- The fake in-browser data (`mock-data.ts`) was removed.

## Tests

```powershell
cd backend
npm test        # compiles with tsc, then runs node:test suites
```

Covers: zone filtering, type filtering, latest values, date parsing + chronological sorting (incl. DST and the
`31-10` vs `01-11` string-order trap), run_time parsing, ON/OFF reconstruction, overlapping/nested/back-to-back
activations, query validation, configuration, mock vs MongoDB source selection, MongoDB query construction (against a
fake driver) and identical API output from both sources.

To regenerate the demo data (deterministic, byte-identical every time): `npm run mock:generate`.
