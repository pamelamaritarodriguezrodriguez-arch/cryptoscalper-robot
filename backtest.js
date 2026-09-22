// ═══════════════════════════════════════════════════════════════
//  BACKTEST con datos REALES de Binance — usa TU robot.js tal cual
//  Corre en GitHub Actions (workflow "Backtest", manual).
//  NO toca state.json ni abre operaciones. Envía el informe a Telegram.
// ═══════════════════════════════════════════════════════════════
const fs = require("fs");
const DAYS = Math.max(14, Math.min(365, +(process.env.DAYS || 90)));
const FEE = 0.2;                       // % comisión ida+vuelta por operación (spot taker)
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 1) Cargar el robot real y convertir sus umbrales en perillas ──
let src = fs.readFileSync(__dirname + "/robot.js", "utf8");
const KNOBS = [
  ["const ADX_MIN=20;", "const ADX_MIN=CFG.adxMin;"],
  ["!S.relax&&!h4.adxRising&&h4.adx<26", "!S.relax&&!h4.adxRising&&h4.adx<CFG.adxFall"],
  ["!S.relax&&quality<5)", "!S.relax&&quality<CFG.qMin)"],
  ["if(riskPct>3.5)", "if(riskPct>CFG.riskMax)"],
  ["!S.relax&&room<risk*2", "!S.relax&&room<risk*CFG.room"],
  ["(S.relax?0.8:1.5)", "(S.relax?0.8:CFG.rrMin)"],
  ["tfs[tf]=analyzeEntry(d.map(k=>k.c),d.map(k=>k.h),d.map(k=>k.l),d.map(k=>k.v));", "tfs[tf]=__AE(d);"],
];
const missing = [];
for (const [a, b] of KNOBS) { if (src.includes(a)) src = src.split(a).join(b); else missing.push(a.slice(0, 40)); }
src = src.replace(/\bmain\(\);\s*$/, "");
src += "\n;globalThis.RB={checkLayers,analyzeEntry,btcGuide,S,tg,F};";
globalThis.CFG = {};
const AEcache = new WeakMap();   // cada ventana de velas se analiza UNA vez aunque la usen varias configs
globalThis.__AE = d => { let r = AEcache.get(d); if (r === undefined) { r = RB.analyzeEntry(d.map(k => k.c), d.map(k => k.h), d.map(k => k.l), d.map(k => k.v)); AEcache.set(d, r); } return r; };
(function () { eval(src); })();

// ── 2) Configuraciones a comparar ──
const BASE = { relax: false, adxMin: 20, adxFall: 26, qMin: 5, riskMax: 3.5, room: 2, rrMin: 1.5 };
const CONFIGS = [
  { name: "Actual (confluencia ≥5)", ...BASE },
  { name: "Confluencia ≥4", ...BASE, qMin: 4 },
  { name: "Confluencia ≥3", ...BASE, qMin: 3 },
  { name: "ADX flexible + conf ≥4", ...BASE, qMin: 4, adxMin: 18, adxFall: 20 },
  { name: "Original sin filtros extra", ...BASE, relax: true },
];

// ── 3) Datos históricos de Binance (paginados) ──
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const TFMS = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
async function hist(sym, tf, start, end) {
  const out = []; let st = start;
  while (st < end) {
    let arr = null;
    for (let tries = 0; tries < 3 && !arr; tries++) {
      for (const h of HOSTS) {
        try {
          const r = await fetch(`${h}/api/v3/klines?symbol=${sym}&interval=${tf}&startTime=${st}&endTime=${end}&limit=1000`);
          if (r.ok) { arr = await r.json(); break; }
        } catch { }
      }
      if (!arr) await sleep(1500);
    }
    if (!arr || !arr.length) break;
    for (const k of arr) out.push({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] });
    st = +arr[arr.length - 1][0] + 1;
    if (arr.length < 1000) break;
    await sleep(100);
  }
  return out;
}

