// `ng serve` forwards /api to the Node backend, so the browser sees a single origin (no CORS needed).
// Backend port: BACKEND_PORT (default 3000). Keep it in sync with PORT in backend/.env.
const port = process.env.BACKEND_PORT || 3000;

module.exports = {
  '/api': {
    target: `http://127.0.0.1:${port}`,
    secure: false,
  },
};
