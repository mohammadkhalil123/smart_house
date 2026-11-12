/** Base URL of the backend. In development `ng serve` proxies /api to the Node server (proxy.conf.js). */
export const API_BASE_URL = '/api';

/** How often the dashboard re-reads the backend (the sensors report roughly every 8 s). */
export const POLL_INTERVAL_MS = 15_000;

/** How often the header re-checks that the backend is reachable. */
export const HEALTH_INTERVAL_MS = 30_000;

/** Minutes of history shown in the charts, ending at the newest measurement. */
export const WINDOW_MINUTES = 120;