// ── 4) Simulación de una posición con la gestión REAL del robot ──
function realize(p, frac, px) { p.pnl += frac * (p.dir === "LONG" ? (px - p.entry) : (p.entry - px)) / p.entry * 100; p.rem -= frac; }
function closePos(p, px, reason, T) { realize(p, p.rem, px); p.pnl -= FEE; p.reason = reason; p.closeT = T; }
// avanza la posición por las velas de 5m cerradas hasta T. Devuelve true si se cerró.
function advance(p, b5, T) {
  const L = p.dir === "LONG";
  for (; p.i < b5.length && b5[p.i].t + 3e5 <= T; p.i++) {
    const k = b5[p.i];
    if (L ? k.l <= p.sl : k.h >= p.sl) { closePos(p, p.sl, p.be ? "Breakeven" : "Stop", k.t); return true; } // stop primero (conservador)
    const hit = x => L ? k.h >= x : k.l <= x;
    if (!p.tp1Done && hit(p.tp1)) { realize(p, 1 / 3, p.tp1); p.tp1Done = 1; p.sl = p.entry; p.be = 1; }
    if (p.tp1Done && !p.tp2Done && hit(p.tp2)) { realize(p, 1 / 3, p.tp2); p.tp2Done = 1; p.sl = p.tp1; }
    if (p.tp2Done && hit(p.tp3)) { closePos(p, p.tp3, "TP3", k.t); return true; }
  }
  return false;
}

