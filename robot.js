// ════════════════════════════════════════════════════════════
//  CryptoScalper ROBOT — vigila el mercado 24/7 en GitHub Actions
//  Usa EXACTAMENTE la misma estrategia que tu app (v12):
//  BTC guía + ADX≥23 con pendiente + zona EMA55 estricta +
//  barrido/order block + confluencia multi-TF (TradingLatino)
// ════════════════════════════════════════════════════════════
const fs = require('fs');
const F   = (n,d=2)=>n==null?"—":Number(n).toFixed(d);
// Formato de precio según magnitud (para monedas baratas como DOGE/PEPE)
const FP  = n=>{ if(n==null||isNaN(n))return "—"; const a=Math.abs(n);
  const d = a>=1000?2 : a>=1?3 : a>=0.1?4 : a>=0.01?5 : a>=0.001?6 : 8;
  return Number(n).toFixed(d); };
const Pct = (a,b)=>b===0?0:((a-b)/b)*100;
const T   = ()=>new Date().toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
const TD  = ()=>new Date().toLocaleDateString("es",{day:"2-digit",month:"short"})+" "+T();
const ALL = ["1m","5m","15m","1h","4h","1d"];
const S   = { strict: process.env.STRICT === "1" };   // modo estricto vía variable

// ═══ INDICADORES (idénticos a la app) ═══
function _e(p,k){if(!p.length)return[];const m=2/(k+1);let e=[p[0]];for(let i=1;i<p.length;i++)e.push(p[i]*m+e[i-1]*(1-m));return e;}
function _r(p,k=14){if(p.length<k+1)return p.map(()=>50);let r=Array(k).fill(50),g=0,l=0;for(let i=1;i<=k;i++){const d=p[i]-p[i-1];d>0?g+=d:l-=d;}let ag=g/k,al=l/k;for(let i=k;i<p.length;i++){if(i>k){const d=p[i]-p[i-1];ag=(ag*(k-1)+(d>0?d:0))/k;al=(al*(k-1)+(d<0?-d:0))/k;}r.push(al===0?100:100-100/(1+ag/al));}return r;}
function _a(h,l,c,k=14){const n=c.length;let a=Array(n).fill(15);if(n<k*2+1)return a;let tr=[],pd=[],nd=[];for(let i=1;i<n;i++){const hd=h[i]-h[i-1],ld=l[i-1]-l[i];pd.push(hd>ld&&hd>0?hd:0);nd.push(ld>hd&&ld>0?ld:0);tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));}let at=tr.slice(0,k).reduce((a,b)=>a+b,0)/k,sp=pd.slice(0,k).reduce((a,b)=>a+b,0)/k,sn=nd.slice(0,k).reduce((a,b)=>a+b,0)/k;let dx=[];for(let i=k;i<tr.length;i++){at=(at*(k-1)+tr[i])/k;sp=(sp*(k-1)+pd[i])/k;sn=(sn*(k-1)+nd[i])/k;const pi=at>0?(sp/at)*100:0,ni=at>0?(sn/at)*100:0,s=pi+ni;dx.push(s>0?(Math.abs(pi-ni)/s)*100:0);if(dx.length>=k)a[i+1]=dx.slice(-k).reduce((a,b)=>a+b,0)/k;}return a;}
function _sq(c,h,l){const k=20,n=c.length;let v=[],s=[];for(let i=0;i<n;i++){if(i<k){v.push(0);s.push(false);continue;}const sl=c.slice(i-k,i),mn=sl.reduce((a,b)=>a+b,0)/k,st=Math.sqrt(sl.reduce((a,b)=>a+(b-mn)**2,0)/k);let at=0;for(let j=Math.max(1,i-k);j<=i;j++)at+=Math.max(h[j]-l[j],Math.abs(h[j]-c[j-1]),Math.abs(l[j]-c[j-1]));at/=k;s.push(mn-2*st>mn-1.5*at&&mn+2*st<mn+1.5*at);v.push(c[i]-mn);}return{v,s};}
function _m(p){const a=_e(p,12),b=_e(p,26),m=a.map((v,i)=>v-b[i]),s=_e(m,9);return m.map((v,i)=>v-s[i]);}
function _at(h,l,c,k=14){let a=[h[0]-l[0]];for(let i=1;i<c.length;i++){const t=Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1]));a.push(i<k?t:(a[i-1]*(k-1)+t)/k);}return a;}
function analyzeEntry(pr,hi,lo,vol){
  const n=pr.length;if(n<60)return null;
  const e10=_e(pr,10),e55=_e(pr,55),rs=_r(pr),ax=_a(hi,lo,pr),sq=_sq(pr,hi,lo),mh=_m(pr),at=_at(hi,lo,pr);
  const last=pr[n-1],prev=pr[n-2],prev2=pr[n-3];
  const le10=e10[n-1],le55=e55[n-1],pe10=e10[n-2],pe55=e55[n-2];
  const lR=rs[n-1],lA=ax[n-1],lS=sq.v[n-1],pS=sq.v[n-2],iSq=sq.s[n-1],wSq=sq.s[n-2];
  const lM=mh[n-1],pM=mh[n-2],lAt=at[n-1];
  const swL=Math.min(...lo.slice(-20)),swH=Math.max(...hi.slice(-20));
  const trend=le10>le55?"ALC":"BAJ";

  // ═══ KEY METRIC: Distance from EMA 55 ═══
  const distE55=((last-le55)/le55)*100; // positive = above, negative = below
  const absDistE55=Math.abs(distE55);

  // ═══ ENTRY ZONES ═══
  // LONG: trend ALC + price NEAR EMA55 (pulled back) + bouncing up
  // SHORT: trend BAJ + price NEAR EMA55 (rallied up) + rejecting down
  // "NEAR" = within 1.5% of EMA55 (adjustable by ATR)
  const nearZone=Math.min(2.5,Math.max(1.2,(lAt/le55)*100*1.5)); // zona dinámica por ATR, TOPE 2.5% para exigir cercanía real a EMA55

  // ═══ CONFIRMACIÓN JAIME: el precio AGUANTA en la EMA + medias estrechándose ═══
  // Medias estrechándose: EMA10 y EMA55 convergen (Jaime: pasa antes del cambio de tendencia)
  const gapNow=Math.abs(le10-le55)/le55, gapPast=Math.abs(e10[n-6]-e55[n-6])/e55[n-6];
  const emasNarrowing=gapNow<gapPast*0.97;
  // AGUANTE LONG: llegó a la EMA55 y NO cae (lateraliza) — mínimos recientes no rompen la zona y no hace mínimo nuevo
  const holdsLong=((Math.min(...lo.slice(-3))-le55)/le55)*100 > -nearZone && last>=Math.min(prev,prev2);
  // AGUANTE SHORT: llegó a la EMA55 y NO sube — máximos recientes no rompen la zona y no hace máximo nuevo
  const holdsShort=((Math.max(...hi.slice(-3))-le55)/le55)*100 < nearZone && last<=Math.max(prev,prev2);

  // ═══ POC (perfil de volumen aprox): nivel de MAYOR volumen negociado = soporte/resistencia clave (filtro de Jaime) ═══
  let poc=null;
  if(vol&&vol.length===n){
    const lb=Math.min(60,n),H=hi.slice(-lb),L=lo.slice(-lb),V=vol.slice(-lb);
    const top=Math.max(...H),bot=Math.min(...L),bins=24,step=(top-bot)/bins;
    if(step>0){const acc=new Array(bins).fill(0);
      for(let i=0;i<lb;i++){const b0=Math.max(0,Math.floor((L[i]-bot)/step)),b1=Math.min(bins-1,Math.floor((H[i]-bot)/step)),sp=(b1-b0+1)||1;for(let b=b0;b<=b1;b++)acc[b]+=V[i]/sp;}
      let mx=-1,mi=0;for(let b=0;b<bins;b++)if(acc[b]>mx){mx=acc[b];mi=b;}
      poc=bot+(mi+0.5)*step;}
  }

  let signal=null,reason=[],quality=0;

  // ── PATTERN 1: Pullback to EMA 55 in uptrend (THE main entry) ──
  if(trend==="ALC"&&distE55>=0&&distE55<nearZone){
    // Price is just above EMA55, pulled back from higher
    const wasFarther=((prev-e55[n-2])/e55[n-2])*100>distE55; // was farther before = pulling back
    const bouncing=last>prev&&prev<=prev2; // V-shape bounce
    const sqzUp=lS>0||lS>pS; // momentum turning up
    const adxOk=lA>18;
    let q=0;
    if(wasFarther||bouncing)q+=3;
    if(sqzUp)q+=2;
    if(adxOk)q+=2;
    if(lR<55&&lR>30)q+=1; // RSI not overbought
    if(lM>pM)q+=1; // MACD improving
    if(wSq&&!iSq&&lS>0)q+=2; // Squeeze breakout up
    if(q>=4&&holdsLong){signal="LONG";reason.push("Rebote en EMA55");quality=q;reason.push("Aguanta en EMA55 (no cae)");if(emasNarrowing){reason.push("Medias estrechándose");quality=Math.min(9,quality+1);}
      if(bouncing)reason.push("Vela de rebote ↑");
      if(sqzUp)reason.push("Momentum ↑");
      if(adxOk)reason.push("ADX "+F(lA,0));
      if(wSq&&!iSq)reason.push("Squeeze breakout");
    }
  }

  // ── PATTERN 2: Pullback to EMA 55 in downtrend (SHORT entry) ──
  if(trend==="BAJ"&&distE55<=0&&Math.abs(distE55)<nearZone){
    const wasFarther=((prev-e55[n-2])/e55[n-2])*100<distE55;
    const rejecting=last<prev&&prev>=prev2;
    const sqzDn=lS<0||lS<pS;
    const adxOk=lA>18;
    let q=0;
    if(wasFarther||rejecting)q+=3;
    if(sqzDn)q+=2;
    if(adxOk)q+=2;
    if(lR>45&&lR<70)q+=1;
    if(lM<pM)q+=1;
    if(wSq&&!iSq&&lS<0)q+=2;
    if(q>=4&&holdsShort){signal="SHORT";reason.push("Rechazo en EMA55");quality=q;reason.push("Aguanta en EMA55 (no sube)");if(emasNarrowing){reason.push("Medias estrechándose");quality=Math.min(9,quality+1);}
      if(rejecting)reason.push("Vela de rechazo ↓");
      if(sqzDn)reason.push("Momentum ↓");
      if(adxOk)reason.push("ADX "+F(lA,0));
      if(wSq&&!iSq)reason.push("Squeeze breakout");
    }
  }

  // ── PATTERN 3: Cruce de EMAs — SOLO confluencia (no abre; Jaime entra en el pullback que aguanta, no en el cruce) ──
  if(signal==="LONG"&&pe10<=pe55&&le10>le55){reason.push("Cruce EMA 10>55 confirma");quality=Math.min(9,quality+1);}
  if(signal==="SHORT"&&pe10>=pe55&&le10<le55){reason.push("Cruce EMA 10<55 confirma");quality=Math.min(9,quality+1);}

  // ── PATTERN 4: Divergencia (Squeeze, método TradingLatino) SOLO como confluencia — NUNCA abre operación sola ──
  if(n>40&&absDistE55<nearZone*1.5&&signal){
    const piv=(arr,lo)=>{const out=[];for(let i=arr.length-3;i>=Math.max(2,arr.length-45);i--){const v=arr[i];let ok=true;for(let j=1;j<=2;j++){if(lo?(arr[i-j]<v||arr[i+j]<v):(arr[i-j]>v||arr[i+j]>v)){ok=false;break;}}if(ok&&(out.length===0||out[out.length-1]-i>=4)){out.push(i);if(out.length>=2)break;}}return out;};
    if(signal==="LONG"){const sV=piv(sq.v,true);if(sV.length>=2){const b=sV[0],a=sV[1];if(sq.v[b]>sq.v[a]&&pr[b]<pr[a]){reason.push("Divergencia alcista (Squeeze"+(rs[b]>rs[a]?"+RSI":"")+")");quality=Math.min(8,quality+1);}}}
    if(signal==="SHORT"){const sP=piv(sq.v,false);if(sP.length>=2){const b=sP[0],a=sP[1];if(sq.v[b]<sq.v[a]&&pr[b]>pr[a]){reason.push("Divergencia bajista (Squeeze"+(rs[b]<rs[a]?"+RSI":"")+")");quality=Math.min(8,quality+1);}}}
  }

  // ── PATTERN 5: Squeeze breakout — SOLO confluencia (no abre operación solo) ──
  if(wSq&&!iSq&&absDistE55<nearZone*1.2){
    if(signal==="LONG"&&lS>0){reason.push("Squeeze breakout ↑");quality=Math.min(9,quality+1);}
    if(signal==="SHORT"&&lS<0){reason.push("Squeeze breakout ↓");quality=Math.min(9,quality+1);}
  }

  // ═══ ZONAS NO OPERABLES (Jaime): máximo anterior / doble-triple techo / resistencia muy cerca ═══
  // Excepción: se permite si las medias se están estrechando (viene de un lateral)
  let noOp=null;
  if(signal==="LONG"){
    const priorHigh=Math.max(...hi.slice(-30,-3)),roomUp=((priorHigh-last)/last)*100;
    const touches=hi.slice(-30).filter(h=>Math.abs(h-priorHigh)/priorHigh<0.006).length;
    if(roomUp>0.05&&roomUp<1.5&&!emasNarrowing){signal=null;noOp="Zona no operable: resistencia/máximo a "+F(roomUp,1)+"%"+(touches>=3?" (triple techo)":touches>=2?" (doble techo)":"");}
  }else if(signal==="SHORT"){
    const priorLow=Math.min(...lo.slice(-30,-3)),roomDn=((last-priorLow)/last)*100;
    const touches=lo.slice(-30).filter(l=>Math.abs(l-priorLow)/priorLow<0.006).length;
    if(roomDn>0.05&&roomDn<1.5&&!emasNarrowing){signal=null;noOp="Zona no operable: soporte/mínimo a "+F(roomDn,1)+"%"+(touches>=3?" (triple suelo)":touches>=2?" (doble suelo)":"");}
  }

  // POC como confluencia (Jaime: "el soporte por excelencia")
  if(poc&&signal){const pd=((last-poc)/poc)*100;
    if(signal==="LONG"&&pd>-0.4&&pd<2.5){reason.push("POC soporte ✓");quality=Math.min(9,quality+1);}
    if(signal==="SHORT"&&pd<0.4&&pd>-2.5){reason.push("POC resistencia ✓");quality=Math.min(9,quality+1);}
  }

  // ── BLOCK: Too far from EMA55 = NO ENTRY ──
  const tooFar=absDistE55>nearZone*2.5;
  const farMsg=`Precio ${distE55>0?"por encima":"por debajo"} de EMA55 (${F(absDistE55,1)}%). Esperar pullback.`;

  return{signal:tooFar?null:signal,reason,quality,trend,distE55:F(distE55,2),absDistE55:F(absDistE55,2),nearZone:F(nearZone,2),tooFar,farMsg:tooFar?farMsg:null,noOp,emasNarrowing,poc,rsi:lR,adx:lA,adxRising:(ax[n-1]>ax[n-3]),isSqz:iSq,sqzV:lS,macdH:lM,atr:lAt,e10,e55,sq,last,swL,swH,le55};
}

