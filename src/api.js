// Everything the dashboard knows about the server. Requests go to the same origin and are
// proxied to the API by the dev server, so there is no cross-origin request to arrange and
// no second hostname baked into the frontend.

const TOKEN_KEY = "access-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, body) {
    super(typeof body?.message === "string" ? body.message : `request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = "GET", body } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed;
}

// The API stores decimals as strings so no precision is lost in transit, and keeps share
// counts and dividend cash in separate columns. The dashboard's maths predates both, and
// works in numbers with the dividend amount in `qty`, so the shapes are converted here
// rather than by rewriting a thousand lines of working arithmetic.
function toDashboardRow(row) {
  const isDividend = row.type === "DIVIDEND";
  return {
    id: row.id,
    date: row.tradeDate.slice(0, 10),
    ticker: row.ticker,
    type: row.type.toLowerCase(),
    qty: Number(isDividend ? row.amount : row.qty),
    price: isDividend ? 0 : Number(row.price),
    fee: Number(row.fee ?? 0),
    source: row.source,
    note: row.note ?? undefined,
  };
}

function toApiBody(row) {
  const isDividend = row.type === "dividend";
  return {
    tradeDate: row.date,
    ticker: row.ticker,
    type: row.type.toUpperCase(),
    ...(isDividend ? { amount: row.qty } : { qty: row.qty, price: row.price }),
    fee: row.fee ?? 0,
    ...(row.note ? { note: row.note } : {}),
  };
}

export const api = {
  me: () => request("/auth/me"),

  async transactions() {
    const rows = await request("/transactions");
    return rows.map(toDashboardRow);
  },

  async createTransaction(row) {
    return toDashboardRow(await request("/transactions", { method: "POST", body: toApiBody(row) }));
  },

  deleteTransaction: (id) => request(`/transactions/${id}`, { method: "DELETE" }),

  async prices() {
    const rows = await request("/prices");
    const byTicker = {};
    let latest = null;
    for (const row of rows) {
      byTicker[row.ticker] = Number(row.price);
      if (row.fetchedAt && (!latest || row.fetchedAt > latest)) latest = row.fetchedAt;
    }
    return { prices: byTicker, fetchedAt: latest };
  },

  setPrice: (ticker, price) => request(`/prices/${ticker}`, { method: "PUT", body: { price } }),

  async yearEndPrices() {
    const byYear = await request("/prices/year-end/all");
    const out = {};
    for (const [year, tickers] of Object.entries(byYear)) {
      out[year] = Object.fromEntries(Object.entries(tickers).map(([t, p]) => [t, Number(p)]));
    }
    return out;
  },

  setYearEndPrice: (ticker, year, price) =>
    request(`/prices/year-end/${ticker}`, { method: "PUT", body: { year: Number(year), price } }),

  importLegacy: () => request("/legacy-import", { method: "POST" }),
};
