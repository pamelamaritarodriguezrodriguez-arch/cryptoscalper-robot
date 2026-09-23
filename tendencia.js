// ═══════════════════════════════════════════════════════════════
//  BACKTEST · SEGUIMIENTO DE TENDENCIA DIARIO (tipo "Tortugas")
//  La familia de estrategias con más evidencia histórica: comprar la
//  ruptura de máximos de N días y salir cuando rompe el mínimo de M días.
//  Simula una CARTERA real: 1% de riesgo por operación, sin apalancamiento,
//  comisiones y deslizamiento incluidos. Compara contra "solo comprar BTC".
//  Datos reales de Binance. No opera, no toca nada: solo informa.
// ═══════════════════════════════════════════════════════════════
const YEARS = Math.max(1, Math.min(8, +(process.env.YEARS || 4)));
const FEE = 0.001, SLIP = 0.0005;      // 0.1% comisión + 0.05% deslizamiento por lado
const RISK = 0.01, MAXPOS = 0.25;      // 1% del capital en riesgo por operación · máx 25% en una moneda
const DAY = 864e5, sleep = ms => new Promise(r => setTimeout(r, ms));
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

const STRATS = [
  { name: "Ruptura 20d · salida 10d", entryN: 20, exitN: 10, btcFilter: false },
  { name: "Ruptura 55d · salida 20d", entryN: 55, exitN: 20, btcFilter: false },
  { name: "Ruptura 20d · salida 10d · solo si BTC sobre EMA200", entryN: 20, exitN: 10, btcFilter: true },
  { name: "Ruptura 55d · salida 20d · solo si BTC sobre EMA200", entryN: 55, exitN: 20, btcFilter: true },
];

async function daily(sym, start, end) {
  const out = []; let st = start;
  while (st < end) {
    let arr = null;
    for (let t = 0; t < 3 && !arr; t++) {
      for (const h of HOSTS) {
        try { const r = await fetch(`${h}/api/v3/klines?symbol=${sym}&interval=1d&startTime=${st}&endTime=${end}&limit=1000`); if (r.ok) { arr = await r.json(); break; } } catch { }
      }
      if (!arr) await sleep(1500);
    }
    if (!arr || !arr.length) break;
    for (const k of arr) if (+k[0] + DAY <= end) out.push({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }); // solo velas CERRADAS
    st = +arr[arr.length - 1][0] + 1;
    if (arr.length < 1000) break;
    await sleep(100);
  }
  return out;
}
const emaArr = (v, k) => { const m = 2 / (k + 1), e = [v[0]]; for (let i = 1; i < v.length; i++) e.push(v[i] * m + e[i - 1] * (1 - m)); return e; };
function prep(b) {                              // indicadores por moneda (solo pasado, sin mirar el futuro)
  const n = b.length, atr = new Array(n).fill(null), hh = {}, ll = {};
  let a = null;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    a = a == null ? tr : (a * 19 + tr) / 20; if (i >= 20) atr[i] = a;
  }
  for (const N of [10, 20, 55]) {
    hh[N] = new Array(n).fill(null); ll[N] = new Array(n).fill(null);
    for (let i = N; i < n; i++) {
      let mx = -Infinity, mn = Infinity;
      for (let j = i - N; j < i; j++) mx = Math.max(mx, b[j].h);          // máximo de los N días ANTERIORES
      for (let j = i - N + 1; j <= i; j++) mn = Math.min(mn, b[j].l);      // mínimo de los N días hasta HOY
      hh[N][i] = mx; ll[N][i] = mn;
    }
  }
  return { atr, hh, ll };
}