// ═══ DAILY COMPASS ═══
function compass(daily){
  if(!daily||daily.length<20)return null;
  const c=daily.map(k=>k.c),h=daily.map(k=>k.h),l=daily.map(k=>k.l),n=c.length,last=c[n-1];
  const r30H=Math.max(...h.slice(-30)),r30L=Math.min(...l.slice(-30)),rng=r30H-r30L;
  const rPos=rng>0?Math.round((last-r30L)/rng*100):50;
  const e10=_e(c,10),e55=_e(c,55),trend=e10[n-1]>e55[n-1]?"ALC":"BAJ",dRsi=_r(c)[n-1];
  let res=[],sup=[];for(let i=Math.max(2,n-25);i<n-1;i++){if(h[i]>h[i-1]&&h[i]>h[i+1]&&h[i]>last)res.push(h[i]);if(l[i]<l[i-1]&&l[i]<l[i+1]&&l[i]<last)sup.push(l[i]);}
  res.sort((a,b)=>a-b);sup.sort((a,b)=>b-a);
  const nRes=res[0]||r30H,nSup=sup[0]||r30L;
  let risk,riskCol;
  if(rPos>85||rPos<15){risk="EXTREMO";riskCol="var(--r)";}
  else if(rPos>75||rPos<25||dRsi>70||dRsi<30){risk="ALTO";riskCol="var(--o)";}
  else if(rPos>60||rPos<40){risk="MEDIO";riskCol="var(--go)";}
  else{risk="BAJO";riskCol="var(--g)";}
  return{rPos,r30H,r30L,trend,dRsi,nRes,nSup,roomUp:Pct(nRes,last),roomDown:Pct(last,nSup),last,risk,riskCol};
}

