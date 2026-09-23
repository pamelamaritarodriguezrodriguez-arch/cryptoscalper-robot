// ═══════════════════════════════════════════════════════════════
//  ROBOT TENDENCIA 55/20 — la estrategia que pasó el backtest de 4 y 8 años
//  Una vez al día, tras el cierre de la vela diaria (00:00 UTC):
//   · COMPRAR cuando el cierre rompe el máximo de los 55 días anteriores
//   · Stop inicial = entrada − 2×ATR(20) · el stop SOLO sube: mínimo de 20 días
//   · Tamaño: arriesgar 1% del capital por operación · máx 25% en una moneda
//   · Spot, sin apalancamiento. Mismas reglas exactas que tendencia.js
//  Lleva una CARTERA VIRTUAL para la fase de prueba sin dinero.
// ═══════════════════════════════════════════════════════════════
const fs = require("fs");
const FEE = 0.001, SLIP = 0.0005, RISK = 0.01, MAXPOS = 0.25;
const ENTRY_N = 55, EXIT_N = 20, DAY = 864e5;
const STATE_FILE = __dirname + "/tendencia_state.json";
const FP = n => { if (n == null || isNaN(n)) return "—"; const a = Math.abs(n); const d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : a >= 0.001 ? 6 : 8; return Number(n).toFixed(d); };
const pc = (x, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
const usd = x => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2) + " USD";
const day = t => new Date(t).toISOString().slice(0, 10);

// ── Indicadores (idénticos al backtest) ──
function prep(b) {
  const n = b.length, atr = new Array(n).fill(null), hh = new Array(n).fill(null), ll = new Array(n).fill(null);
  let a = null;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    a = a == null ? tr : (a * 19 + tr) / 20; if (i >= 20) atr[i] = a;
  }
  for (let i = ENTRY_N; i < n; i++) { let mx = -Infinity; for (let j = i - ENTRY_N; j < i; j++) mx = Math.max(mx, b[j].h); hh[i] = mx; }
  for (let i = EXIT_N; i < n; i++) { let mn = Infinity; for (let j = i - EXIT_N + 1; j <= i; j++) mn = Math.min(mn, b[j].l); ll[i] = mn; }
  return { atr, hh, ll };
}

// ── Un día de la estrategia. ctx: { dates, syms, bar(s,D), ind[s], idx(s,D), nextOpen(s,D) } ──
function processDay(st, D, ctx, actionable) {
  const ev = [];
  // 1) salidas del día D (el stop está puesto en el exchange: salta solo durante el día)
  for (const s of Object.keys(st.pos)) {
    const P = st.pos[s], b = ctx.bar(s, D); if (!b) continue;
    let px = null;
    if (b.o <= P.stop) px = b.o; else if (b.l <= P.stop) px = P.stop;
    if (px != null) {
      const proceeds = P.qty * px * (1 - SLIP) * (1 - FEE);
      st.cash += proceeds;
      const t = { sym: s, openT: P.openT, closeT: ctx.dates[D], entry: P.entry, exit: px, ret: proceeds / P.cost - 1, pnl: proceeds - P.cost };
      st.log.push(t); delete st.pos[s]; ev.push({ type: "exit", ...t });
      continue;
    }
    const ex = ctx.ind[s].ll[ctx.idx(s, D)];
    if (ex != null && ex > P.stop) { ev.push({ type: "stop", sym: s, from: P.stop, to: ex }); P.stop = ex; }
  }
  // 2) valor de la cartera al cierre de D
  let inv = 0;
  for (const s of Object.keys(st.pos)) { const b = ctx.bar(s, D); if (b) st.lastC[s] = b.c; inv += st.pos[s].qty * (st.lastC[s] ?? st.pos[s].entry); }
  st.eq = st.cash + inv;
  // 3) señales al cierre de D
  const cands = [];
  for (const s of ctx.syms) {
    if (st.pos[s]) continue;
    const b = ctx.bar(s, D); if (!b) continue;
    const i = ctx.idx(s, D), hh = ctx.ind[s].hh[i], at = ctx.ind[s].atr[i];
    if (hh != null && at != null && b.c > hh) cands.push({ sym: s, atr: at, mom: b.c / hh, hh });
  }
  cands.sort((a, b) => b.mom - a.mom);
  // 4) se compran a la apertura del día siguiente (= ahora, en vivo)
  if (actionable) for (const c of cands) {
    const o = ctx.nextOpen(c.sym, D); if (o == null) continue;
    const entry = o * (1 + SLIP), stop = entry - 2 * c.atr;
    if (!(stop > 0 && stop < entry)) continue;
    const notional = Math.min(RISK * st.eq / (entry - stop) * entry, MAXPOS * st.eq, st.cash / (1 + FEE));
    if (notional < st.eq * 0.005) { ev.push({ type: "nocash", sym: c.sym }); continue; }
    st.cash -= notional * (1 + FEE);
    st.pos[c.sym] = { qty: notional / entry, entry, stop, cost: notional * (1 + FEE), openT: ctx.dates[D] + DAY };
    ev.push({ type: "entry", sym: c.sym, entry, stop, notional, riskUsd: (entry - stop) / entry * notional, hh: c.hh });
  }
  st.lastDay = ctx.dates[D];
  return ev;
}