// ── 5) Estadísticas ──
function stats(tr, mid) {
  const n = tr.length; if (!n) return null;
  const w = tr.filter(t => t.pnl > 0).length, sum = tr.reduce((a, t) => a + t.pnl, 0);
  const gp = tr.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0), gl = -tr.filter(t => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  let eq = 0, pk = 0, dd = 0; for (const t of [...tr].sort((a, b) => a.closeT - b.closeT)) { eq += t.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  const h1 = tr.filter(t => t.openT < mid).reduce((a, t) => a + t.pnl, 0), h2 = sum - h1;
  const avgR = tr.reduce((a, t) => a + t.pnl / t.riskPct, 0) / n;
  return { n, wr: Math.round(w / n * 100), avg: sum / n, sum, pf: gl > 0 ? gp / gl : (gp > 0 ? 99 : 0), dd, h1, h2, avgR, perWeek: n / (DAYS / 7) };
}
const f = (x, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d);

// ── 6) Programa principal ──
(async () => {
  const SYMS = (process.env.SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,AVAXUSDT,LINKUSDT,SUIUSDT")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean).map(s => s.endsWith("USDT") ? s : s + "USDT");
  const all = [...new Set(["BTCUSDT", ...SYMS])];
  const END = Math.floor(Date.now() / 36e5) * 36e5, START = END - DAYS * 864e5, MID = START + DAYS * 432e5;
  console.log(`🧪 Backtest ${DAYS} días · ${SYMS.length} pares · ${CONFIGS.length} configuraciones`);
  if (missing.length) console.log("⚠️ Perillas no encontradas en robot.js (se usa el valor fijo):", missing);

  const data = {}, skipped = [];
  for (const s of all) {
    data[s] = {};
    for (const tf of Object.keys(TFMS)) data[s][tf] = await hist(s, tf, START - 101 * TFMS[tf], END);
    const ok = data[s]["4h"].length > 150 && data[s]["5m"].length > 1000;
    console.log(`📥 ${s}: 5m=${data[s]["5m"].length} 1h=${data[s]["1h"].length} 4h=${data[s]["4h"].length} 1d=${data[s]["1d"].length}${ok ? "" : " ⚠️ datos insuficientes"}`);
    if (!ok) skipped.push(s);
  }
  const trade = SYMS.filter(s => !skipped.includes(s));
  if (!data.BTCUSDT || skipped.includes("BTCUSDT")) { console.log("❌ Sin datos de BTC — abortado"); return; }

  // ventanas: se reutiliza el MISMO array mientras no cierre una vela nueva (así el análisis se cachea)
  const ptr = {}, win = {};
  for (const s of all) { ptr[s] = {}; win[s] = {}; for (const tf in TFMS) ptr[s][tf] = 0; }
  const W = (s, tf, T) => {
    const a = data[s][tf], ms = TFMS[tf];
    while (ptr[s][tf] < a.length && a[ptr[s][tf]].t + ms <= T) ptr[s][tf]++;
    const p = ptr[s][tf], c = win[s][tf];
    if (c && c.p === p) return c.arr;
    const arr = a.slice(Math.max(0, p - 100), p); win[s][tf] = { p, arr }; return arr;
  };

  const pos = CONFIGS.map(() => ({})), cool = CONFIGS.map(() => ({})), trades = CONFIGS.map(() => []);
  let steps = 0;
  for (let T = START + 36e5; T <= END; T += 36e5) {
    steps++; if (steps % 240 === 0) console.log(`… ${Math.round(steps / (DAYS * 24) * 100)}%`);
    let btc; const getBTC = () => btc || (btc = RB.btcGuide({ "5m": W("BTCUSDT", "5m", T), "15m": W("BTCUSDT", "15m", T), "1h": W("BTCUSDT", "1h", T), "4h": W("BTCUSDT", "4h", T), "1d": W("BTCUSDT", "1d", T) }));
    for (const s of trade) {
      const w4 = W(s, "4h", T); if (w4.length < 60) continue;
      const a4 = __AE(w4);
      const b5 = data[s]["5m"];
      // gestionar posiciones abiertas
      for (let ci = 0; ci < CONFIGS.length; ci++) {
        const p = pos[ci][s]; if (!p) continue;
        let closed = advance(p, b5, T);
        if (!closed && a4 && (p.dir === "LONG" ? (a4.signal === "SHORT" || a4.trend === "BAJ") : (a4.signal === "LONG" || a4.trend === "ALC"))) { closePos(p, a4.last, "Patrón contrario 4H", T); closed = true; }
        if (closed) { trades[ci].push(p); delete pos[ci][s]; cool[ci][s] = T; }
      }
      if (!a4 || !a4.signal) continue;                 // sin pullback 4H no hay entrada en ninguna config
      const raw = { "5m": W(s, "5m", T), "15m": W(s, "15m", T), "1h": W(s, "1h", T), "4h": w4, "1d": W(s, "1d", T) };
      raw["1m"] = raw["5m"];                          // aproximación: 1m histórico sería demasiado pesado
      for (let ci = 0; ci < CONFIGS.length; ci++) {
        if (pos[ci][s] || (cool[ci][s] && T - cool[ci][s] < 4 * 36e5)) continue;
        Object.assign(CFG, CONFIGS[ci]); RB.S.relax = CONFIGS[ci].relax;
        const res = RB.checkLayers(raw, s.replace("USDT", "/USDT"), s, getBTC());
        const e = res.signal; if (!e) continue;
        const i0 = b5.findIndex(k => k.t >= T);
        if (i0 < 0) continue;
        pos[ci][s] = { sym: s, dir: e.type, entry: e.entry, sl: e.sl, tp1: e.tp1, tp2: e.tp2, tp3: e.tp3, riskPct: Math.abs(e.entry - e.sl) / e.entry * 100, i: i0, pnl: 0, rem: 1, openT: T };
      }
    }
  }
  const open = pos.map(o => Object.keys(o).length);

  // ── 7) Informe ──
  const rows = CONFIGS.map((c, i) => ({ c, st: stats(trades[i], MID), open: open[i], tr: trades[i] }));
  let msg = `🧪 <b>BACKTEST — datos reales Binance</b>\n📅 ${DAYS} días · ${trade.length} pares · comisión ${FEE}%/op\n📐 Gestión real: 1/3 en TP1 (SL→BE), 1/3 en TP2, resto TP3/stop/giro 4H\n`;
  for (const { c, st, open } of rows) {
    msg += `\n<b>${c.name}</b>\n`;
    if (!st) { msg += `   sin operaciones${open ? ` (${open} abiertas)` : ""}\n`; continue; }
    msg += `   ${st.n} ops · ${st.perWeek.toFixed(1)}/semana · acierto ${st.wr}%\n`;
    msg += `   media ${f(st.avg, 2)}%/op · total ${f(st.sum)}% · PF ${st.pf.toFixed(2)}\n`;
    msg += `   caída máx ${st.dd.toFixed(1)}% · 1ª mitad ${f(st.h1)}% · 2ª ${f(st.h2)}%\n`;
  }
  const valid = rows.filter(r => r.st && r.st.n >= 15 && r.st.h1 > 0 && r.st.h2 > 0 && r.st.pf > 1.2);
  valid.sort((a, b) => b.st.sum - a.st.sum);
  msg += "\n";
  if (valid.length) msg += `🏆 <b>Mejor con evidencia:</b> ${valid[0].c.name}\n(≥15 ops, ganó en AMBAS mitades, PF mayor a 1.2)\n`;
  else msg += `⚠️ <b>Ninguna configuración demuestra ventaja consistente</b> en este periodo (se exige ≥15 ops, ganar en ambas mitades y PF mayor a 1.2).\n`;
  msg += `\nℹ️ Pasado ≠ futuro. Con pocas ops el resultado es ruido.\n⏰ ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  console.log("\n" + msg.replace(/<\/?b>/g, ""));
  // detalle de operaciones en el log
  for (const { c, tr } of rows) { console.log(`\n── ${c.name} ──`); for (const t of tr) console.log(`${new Date(t.openT).toISOString().slice(0, 13)} ${t.sym} ${t.dir} entrada ${t.entry} → ${t.reason} ${f(t.pnl, 2)}%`); }
  if (process.env.BOT_TOKEN && process.env.CHAT_ID) await RB.tg(msg);
})();