// ═══ BTC = LÍDER DE MERCADO (guía todas las alts) ═══
function btcGuide(rawBTC){
  if(!rawBTC)return null;
  const trendOf=d=>{if(!d||d.length<60)return null;const c=d.map(k=>k.c);const e10=_e(c,10),e55=_e(c,55);return e10[c.length-1]>e55[c.length-1]?"ALC":"BAJ";};
  const mom=(d,bars)=>{if(!d||d.length<bars+1)return 0;const c=d.map(k=>k.c);return Pct(c[c.length-1],c[c.length-1-bars]);};
  const td=trendOf(rawBTC["1d"]),t4=trendOf(rawBTC["4h"]),t1=trendOf(rawBTC["1h"]),t15=trendOf(rawBTC["15m"]);
  const m15=mom(rawBTC["15m"],4); // ~1h de movimiento
  const m5=mom(rawBTC["5m"],6);   // ~30m de movimiento
  const bull=[td,t4,t1].filter(x=>x==="ALC").length;
  let dir;
  if(bull>=2&&t4==="ALC")dir="ALC";
  else if(bull<=1&&t4==="BAJ")dir="BAJ";
  else dir="MIXTO";
  const dumping=m15<-1.2||m5<-0.8;
  const pumping=m15>1.2||m5>0.8;
  const c=rawBTC["4h"]; const price=c&&c.length?c[c.length-1].c:null;
  return{dir,td,t4,t1,t15,m15,m5,dumping,pumping,price};
}