function run(S, ctx) {
  const { dates, syms, bar, ind, btcOk, d0 } = ctx;
  let cash = 1, eqPrev = 1, pos = {}, pending = [], trades = [], curve = [], invested = 0;
  const lastC = {};
  for (let d = d0; d < dates.length; d++) {
    // 1) entradas pendientes: se ejecutan a la APERTURA del día siguiente a la señal
    for (const p of pending) {
      const b = bar(p.sym, d); if (!b || pos[p.sym]) continue;
      const entry = b.o * (1 + SLIP), stop = entry - 2 * p.atr;
      if (!(stop > 0 && stop < entry)) continue;
      let notional = Math.min(RISK * eqPrev / (entry - stop) * entry, MAXPOS * eqPrev, cash / (1 + FEE));
      if (notional < eqPrev * 0.005) continue;                          // sin dinero libre suficiente
      cash -= notional * (1 + FEE);
      pos[p.sym] = { qty: notional / entry, entry, stop, cost: notional * (1 + FEE), openD: d };
    }
    pending = [];
    // 2) salidas: stop inicial o mínimo de M días (si abre por debajo, sale a la apertura)
    for (const s of Object.keys(pos)) {
      const P = pos[s], b = bar(s, d); if (!b) continue;
      let px = null;
      if (b.o <= P.stop) px = b.o; else if (b.l <= P.stop) px = P.stop;
      if (px != null) {
        const proceeds = P.qty * px * (1 - SLIP) * (1 - FEE);
        cash += proceeds; trades.push({ sym: s, ret: proceeds / P.cost - 1, openD: P.openD, closeD: d }); delete pos[s]; continue;
      }
      const i = ind[s].idx(d), ex = ind[s].ll[S.exitN][i];
      if (ex != null) P.stop = Math.max(P.stop, ex);                     // el stop solo sube, nunca baja
    }
    // 3) valor de la cartera al cierre
    let inv = 0;
    for (const s of Object.keys(pos)) { const b = bar(s, d); if (b) lastC[s] = b.c; inv += pos[s].qty * (lastC[s] ?? pos[s].entry); }
    const eq = cash + inv; curve.push(eq); invested += eq > 0 ? inv / eq : 0; eqPrev = eq;
    // 4) señales al cierre → se ejecutan mañana
    if (S.btcFilter && !btcOk(d)) continue;
    for (const s of syms) {
      if (pos[s]) continue;
      const b = bar(s, d); if (!b) continue;
      const i = ind[s].idx(d), hh = ind[s].hh[S.entryN][i], at = ind[s].atr[i];
      if (hh != null && at != null && b.c > hh) pending.push({ sym: s, atr: at, mom: b.c / hh });
    }
    pending.sort((a, b) => b.mom - a.mom);
  }
  return { curve, trades, openN: Object.keys(pos).length, exposure: invested / curve.length };
}
function metrics(curve, trades, nDays) {
  const end = curve[curve.length - 1], mid = curve[Math.floor(curve.length / 2)];
  let pk = -Infinity, dd = 0; for (const v of curve) { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); }
  const w = trades.filter(t => t.ret > 0), l = trades.filter(t => t.ret <= 0);
  const gp = w.reduce((a, t) => a + t.ret, 0), gl = -l.reduce((a, t) => a + t.ret, 0);
  const cagr = Math.pow(Math.max(end, 1e-9), 365 / nDays) - 1;
  return { total: end - 1, cagr, dd, h1: mid / curve[0] - 1, h2: end / mid - 1, n: trades.length, wr: trades.length ? w.length / trades.length : 0, pf: gl > 0 ? gp / gl : (gp > 0 ? 99 : 0), avgW: w.length ? gp / w.length : 0, avgL: l.length ? -gl / l.length : 0 };
}
const pc = (x, d = 0) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