function stats(log) {
  if (!log.length) return null;
  const w = log.filter(t => t.ret > 0), gp = w.reduce((a, t) => a + t.pnl, 0), gl = -log.filter(t => t.ret <= 0).reduce((a, t) => a + t.pnl, 0);
  return { n: log.length, wr: Math.round(w.length / log.length * 100), pf: gl > 0 ? gp / gl : (gp > 0 ? 99 : 0) };
}

// ── Servidor: datos de Binance, Telegram, estado ──
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
async function kl(sym) {
  for (let t = 0; t < 3; t++) for (const h of HOSTS) {
    try { const r = await fetch(`${h}/api/v3/klines?symbol=${sym}&interval=1d&limit=150`); if (r.ok) return (await r.json()).map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] })); } catch { }
  }
  return null;
}
async function tg(text) {
  const B = process.env.BOT_TOKEN, C = process.env.CHAT_ID;
  if (!B || !C) { console.log("[sin Telegram]\n" + text); return; }
  try { await fetch(`https://api.telegram.org/bot${B}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: C, text, parse_mode: "HTML", disable_web_page_preview: true }) }); } catch (e) { console.log("Telegram falló:", e.message); }
}

async function main() {
  const CAPITAL = Math.max(10, +(process.env.CAPITAL || 1000));
  const SYMS = (process.env.SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,AVAXUSDT,LINKUSDT,SUIUSDT")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean).map(s => s.endsWith("USDT") ? s : s + "USDT");
  let st = null; try { st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { }
  const nuevo = !st;
  if (!st) st = { start: Date.now(), capital0: CAPITAL, cash: CAPITAL, eq: CAPITAL, pos: {}, lastC: {}, log: [], lastDay: 0 };

  const now = Date.now(), data = {}, idxMap = {};
  const all = [...new Set(["BTCUSDT", ...SYMS, ...Object.keys(st.pos)])];
  for (const s of all) { const k = await kl(s); if (k && k.length > 60) { data[s] = k; idxMap[s] = new Map(k.map((x, i) => [x.t, i])); } else console.log("⚠️ sin datos:", s); }
  if (!data.BTCUSDT) { console.log("❌ Sin datos de BTC"); return; }
  const dates = data.BTCUSDT.filter(b => b.t + DAY <= now).map(b => b.t);      // solo días CERRADOS
  const ind = {}; for (const s in data) ind[s] = prep(data[s]);
  const ctx = {
    dates, syms: SYMS.filter(s => data[s]), ind,
    idx: (s, D) => idxMap[s]?.get(dates[D]),
    bar: (s, D) => { const i = idxMap[s]?.get(dates[D]); return i == null ? null : data[s][i]; },
    nextOpen: (s, D) => { const i = idxMap[s]?.get(dates[D] + DAY); return i == null ? null : data[s][i].o; },
  };
  const last = dates.length - 1;
  if (st.lastDay >= dates[last] && process.env.FORCE !== "1") { console.log("✔ Día", day(dates[last]), "ya procesado. Nada que hacer."); return; }
  // días pendientes (normalmente 1). Solo se opera la señal del ÚLTIMO día: las viejas ya no son accionables.
  let first = st.lastDay ? dates.findIndex(t => t > st.lastDay) : last;
  if (first < 0) first = last;
  const events = [];
  for (let D = first; D <= last; D++) events.push(...processDay(st, D, ctx, D === last));
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1));

  // ── Mensajes ──
  const eq0 = st.capital0;
  for (const e of events) {
    const L = e.sym.replace("USDT", "/USDT");
    if (e.type === "entry") await tg(`🟢 <b>COMPRAR ${L}</b> — tendencia 55 días\n\n📈 El cierre rompió el máximo de 55 días (${FP(e.hh)})\n💰 Entrada ≈ <code>${FP(e.entry)}</code> (precio actual)\n🛑 Stop inicial: <code>${FP(e.stop)}</code> (${pc(e.stop / e.entry - 1)})\n📦 Compra por <b>${usd(e.notional)}</b> (${(e.notional / st.eq * 100).toFixed(0)}% de tu capital de ${usd(st.eq)})\n⚖️ Si salta el stop pierdes ≈ ${usd(e.riskUsd)} (1%)\n\n👉 Pon la orden STOP en Binance nada más comprar.\nNo hay objetivo fijo: se sale cuando el precio rompe el mínimo de 20 días. Te avisaré cada vez que debas subir el stop.`);
    if (e.type === "stop") await tg(`🔼 <b>Sube el stop de ${L}</b>\n<code>${FP(e.from)}</code> → <code>${FP(e.to)}</code>\n(nuevo mínimo de 20 días · el stop nunca baja)`);
    if (e.type === "exit") await tg(`${e.ret > 0 ? "✅" : "🔴"} <b>SALIÓ ${L}</b> — tocó el stop\nEntrada <code>${FP(e.entry)}</code> → salida <code>${FP(e.exit)}</code>\nResultado: <b>${pc(e.ret)}</b> (${e.pnl >= 0 ? "+" : ""}${usd(e.pnl)}, comisiones incluidas)`);
    if (e.type === "nocash") await tg(`ℹ️ ${L} dio señal, pero no queda capital libre en la cartera. Se omite (igual que en el backtest).`);
  }
  const s = stats(st.log), abiertas = Object.entries(st.pos);
  let msg = `${nuevo ? "🚀 <b>Robot Tendencia 55/20 en marcha</b> (fase de prueba, cartera virtual)\n\n" : ""}📊 <b>Resumen diario</b> · cierre ${day(dates[last])}\n💼 Capital virtual: <b>${usd(st.eq)}</b> (${pc(st.eq / eq0 - 1)} desde el inicio)\n`;
  msg += abiertas.length ? `\n📂 Posiciones abiertas (${abiertas.length}):\n` + abiertas.map(([k, P]) => { const c = st.lastC[k] ?? P.entry; return `· ${k.replace("USDT", "")}: entrada ${FP(P.entry)} · ahora ${FP(c)} (${pc(c / P.entry - 1)}) · stop ${FP(P.stop)}`; }).join("\n") + "\n" : "\n📂 Sin posiciones abiertas.\n";
  if (!events.some(e => e.type === "entry")) msg += "\n⏳ Hoy ninguna moneda rompió su máximo de 55 días.\n";
  if (s) msg += `\n📒 Registro: ${s.n} ops · acierto ${s.wr}% · PF ${s.pf.toFixed(2)}`;
  msg += `\n\nℹ️ Esta estrategia pierde en ~2 de cada 3 operaciones y gana porque las ganadoras son mucho más grandes. Las rachas de pérdidas pequeñas son normales.`;
  await tg(msg);
  console.log(`✔ Procesado ${day(dates[last])} · eventos: ${events.length} · capital ${st.eq.toFixed(2)}`);
}

if (require.main === module) main();
module.exports = { prep, processDay, stats, main };