// ═══ BARRIDO DE LIQUIDEZ + ORDER BLOCK (sobre 5m) ═══
// Aproximación con acción del precio (sin order flow):
// LONG  = barre un mínimo (stop hunt) y cierra arriba + order block alcista revisitado
// SHORT = barre un máximo y cierra abajo + order block bajista revisitado
function detectSweepOB(kl,dir){
  const n=kl.length;if(n<25)return{sweep:false,ob:false};
  const last=kl[n-1];
  const win=kl.slice(-22,-3); // ventana previa para el nivel de liquidez
  if(dir==="LONG"){
    const swingLow=Math.min(...win.map(k=>k.l));
    let sweep=false,sw=null;
    for(let i=n-3;i<n;i++){if(kl[i].l<swingLow&&kl[i].c>swingLow){const k=kl[i],body=Math.abs(k.c-k.o)||1e-9,wick=Math.min(k.o,k.c)-k.l;if(wick>=body){sweep=true;sw=k;}}}
    let ob=false,obHigh=null,obLow=null;
    for(let i=n-11;i<n-1;i++){if(i<0)continue;const a=kl[i],b=kl[i+1];if(a.c<a.o&&b.c>b.o&&(b.c-b.o)>Math.abs(a.o-a.c)*1.2){obHigh=Math.max(a.o,a.h);obLow=Math.min(a.l,a.c);ob=true;}}
    const inOB=ob&&last.l<=obHigh&&last.c>=obLow;
    return{sweep,ob:inOB,level:swingLow,obHigh,obLow,dir};
  }else{
    const swingHigh=Math.max(...win.map(k=>k.h));
    let sweep=false;
    for(let i=n-3;i<n;i++){if(kl[i].h>swingHigh&&kl[i].c<swingHigh){const k=kl[i],body=Math.abs(k.c-k.o)||1e-9,wick=k.h-Math.max(k.o,k.c);if(wick>=body)sweep=true;}}
    let ob=false,obHigh=null,obLow=null;
    for(let i=n-11;i<n-1;i++){if(i<0)continue;const a=kl[i],b=kl[i+1];if(a.c>a.o&&b.c<b.o&&(b.o-b.c)>Math.abs(a.c-a.o)*1.2){obHigh=Math.max(a.o,a.h);obLow=Math.min(a.l,a.c);ob=true;}}
    const inOB=ob&&last.h>=obLow&&last.c<=obHigh;
    return{sweep,ob:inOB,level:swingHigh,obHigh,obLow,dir};
  }
}