(async () => {
  const SYMS = (process.env.SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,AVAXUSDT,LINKUSDT,SUIUSDT")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean).map(s => s.endsWith("USDT") ? s : s + "USDT");
  const all = [...new Set(["BTCUSDT", ...SYMS])];
  const END = Math.floor(Date.now() / DAY) * DAY, START = END - YEARS * 365 * DAY;
  console.log(`📈 Backtest de tendencia · ${YEARS} años · ${SYMS.length} pares`);
  const data = {};
  for (const s of all) { data[s] = await daily(s, START - 260 * DAY, END); console.log(`📥 ${s}: ${data[s].length} días`); }
  if (data.BTCUSDT.length < 300) { console.log("❌ Sin datos suficientes de BTC"); return; }

  const dates = data.BTCUSDT.map(b => b.t);
  const d0 = dates.findIndex(t => t >= START);
  const ind = {}, maps = {};
  for (const s of all) {
    const b = data[s], m = new Map(b.map((x, i) => [x.t, i]));
    maps[s] = m; ind[s] = { ...prep(b), idx: d => m.get(dates[d]) };
  }
  const bar = (s, d) => { const i = maps[s].get(dates[d]); return i == null ? null : data[s][i]; };
  const btcE = emaArr(data.BTCUSDT.map(b => b.c), 200);
  const btcOk = d => d >= 200 && data.BTCUSDT[d].c > btcE[d];
  const syms = SYMS.filter(s => data[s] && data[s].length > 60);
  const ctx = { dates, syms, bar, ind, btcOk, d0 };
  const nDays = dates.length - d0;

  // referencia: solo comprar BTC y aguantar
  const bc = data.BTCUSDT.slice(d0).map(b => b.c / data.BTCUSDT[d0].c);
  const B = metrics(bc, [], nDays);

  const from = new Date(dates[d0]).toISOString().slice(0, 10), to = new Date(dates[dates.length - 1]).toISOString().slice(0, 10);
  let msg = `📈 <b>BACKTEST TENDENCIA DIARIA</b>\n📅 ${from} → ${to} · ${syms.length} pares\n💼 Cartera: 1% de riesgo por op · sin apalancamiento · comisión+desliz. incluidos\n`;
  msg += `\n<b>Referencia: comprar BTC y aguantar</b>\n   total ${pc(B.total)} · anual ${pc(B.cagr)} · caída máx ${pc(B.dd)}\n   1ª mitad ${pc(B.h1)} · 2ª ${pc(B.h2)}\n`;
  const res = [];
  for (const S of STRATS) {
    const r = run(S, ctx), M = metrics(r.curve, r.trades, nDays); res.push({ S, M, r });
    const perMonth = 1000 * (Math.pow(1 + M.cagr, 1 / 12) - 1);
    msg += `\n<b>${S.name}</b>\n   total ${pc(M.total)} · anual ${pc(M.cagr)} · caída máx ${pc(M.dd)}\n`;
    msg += `   ${M.n} ops · acierto ${pc(M.wr).replace("+", "")} · gana media ${pc(M.avgW, 1)} / pierde ${pc(M.avgL, 1)} · PF ${M.pf.toFixed(2)}\n`;
    msg += `   1ª mitad ${pc(M.h1)} · 2ª ${pc(M.h2)} · invertido ${Math.round(r.exposure * 100)}% del tiempo\n`;
    msg += `   ≈ ${perMonth >= 0 ? "+" : ""}${perMonth.toFixed(0)} USD/mes de media por cada 1.000 USD\n`;
  }
  const good = res.filter(x => x.M.n >= 30 && x.M.h1 > 0 && x.M.h2 > 0 && x.M.pf > 1.3).sort((a, b) => (b.M.cagr / -Math.min(b.M.dd, -0.01)) - (a.M.cagr / -Math.min(a.M.dd, -0.01)));
  msg += "\n";
  if (good.length) msg += `🏆 <b>Pasa la prueba:</b> ${good[0].S.name}\n(≥30 ops, ganó en AMBAS mitades, PF mayor a 1.3)\n`;
  else msg += `⚠️ <b>Ninguna pasa la prueba</b> (≥30 ops, ganar en ambas mitades, PF mayor a 1.3).\n`;
  msg += `\nℹ️ Solo incluye monedas que existen HOY (las que murieron no están), lo que infla algo los resultados. Pasado ≠ futuro.`;
  console.log("\n" + msg.replace(/<\/?b>/g, ""));
  for (const { S, r } of res) { console.log(`\n── ${S.name} ──`); for (const t of r.trades) console.log(`${new Date(dates[t.openD]).toISOString().slice(0, 10)} → ${new Date(dates[t.closeD]).toISOString().slice(0, 10)} ${t.sym} ${pc(t.ret, 1)}`); }
  if (process.env.BOT_TOKEN && process.env.CHAT_ID) {
    try { await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: process.env.CHAT_ID, text: msg, parse_mode: "HTML" }) }); } catch (e) { console.log("Telegram falló:", e.message); }
  }
})();
