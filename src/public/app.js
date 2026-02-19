const authStatus = document.getElementById("authStatus");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const loginLink = document.getElementById("loginLink");
const resultEl = document.getElementById("result");
const copyBtn = document.getElementById("copyResult");
const clearBtn = document.getElementById("clearResult");

const LABELS = {
  net: "Net",
  cash: "Cash",
  opening_balance: "Opening balance",
  live_balance: "Live balance",
  collateral: "Collateral",
  adhoc_margin: "Adhoc margin",
  intraday_payin: "Intraday pay-in",
  debits: "Debits",
  exposure: "Exposure",
  m2m_realised: "M2M realised",
  enabled: "Enabled",
  utilised: "Utilised",
  available: "Available",
};

function fmtNum(n) {
  if (n == null || n === "") return "–";
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(n);
}

function row(label, value) {
  return `<div class="result-row"><span class="result-label">${escapeHtml(label)}</span><span class="result-value">${escapeHtml(value)}</span></div>`;
}

function section(title, rowsHtml) {
  return `<div class="result-section"><h3 class="result-section-title">${escapeHtml(title)}</h3>${rowsHtml}</div>`;
}

function escapeHtml(s) {
  if (s == null) return "";
  const str = String(s);
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatMargins(data) {
  if (!data.data) return null;
  const d = data.data;
  const parts = [];
  if (d.equity) {
    const eq = d.equity;
    const available = eq.available || {};
    const utilised = eq.utilised || {};
    parts.push(section("Equity", [
      row("Net", fmtNum(eq.net)),
      row("Enabled", eq.enabled ? "Yes" : "No"),
      row("— Available —", ""),
      row("Cash", fmtNum(available.cash)),
      row("Opening balance", fmtNum(available.opening_balance)),
      row("Live balance", fmtNum(available.live_balance)),
      row("Collateral", fmtNum(available.collateral)),
      row("Adhoc margin", fmtNum(available.adhoc_margin)),
      row("Intraday pay-in", fmtNum(available.intraday_payin)),
      row("— Utilised —", ""),
      row("Debits", fmtNum(utilised.debits)),
      row("Exposure", fmtNum(utilised.exposure)),
      row("M2M realised", fmtNum(utilised.m2m_realised)),
    ].join("")));
  }
  if (d.commodity) {
    const c = d.commodity;
    const available = c.available || {};
    const utilised = c.utilised || {};
    parts.push(section("Commodity", [
      row("Net", fmtNum(c.net)),
      row("— Available —", ""),
      row("Cash", fmtNum(available.cash)),
      row("Opening balance", fmtNum(available.opening_balance)),
      row("Live balance", fmtNum(available.live_balance)),
      row("— Utilised —", ""),
      row("Exposure", fmtNum(utilised.exposure)),
    ].join("")));
  }
  return parts.length ? `<div class="result-formatted">${parts.join("")}</div>` : null;
}

function formatProfile(data) {
  if (!data.data) return null;
  const p = data.data;
  const rows = [
    row("User ID", p.user_id),
    row("User name", p.user_name),
    row("Email", p.email),
    row("User type", p.user_type),
    row("Broker", p.broker),
  ].filter(Boolean).join("");
  return `<div class="result-formatted">${section("Profile", rows)}</div>`;
}

function formatOrders(data) {
  if (!data.data || !Array.isArray(data.data)) return null;
  const rows = data.data.slice(0, 50).map((o) => {
    return `<tr><td>${escapeHtml(o.tradingsymbol)}</td><td>${escapeHtml(o.transaction_type)}</td><td>${escapeHtml(o.quantity)}</td><td>${escapeHtml(o.status)}</td><td>${escapeHtml(o.product)}</td></tr>`;
  }).join("");
  const table = `<table class="result-table"><thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Status</th><th>Product</th></tr></thead><tbody>${rows}</tbody></table>`;
  const count = data.data.length > 50 ? `Showing 50 of ${data.data.length}` : "";
  return `<div class="result-formatted"><div class="result-section"><h3 class="result-section-title">Orders${count ? " · " + count : ""}</h3>${table}</div></div>`;
}

function formatPositions(data) {
  if (!data.data) return null;
  const d = data.data;
  const list = (Array.isArray(d) ? d : (d.net || [])).filter((p) => Number(p.quantity) !== 0);
  if (list.length === 0) {
    return `<div class="result-formatted">${section("Positions", row("No open positions", ""))}</div>`;
  }
  const rows = list.slice(0, 50).map((p) => {
    return `<tr><td>${escapeHtml(p.tradingsymbol)}</td><td>${escapeHtml(p.quantity)}</td><td>${escapeHtml(p.product)}</td><td>${fmtNum(p.pnl)}</td></tr>`;
  }).join("");
  const table = `<table class="result-table"><thead><tr><th>Symbol</th><th>Qty</th><th>Product</th><th>P&amp;L</th></tr></thead><tbody>${rows}</tbody></table>`;
  const count = list.length > 50 ? `Showing 50 of ${list.length}` : "";
  return `<div class="result-formatted"><div class="result-section"><h3 class="result-section-title">Positions${count ? " · " + count : ""}</h3>${table}</div></div>`;
}

const FORMATTERS = {
  margins: formatMargins,
  profile: formatProfile,
  orders: formatOrders,
  positions: formatPositions,
};

async function checkAuth() {
  try {
    const res = await fetch("/api/auth");
    const data = await res.json();
    if (data.hasToken) {
      authStatus.classList.add("connected");
      authStatus.classList.remove("disconnected");
      statusText.textContent = "Connected";
      loginLink.style.display = "none";
    } else {
      authStatus.classList.add("disconnected");
      authStatus.classList.remove("connected");
      statusText.textContent = "Not authenticated";
      loginLink.href = data.loginUrl || "#";
      loginLink.textContent = "Get login URL";
      loginLink.style.display = "inline";
    }
  } catch (e) {
    authStatus.classList.add("disconnected");
    statusText.textContent = "Error";
    loginLink.style.display = "none";
  }
}

let lastRawJson = null;

function showResult(obj, isError = false, endpoint = null) {
  resultEl.classList.toggle("error", isError);
  const rawStr = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  lastRawJson = rawStr;

  const formatter = endpoint && FORMATTERS[endpoint];
  const formatted = formatter && !isError && formatter(typeof obj === "object" ? obj : { data: obj });
  if (formatted) {
    resultEl.innerHTML = formatted;
    resultEl.classList.add("result-has-formatted");
    const actions = document.getElementById("resultActions");
    const existingRaw = actions?.querySelector(".result-view-raw");
    if (existingRaw) existingRaw.remove();
    if (actions) {
      const rawLink = document.createElement("button");
      rawLink.type = "button";
      rawLink.className = "btn btn-ghost result-view-raw";
      rawLink.textContent = "View raw JSON";
      rawLink.addEventListener("click", () => {
        resultEl.innerHTML = "";
        const pre = document.createElement("pre");
        pre.textContent = lastRawJson;
        pre.className = "result" + (isError ? " error" : "");
        resultEl.appendChild(pre);
        resultEl.classList.remove("result-has-formatted");
        rawLink.remove();
      });
      actions.appendChild(rawLink);
    }
    return;
  }
  resultEl.classList.remove("result-has-formatted");
  resultEl.innerHTML = "";
  const pre = document.createElement("pre");
  pre.textContent = rawStr;
  pre.className = "result" + (isError ? " error" : "");
  resultEl.appendChild(pre);
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "…" : btn.dataset.label ?? btn.textContent;
}

async function fetchData(endpoint, label) {
  const btn = document.querySelector(`[data-fetch="${endpoint}"]`);
  if (btn) {
    btn.dataset.label = btn.textContent;
    setLoading(btn, true);
  }
  try {
    const res = await fetch(`/api/${endpoint}`);
    const data = await res.json();
    if (!res.ok) {
      showResult({ error: data.error || res.statusText }, true, null);
      return;
    }
    showResult(data, false, endpoint);
  } catch (e) {
    showResult({ error: e.message }, true);
  } finally {
    if (btn) setLoading(btn, false);
  }
}

async function placeOrder(formId, endpoint) {
  const form = document.getElementById(formId);
  const submitBtn = form.querySelector('button[type="submit"]');
  const payload = {};
  new FormData(form).forEach((v, k) => { payload[k] = v; });
  payload.quantity = Number(payload.quantity);

  submitBtn.disabled = true;
  const origLabel = submitBtn.textContent;
  submitBtn.textContent = "Placing…";
  try {
    const res = await fetch(`/api/order/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showResult({ error: data.error || res.statusText }, true);
      return;
    }
    showResult({ orderId: data.orderId, message: "Order placed" });
  } catch (e) {
    showResult({ error: e.message }, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = origLabel;
  }
}

document.querySelectorAll("[data-fetch]").forEach((btn) => {
  btn.addEventListener("click", () => fetchData(btn.dataset.fetch));
});

document.getElementById("formEquity").addEventListener("submit", (e) => {
  e.preventDefault();
  placeOrder("formEquity", "equity");
});

document.getElementById("formFutures").addEventListener("submit", (e) => {
  e.preventDefault();
  placeOrder("formFutures", "futures");
});

document.getElementById("formOptions").addEventListener("submit", (e) => {
  e.preventDefault();
  placeOrder("formOptions", "options");
});

copyBtn.addEventListener("click", () => {
  const text = lastRawJson != null ? lastRawJson : resultEl.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "Copied";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  });
});

clearBtn.addEventListener("click", () => {
  lastRawJson = null;
  document.getElementById("resultActions")?.querySelector(".result-view-raw")?.remove();
  resultEl.classList.remove("result-has-formatted", "error");
  resultEl.innerHTML = "<em>Click a data button or place an order to see response.</em>";
});

checkAuth();