// ═══ MULTI-TF LAYERED CHECK ═══
function checkLayers(raw,pair,sym,btc){
  const tfs={};
  const ALL=["1m","5m","15m","1h","4h","1d"];
  for(const tf of ALL){const d=raw[tf];if(!d||d.length<60)continue;tfs[tf]=analyzeEntry(d.map(k=>k.c),d.map(k=>k.h),d.map(k=>k.l),d.map(k=>k.v));}

  const comp=raw["1d"]?compass(raw["1d"]):null;
  const h4=tfs["4h"],h1=tfs["1h"],m15=tfs["15m"],m5=tfs["5m"],m1=tfs["1m"];

  // 4H must have a signal (pullback to EMA55 detected)
  if(!h4||!h4.signal)return{signal:null,tfs,comp,status:h4?.tooFar?h4.farMsg:"4H: "+(!h4?"sin datos":"esperando pullback a EMA55"),warnings:[]};

  const dir=h4.signal;

  // ═══ FILTRO BTC (líder de mercado) — no aplica a BTC mismo ═══
  const isBTC=sym==="BTCUSDT";
  if(!isBTC&&btc){
    if(dir==="LONG"&&(btc.dir==="BAJ"||btc.dumping))
      return{signal:null,tfs,comp,btc,status:"🚫 BTC en contra · guía "+(btc.dumping?"cayendo ahora":"bajista"),warnings:["₿ BTC "+F(btc.m15,1)+"% en 1h"]};
    if(dir==="SHORT"&&(btc.dir==="ALC"||btc.pumping))
      return{signal:null,tfs,comp,btc,status:"🚫 BTC en contra · guía "+(btc.pumping?"subiendo ahora":"alcista"),warnings:["₿ BTC +"+F(btc.m15,1)+"% en 1h"]};
  }

  // ═══ BARRIDO DE LIQUIDEZ + ORDER BLOCK (5m) ═══
  const sob=raw["5m"]?detectSweepOB(raw["5m"],dir):{sweep:false,ob:false};
  // Modo estricto: exige barrido O order block para disparar la señal
  if(typeof S!=="undefined"&&S.strict&&!(sob.sweep||sob.ob))
    return{signal:null,tfs,comp,btc,sob,status:"⏳ Esperando barrido/OB en 5m (modo estricto)",warnings:[]};

  // ═══ FILTRO ADX — fuerza de tendencia (estilo TradingLatino) ═══
  const ADX_MIN=23;
  if(h4.adx<ADX_MIN)
    return{signal:null,tfs,comp,btc,sob,status:"⏳ Tendencia débil · ADX 4H "+F(h4.adx,0)+" (mín "+ADX_MIN+")",warnings:[]};
  // Modo estricto: el ADX 4H además debe ir SUBIENDO (la pendiente manda)
  if(typeof S!=="undefined"&&S.strict&&!h4.adxRising)
    return{signal:null,tfs,comp,btc,sob,status:"⏳ ADX 4H sin fuerza creciente ("+F(h4.adx,0)+" ▼) — modo estricto",warnings:[]};
  const adxStrong=h4.adx>=ADX_MIN&&h4.adxRising;

  // At least 1 of (1H, 15m) must confirm same direction
  const h1ok=h1?.signal===dir;
  const m15ok=m15?.signal===dir;
  // OR: 1H/15m trend matches (even without signal, trend alignment counts)
  const h1trend=(h1?.trend==="ALC"&&dir==="LONG")||(h1?.trend==="BAJ"&&dir==="SHORT");
  const m15trend=(m15?.trend==="ALC"&&dir==="LONG")||(m15?.trend==="BAJ"&&dir==="SHORT");

  const confirmed=h1ok||m15ok||h1trend||m15trend;
  if(!confirmed)return{signal:null,tfs,comp,status:`4H: ${dir} en EMA55, pero 1H/15m no confirman`,warnings:[]};

  // Refinement
  const m5ok=m5?.signal===dir||(m5?.trend==="ALC"&&dir==="LONG")||(m5?.trend==="BAJ"&&dir==="SHORT");
  const m1ok=m1?.signal===dir||(m1?.trend==="ALC"&&dir==="LONG")||(m1?.trend==="BAJ"&&dir==="SHORT");
  const quality=((h1ok?2:h1trend?1:0)+(m15ok?2:m15trend?1:0)+(m5ok?1:0)+(m1ok?1:0))+((!isBTC&&btc&&((dir==="LONG"&&btc.dir==="ALC")||(dir==="SHORT"&&btc.dir==="BAJ")))?1:0)+(sob.sweep?1:0)+(sob.ob?1:0)+(adxStrong?1:0);
  let qLabel=quality>=5?"ÓPTIMA":quality>=3?"BUENA":"ACEPTABLE";
  if(!h4.adxRising&&qLabel==="ÓPTIMA")qLabel="BUENA"; // ADX cayendo nunca es ÓPTIMA

  // Context warnings
  const warnings=[];
  if(comp){
    if(dir==="LONG"&&comp.rPos>85){return{signal:null,tfs,comp,status:"🚫 Techo del rango diario",warnings:["Precio en zona "+comp.rPos+"%"]};}
    if(dir==="SHORT"&&comp.rPos<15){return{signal:null,tfs,comp,status:"🚫 Piso del rango diario",warnings:["Precio en zona "+comp.rPos+"%"]};}
    if(dir==="LONG"&&comp.trend==="BAJ")warnings.push("⚠️ Diario BAJISTA — más riesgo");
    if(dir==="SHORT"&&comp.trend==="ALC")warnings.push("⚠️ Diario ALCISTA — más riesgo");
    if(comp.risk==="EXTREMO")warnings.push("🔴 Riesgo diario EXTREMO");
    else if(comp.risk==="ALTO")warnings.push("🟠 Riesgo diario ALTO");
  }
  if(!isBTC&&btc&&btc.dir==="MIXTO")warnings.push("⚠️ BTC sin dirección clara — guía mixta");
  if(!h4.adxRising)warnings.push("⚠️ ADX 4H sin fuerza creciente ("+F(h4.adx,0)+")");

  // Build entry
  const bestTF=m5ok&&m5?"5m":m15ok&&m15?"15m":h1ok&&h1?"1h":"4h";
  const r=tfs[bestTF]||h4;
  const isL=dir==="LONG",ep=r.last;
  const sl=isL?r.swL-r.atr*0.8:r.swH+r.atr*0.8;
  const risk=Math.abs(ep-sl);
  let tp1,tp2,tp3;
  if(comp){
    const cap=isL?comp.nRes:comp.nSup,room=Math.abs(cap-ep);
    tp1=isL?ep+Math.min(risk*1.5,room*0.5):ep-Math.min(risk*1.5,room*0.5);
    tp2=isL?ep+Math.min(risk*2.5,room*0.8):ep-Math.min(risk*2.5,room*0.8);
    tp3=isL?ep+Math.min(risk*3.5,room*0.95):ep-Math.min(risk*3.5,room*0.95);
  }else{tp1=isL?ep+risk*1.5:ep-risk*1.5;tp2=isL?ep+risk*2.5:ep-risk*2.5;tp3=isL?ep+risk*3.5:ep-risk*3.5;}
  const rr=risk>0?F(Math.abs(tp1-ep)/risk,1):"0";
  if(risk<=0||parseFloat(rr)<0.8)return{signal:null,tfs,comp,status:"R:R insuficiente",warnings};

  const confirms=[];
  confirms.push("4H: "+h4.reason.join(", "));
  if(h1ok)confirms.push("1H ✓ señal");else if(h1trend)confirms.push("1H ✓ tendencia");
  if(m15ok)confirms.push("15m ✓ señal");else if(m15trend)confirms.push("15m ✓ tendencia");
  if(m5ok)confirms.push("5m ✓");if(m1ok)confirms.push("1m ✓");
  if(sob.sweep)confirms.push("🎯 Barrido de liquidez");
  if(sob.ob)confirms.push("📦 Order Block");
  confirms.push("📊 ADX 4H "+F(h4.adx,0)+(h4.adxRising?" ▲":" ▼"));
  if(!isBTC&&btc&&((dir==="LONG"&&btc.dir==="ALC")||(dir==="SHORT"&&btc.dir==="BAJ")))confirms.push("₿ BTC a favor");

  return{
    signal:{type:dir,pair,entry:ep,sl,tp1,tp2,tp3,risk,atr:r.atr,entryTF:bestTF,quality:qLabel,confirms,rr,warnings,
      distE55:h4.distE55,dailyRisk:comp?.risk||"—",dailyTrend:comp?.trend==="ALC"?"ALCISTA":"BAJISTA",
      btcDir:(!isBTC&&btc)?btc.dir:null,sweep:sob.sweep,ob:sob.ob,adx:h4.adx,adxRising:h4.adxRising,details:h4.reason},
    tfs,comp,btc,sob,status:"🎯 SEÑAL — Pullback a EMA55"+(!isBTC&&btc&&((dir==="LONG"&&btc.dir==="ALC")||(dir==="SHORT"&&btc.dir==="BAJ"))?" + BTC":"")+(sob.sweep||sob.ob?" + "+(sob.sweep&&sob.ob?"Barrido+OB":sob.sweep?"Barrido":"OB"):""),warnings
  };
}

// ═══ BINANCE / TG / SOUND ═══
function tgFmt(e){return`${e.type==="LONG"?"🟢 COMPRAR":"🔴 VENDER"}\n\n💎 <b>${e.pair}</b>\n🎯 Pullback a EMA55 · Dist: ${e.distE55}%\n📊 Calidad: ${e.quality}\n✅ ${e.confirms.join("\n✅ ")}\n${e.dailyTrend==="ALCISTA"?"📈":"📉"} Diario: ${e.dailyTrend} · Riesgo: ${e.dailyRisk}${e.btcDir?`\n₿ BTC guía: ${e.btcDir==="ALC"?"ALCISTA ✅":e.btcDir==="BAJ"?"BAJISTA ⚠️":"MIXTO"}`:""}${e.sweep||e.ob?`\n🎯 ${e.sweep&&e.ob?"Barrido + Order Block":e.sweep?"Barrido de liquidez":"Order Block"} en 5m`:""}\n━━━━━━━━━━━━━━\n💰 Entrada: <code>${FP(e.entry)}</code>\n🛑 SL: <code>${FP(e.sl)}</code>\n🎯 TP1: <code>${FP(e.tp1)}</code>\n🎯 TP2: <code>${FP(e.tp2)}</code>\n🎯 TP3: <code>${FP(e.tp3)}</code>\nR:R 1:${e.rr}${e.warnings.length?"\n\n"+e.warnings.join("\n"):""}\n⏰ ${TD()}`;}

// ════════════════════════════════════════════════════════════
//  PARTE SERVIDOR (Binance + Telegram + estado)
// ════════════════════════════════════════════════════════════
const BOT  = process.env.BOT_TOKEN;
const CHAT = process.env.CHAT_ID;
const DEFAULT_SYMS = "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,AVAXUSDT,LINKUSDT,SUIUSDT";
const mkPair = s => { s=String(s).toUpperCase().replace(/[^A-Z0-9]/g,""); if(!s.endsWith("USDT"))s+="USDT"; return {s, l:s.replace("USDT","")+"/USDT"}; };
const PAIRS = (process.env.SYMBOLS||DEFAULT_SYMS).split(",").map(x=>x.trim()).filter(Boolean).map(mkPair);

// data-api.binance.vision primero (no se bloquea por región en los servidores de GitHub)
const HOSTS = ["https://data-api.binance.vision","https://api.binance.com"];
async function fK(s,tf){
  for(const h of HOSTS){
    try{ const r=await fetch(`${h}/api/v3/klines?symbol=${s}&interval=${tf}&limit=100`);
      if(r.ok) return (await r.json()).map(k=>({o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})); }catch{}
  }
  return null;
}
async function tg(text){
  if(!BOT||!CHAT){ console.log("⚠️ Faltan BOT_TOKEN o CHAT_ID"); return; }
  try{
    const r=await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:CHAT,text,parse_mode:"HTML"})});
    const j=await r.json(); if(!j.ok) console.log("TG error:",JSON.stringify(j));
  }catch(e){ console.log("TG fail:",e.message); }
}
const loadState = ()=>{ try{return JSON.parse(fs.readFileSync("state.json","utf8"));}catch{return {};} };
const saveState = st=>{ try{fs.writeFileSync("state.json",JSON.stringify(st));}catch(e){console.log("state fail",e.message);} };

// Migración: del formato viejo {SYM:hash} al nuevo {alerts, open, log}
function migrateState(st){
  if(st&&(st.alerts||st.open||st.log))return {alerts:st.alerts||{},open:st.open||{},log:st.log||[]};
  return {alerts:(st&&typeof st==="object")?st:{},open:{},log:[]};
}
// Estadísticas del registro (solo operaciones cerradas)
function stats(log){
  const c=log.filter(t=>t.exit!=null),n=c.length;if(!n)return null;
  const w=c.filter(t=>t.plPct>0),l=c.filter(t=>t.plPct<=0);
  const avg=a=>a.length?a.reduce((s,t)=>s+t.plPct,0)/a.length:0;
  return {n,wins:w.length,wr:Math.round(w.length/n*100),avgW:avg(w),avgL:avg(l),net:c.reduce((s,t)=>s+t.plPct,0)};
}
// Salida estilo Jaime: el target es el PATRÓN CONTRARIO (4H gira) o el stop / TP3
function exitSignal(pos,res){
  const h4=res.tfs?.["4h"];const px=h4?.last;if(px==null)return null;
  if(pos.type==="LONG"){
    if(px<=pos.sl)return{reason:"🛑 Stop alcanzado",px};
    if(h4.signal==="SHORT"||h4.trend==="BAJ")return{reason:"🔄 Patrón contrario (4H giró bajista)",px};
    if(px>=pos.tp3)return{reason:"🎯 TP3 alcanzado",px};
  }else{
    if(px>=pos.sl)return{reason:"🛑 Stop alcanzado",px};
    if(h4.signal==="LONG"||h4.trend==="ALC")return{reason:"🔄 Patrón contrario (4H giró alcista)",px};
    if(px<=pos.tp3)return{reason:"🎯 TP3 alcanzado",px};
  }
  return null;
}
function tgExit(pos,ex,s){
  const pl=pos.type==="LONG"?((ex.px-pos.entry)/pos.entry*100):((pos.entry-ex.px)/pos.entry*100);
  return `${pl>0?"✅":"❌"} <b>CERRAR ${pos.type} ${pos.pair}</b>\n${ex.reason}\n━━━━━━━━━━━━━━\n💰 Entrada: <code>${FP(pos.entry)}</code>\n🚪 Salida: <code>${FP(ex.px)}</code>\n📈 Resultado: <b>${pl>=0?"+":""}${F(pl,2)}%</b>${s?`\n\n📒 <b>Registro</b>: ${s.n} ops · acierto ${s.wr}% · neto ${s.net>=0?"+":""}${F(s.net,1)}%`:""}\n⏰ ${TD()}`;
}

async function main(){
  if(process.env.TEST==="true"){
    await tg("✅ <b>Robot CryptoScalper conectado</b>\n📡 Mensaje de prueba — si lees esto, Telegram funciona y te llegarán las señales.\n⏰ "+TD());
    console.log("📨 Mensaje de prueba enviado a Telegram.");
  }
  console.log(`🔎 Escaneando ${PAIRS.length} pares · estricto=${S.strict} · ${TD()}`);
  const raw={};
  await Promise.all(PAIRS.map(async p=>{ raw[p.s]={};
    await Promise.all(ALL.map(async tf=>{ const d=await fK(p.s,tf); if(d)raw[p.s][tf]=d; })); }));
  const btc = raw["BTCUSDT"] ? btcGuide(raw["BTCUSDT"]) : null;
  if(btc) console.log(`₿ BTC guía: ${btc.dir} · cayendo=${btc.dumping} · subiendo=${btc.pumping} · Δ1h=${F(btc.m15,2)}%`);
  const st = migrateState(loadState());
  let nuevas=0, cierres=0, activas=0;
  for(const p of PAIRS){
    const r=raw[p.s]; if(!r||!r["4h"]){ console.log(`· ${p.s}: sin datos`); continue; }
    const res=checkLayers(r,p.l,p.s,btc);
    const open=st.open[p.s];

    // ── SALIDA: si hay posición abierta, buscar patrón contrario / stop / TP3 ──
    if(open){
      const ex=exitSignal(open,res);
      if(ex){
        const pl=open.type==="LONG"?((ex.px-open.entry)/open.entry*100):((open.entry-ex.px)/open.entry*100);
        st.log.push({pair:open.pair,type:open.type,entry:open.entry,exit:ex.px,plPct:+F(pl,3),reason:ex.reason,quality:open.quality,openTs:open.ts,closeTs:Date.now()});
        if(st.log.length>120)st.log=st.log.slice(-120);
        delete st.open[p.s]; delete st.alerts[p.s];
        cierres++;
        console.log(`📕 CIERRE: ${open.type} ${p.s} · ${F(pl,2)}% · ${ex.reason}`);
        await tg(tgExit(open,ex,stats(st.log)));
      } else {
        activas++;
        console.log(`↔︎ ${p.s}: ${open.type} abierta @ ${F(open.entry,4)} — sin patrón de salida`);
      }
      continue; // mientras la posición esté abierta no abrimos otra en este par
    }

    // ── ENTRADA: nueva señal ──
    if(res.signal){
      const e=res.signal;
      const hash=e.type+e.pair+e.quality+F(e.entry,0);
      if(st.alerts[p.s]!==hash){
        st.alerts[p.s]=hash; nuevas++; activas++;
        st.open[p.s]={pair:e.pair,type:e.type,entry:e.entry,sl:e.sl,tp1:e.tp1,tp2:e.tp2,tp3:e.tp3,quality:e.quality,ts:Date.now()};
        console.log(`🎯 SEÑAL NUEVA: ${e.type} ${e.pair} · ${e.quality} @ ${F(e.entry,4)}`);
        await tg(tgFmt(e));
      } else {
        console.log(`= ${p.s}: señal ya avisada (${e.type} ${e.quality})`);
      }
    } else {
      if(st.alerts[p.s]) delete st.alerts[p.s];
      console.log(`· ${p.s}: ${res.status||"sin señal"}`);
    }
  }
  saveState(st);
  const s=stats(st.log);
  console.log(`✅ Fin. activas:${activas} · nuevas:${nuevas} · cierres:${cierres}`+(s?` · registro: ${s.n} ops, acierto ${s.wr}%, neto ${F(s.net,1)}%`:""));
}
main();
