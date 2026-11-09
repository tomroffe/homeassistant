/**
 * air-quality-card  (v1)
 * Same look as climate-overview-card and weather-forecast-card.
 * Built for the Google Air Quality integration (UK DAQI + Universal AQI), but any
 * sensors with the same keys work.
 *
 * - Hero: UK DAQI gauge (1–10, official band order), band name, health advice,
 *   Universal AQI and the main pollutant.
 * - Pollutant tiles: value, the band it would sit in on the DAQI scale, and a
 *   sparkline for the period. The main pollutant is marked.
 * - History graph: DAQI as coloured columns, Universal AQI as a line.
 *   Hover or drag: the tiles show the values at that time.
 *
 * Config:
 *   type: custom:air-quality-card
 *   prefix: sensor.bergholt_road
 *   hours: 24
 *   ranges: [24, 72, 168]
 *   sensors: { pm2_5: sensor.other_pm25 }   # optional overrides per key
 *
 * Keys read from <prefix>_<key>: daqi_uk_aqi, daqi_uk_category,
 * daqi_uk_dominant_pollutant, universal_air_quality_index, uaqi_category,
 * uaqi_dominant_pollutant, pm2_5, pm10, nitrogen_dioxide, ozone,
 * sulphur_dioxide, carbon_monoxide.
 *
 * Bands are the UK DAQI thresholds in µg/m³ (ppb/ppm values are converted).
 * They are applied to the current reading, not the official running means, so
 * treat them as a guide. CO is not part of DAQI: its scale puts the WHO 24-hour
 * guideline (4 mg/m³) at the top of band 4.
 *
 * Install: copy to /config/www/air-quality-card.js and add the resource
 * /local/air-quality-card.js?v=1 (type: JavaScript module).
 */

const AQ_HOUR = 3600000;
const AQ_REFRESH_MS = 10 * 60 * 1000;

const AQ_BANDS = [
  null,
  { c: "#81c784", word: "Low" },
  { c: "#66bb6a", word: "Low" },
  { c: "#43a047", word: "Low" },
  { c: "#fdd835", word: "Moderate" },
  { c: "#ffb300", word: "Moderate" },
  { c: "#fb8c00", word: "Moderate" },
  { c: "#ef5350", word: "High" },
  { c: "#e53935", word: "High" },
  { c: "#b71c1c", word: "High" },
  { c: "#ab47bc", word: "Very high" },
];

const AQ_ADVICE = {
  Low: "Enjoy your usual outdoor activities.",
  Moderate: "Fine for most people. With heart or lung problems and symptoms, take it easier outdoors.",
  High: "Cut down strenuous exercise outdoors, especially with a cough, sore eyes or sore throat.",
  "Very high": "Reduce physical effort outdoors, particularly if you have symptoms.",
};

const AQ_POLLUTANTS = [
  { key: "pm2_5", name: "PM2.5", desc: "Fine particles", codes: ["pm25", "pm2_5", "pm2.5"], bands: [11, 23, 35, 41, 47, 53, 58, 64, 70] },
  { key: "pm10", name: "PM10", desc: "Coarse particles", codes: ["pm10"], bands: [16, 33, 50, 58, 66, 75, 83, 91, 100] },
  { key: "nitrogen_dioxide", name: "NO₂", desc: "Nitrogen dioxide", mw: 46.01, codes: ["no2", "nitrogen_dioxide"], bands: [67, 134, 200, 267, 334, 400, 467, 534, 600] },
  { key: "ozone", name: "O₃", desc: "Ozone", mw: 48.0, codes: ["o3", "ozone"], bands: [33, 66, 100, 120, 140, 160, 187, 213, 240] },
  { key: "sulphur_dioxide", name: "SO₂", desc: "Sulphur dioxide", mw: 64.07, codes: ["so2", "sulphur_dioxide", "sulfur_dioxide"], bands: [88, 177, 266, 354, 443, 532, 710, 887, 1064] },
  { key: "carbon_monoxide", name: "CO", desc: "Carbon monoxide", mw: 28.01, codes: ["co", "carbon_monoxide"], bands: [1000, 2000, 3000, 4000, 6000, 8000, 10000, 15000, 20000] },
];

const AQ_UAQI_STOPS = [[0, "#ef5350"], [40, "#ffb300"], [60, "#fdd835"], [80, "#9ccc65"], [100, "#43a047"]];

const AQ_STYLE = `
  ha-card { padding: 12px; container-type: inline-size; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .panel { border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }

  .hero { display: flex; align-items: center; gap: 14px; width: 100%; padding: 10px 14px 10px 10px; }
  .hero:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .gauge { position: relative; flex: none; width: 112px; height: 96px; }
  .gauge svg { display: block; width: 112px; height: 96px; }
  .gauge .seg-arc { fill: none; stroke-width: 10; stroke-linecap: round; transition: opacity 0.3s; }
  .g-num { position: absolute; left: 0; right: 0; top: 30px; text-align: center; font-size: 32px; line-height: 1; font-variant-numeric: tabular-nums; }
  .g-lbl { position: absolute; left: 0; right: 0; top: 66px; text-align: center; font-size: 11px; color: var(--secondary-text-color); letter-spacing: 0.04em; }
  .h-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
  .h-cat { font-size: 18px; font-weight: 500; color: var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h-adv { font-size: 12px; color: var(--secondary-text-color); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 2px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 10px; font-size: 12px; white-space: nowrap;
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); font-variant-numeric: tabular-nums; }
  .chip .d { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .chip b { font-weight: 500; }
  .chip[hidden] { display: none; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
  @container (min-width: 520px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .tile { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 8px 10px 6px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .tile:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .tile[hidden] { display: none; }
  .tile.main { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 70%, transparent); }
  .t-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .t-name { font-size: 13px; font-weight: 500; }
  .t-desc { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
  .t-main { font-size: 10px; padding: 1px 6px; border-radius: 8px; color: var(--c); background: color-mix(in srgb, var(--c) 18%, transparent); display: none; }
  .tile.main .t-main { display: inline-block; }
  .t-val { display: flex; align-items: baseline; gap: 3px; margin-top: 4px; line-height: 1.1; }
  .t-val .v { font-size: 20px; font-variant-numeric: tabular-nums; }
  .t-val .u { font-size: 11px; color: var(--secondary-text-color); }
  .t-band { margin-left: auto; font-size: 11px; color: var(--c); white-space: nowrap; }
  .meter { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; margin-top: 5px; }
  .meter i { height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .spark { position: relative; margin-top: 5px; height: 26px; }
  .spark svg { display: block; width: 100%; height: 26px; overflow: visible; }
  .spark .sl { fill: none; stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .spark .th { stroke: color-mix(in srgb, var(--primary-text-color) 25%, transparent); stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
  .spark .sc { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--primary-text-color); opacity: 0.45; display: none; }
  .scrubbing .spark .sc { display: block; }
  .dead { opacity: 0.55; }

  .chart { margin-top: 6px; padding: 10px 12px 8px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; font-variant-numeric: tabular-nums; }
  .lg { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .lg b { font-weight: 500; color: var(--primary-text-color); }
  .when { color: var(--primary-text-color); font-weight: 500; }
  .sw { width: 10px; height: 3px; border-radius: 2px; background: var(--c); }
  .sw.col { width: 8px; height: 10px; border-radius: 2px; }
  .seg { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .seg button { color: var(--secondary-text-color); font-size: 12px; padding: 3px 8px; border-radius: 8px; }
  .seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }

  .plot { position: relative; height: 136px; margin-top: 8px; padding: 0 30px; touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
  .plot svg { display: block; width: 100%; height: 120px; overflow: visible; }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .uq { fill: none; stroke: var(--primary-text-color); stroke-width: 1.5; opacity: 0.75; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .cursor { position: absolute; top: 0; height: 120px; width: 1px; background: var(--primary-text-color); opacity: 0.5; pointer-events: none; display: none; }
  .plot.scrub .cursor { display: block; }
  .ax { position: absolute; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none; color: var(--secondary-text-color); transform: translateY(-50%); }
  .ax.l { left: 0; } .ax.r { right: 0; text-align: right; }
  .times { position: absolute; left: 30px; right: 30px; bottom: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); pointer-events: none; }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
`;

class AirQualityCard extends HTMLElement {
  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((e) => e.endsWith("_daqi_uk_aqi") || e.endsWith("_universal_air_quality_index"));
    return { prefix: id ? id.replace(/_(daqi_uk_aqi|universal_air_quality_index)$/, "") : "sensor.home" };
  }

  setConfig(config) {
    if (!config?.prefix && !config?.sensors) throw new Error("Set prefix, e.g. prefix: sensor.bergholt_road");
    this._config = { hours: 24, ranges: [24, 72, 168], ...config };
    let p = String(config.prefix || "").replace(/_$/, "");
    if (p && !p.includes(".")) p = `sensor.${p}`;
    this._prefix = p;
    this._hours = Number(this._config.hours) || 24;
    this._data = null;
    this._fetchedAt = 0;
    this._scrub = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._els) return;
    if (!this._loading && Date.now() - this._fetchedAt > AQ_REFRESH_MS) this._fetch();
    const key = this._ids().map((id) => hass.states[id]);
    if (this._lastKey && key.every((s, i) => s === this._lastKey[i])) return;
    this._lastKey = key;
    this._paintHero();
    if (this._scrub == null) {
      this._paintTiles(null);
      if (this._data) this._paintLegend(null);
    }
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- layout ---------- */

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${AQ_STYLE}</style>
      <ha-card>
        <button class="panel hero">
          <div class="gauge"><svg viewBox="0 0 112 96" aria-hidden="true"></svg><div class="g-num">–</div><div class="g-lbl">DAQI</div></div>
          <div class="h-text">
            <span class="h-cat">–</span>
            <span class="h-adv"></span>
            <div class="chips">
              <span class="chip uaqi"><span class="d"></span>Universal <b></b></span>
              <span class="chip dom">Main <b></b></span>
            </div>
          </div>
        </button>
        <div class="tiles"></div>
        <div class="panel chart">
          <div class="top"><div class="legend"></div><div class="seg ranges" role="group" aria-label="Time range"></div></div>
          <div class="body"><div class="msg">Loading history…</div></div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      card: $("ha-card"), hero: $(".hero"), gauge: $(".gauge svg"), num: $(".g-num"), cat: $(".h-cat"), adv: $(".h-adv"),
      uaqi: $(".chip.uaqi"), uaqiB: $(".chip.uaqi b"), dom: $(".chip.dom"), domB: $(".chip.dom b"),
      tiles: $(".tiles"), legend: $(".legend"), ranges: $(".ranges"), body: $(".body"),
    };
    this._els.hero.addEventListener("click", () => this._moreInfo(this._sid("daqi_uk_aqi")));
    this._els.uaqi.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._moreInfo(this._sid("universal_air_quality_index"));
    });

    // Gauge: ten arc segments, 240° sweep
    const arc = (a0, a1) => {
      const r = 46, cx = 56, cy = 52;
      const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
      const [x0, y0] = p(a0);
      const [x1, y1] = p(a1);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    this._els.gauge.innerHTML = AQ_BANDS.slice(1)
      .map((b, i) => `<path class="seg-arc" stroke="${b.c}" d="${arc(150 + i * 24 + 3.5, 150 + (i + 1) * 24 - 3.5)}"></path>`)
      .join("");
    this._arcs = [...this._els.gauge.querySelectorAll("path")];

    this._tiles = {};
    for (const p of AQ_POLLUTANTS) {
      const t = document.createElement("button");
      t.className = "tile";
      t.innerHTML = `
        <div class="t-head"><span class="t-name"></span><span class="t-desc"></span><span class="t-main">Main</span></div>
        <div class="t-val"><span class="v">–</span><span class="u"></span><span class="t-band"></span></div>
        <div class="meter">${"<i></i>".repeat(10)}</div>
        <div class="spark"><svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"></svg><div class="sc"></div></div>`;
      t.querySelector(".t-name").textContent = p.name;
      t.querySelector(".t-desc").textContent = p.desc;
      t.addEventListener("click", () => this._moreInfo(this._sid(p.key)));
      this._els.tiles.append(t);
      const q = (s) => t.querySelector(s);
      this._tiles[p.key] = { el: t, v: q(".v"), u: q(".u"), band: q(".t-band"), meter: [...t.querySelectorAll(".meter i")], svg: q(".spark svg"), sc: q(".spark .sc") };
    }

    for (const hrs of this._config.ranges) {
      const b = document.createElement("button");
      b.textContent = hrs % 24 === 0 && hrs > 24 ? `${hrs / 24} d` : `${hrs} h`;
      b.setAttribute("aria-pressed", String(hrs === this._hours));
      b.addEventListener("click", () => {
        if (hrs === this._hours) return;
        this._hours = hrs;
        this._els.ranges.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this._fetch();
      });
      this._els.ranges.append(b);
    }
  }

  /* ---------- helpers ---------- */

  _sid(key) {
    return this._config.sensors?.[key] || `${this._prefix}_${key}`;
  }

  _ids() {
    return ["daqi_uk_aqi", "daqi_uk_category", "daqi_uk_dominant_pollutant", "universal_air_quality_index", "uaqi_category", "uaqi_dominant_pollutant", ...AQ_POLLUTANTS.map((p) => p.key)].map((k) => this._sid(k));
  }

  _num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _live(key) {
    const st = this._hass?.states[this._sid(key)];
    return st ? this._num(st.state) : null;
  }

  _fmtVal(v) {
    const d = Math.abs(v) < 10 ? 1 : 0;
    return new Intl.NumberFormat(this._hass?.locale?.language, { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
  }

  _time(t, withDay) {
    const opts = { hour: "2-digit", minute: "2-digit" };
    if (withDay) opts.weekday = "short";
    return new Date(t).toLocaleString(this._hass?.locale?.language, opts);
  }

  _text(st) {
    if (!st || ["unknown", "unavailable"].includes(st.state)) return null;
    if (typeof this._hass.formatEntityState === "function") {
      const s = this._hass.formatEntityState(st);
      if (s && s !== st.state) return s;
    }
    const s = String(st.state).replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  _ugm3(p, v, unit) {
    const u = String(unit || "").replace("μ", "µ").toLowerCase();
    if (u === "mg/m³" || u === "mg/m3") return v * 1000;
    if (p.mw && u === "ppb") return (v * p.mw) / 24.45;
    if (p.mw && u === "ppm") return (v * 1000 * p.mw) / 24.45;
    return v;
  }

  _subIndex(p, v, unit) {
    if (v == null) return null;
    const x = this._ugm3(p, v, unit);
    return 1 + p.bands.filter((b) => x > b).length;
  }

  _band(i) {
    return AQ_BANDS[Math.min(10, Math.max(1, Math.round(i)))];
  }

  _uaqiColor(v) {
    const s = AQ_UAQI_STOPS;
    if (v <= 0) return s[0][1];
    for (let i = 1; i < s.length; i++) if (v <= s[i][0]) return s[i][1];
    return s[s.length - 1][1];
  }

  _uaqiWord(v) {
    if (v >= 80) return "Excellent";
    if (v >= 60) return "Good";
    if (v >= 40) return "Moderate";
    if (v >= 20) return "Low";
    return "Poor";
  }

  _dominantKey() {
    for (const k of ["daqi_uk_dominant_pollutant", "uaqi_dominant_pollutant"]) {
      const st = this._hass.states[this._sid(k)];
      if (!st) continue;
      const code = String(st.state).toLowerCase().replace(/[\s.-]/g, "");
      const p = AQ_POLLUTANTS.find((x) => x.codes.some((c) => c.replace(/[_.]/g, "") === code.replace(/_/g, "")));
      if (p) return p.key;
    }
    return null;
  }

  /* ---------- painting ---------- */

  _paintHero() {
    const h = this._hass;
    const e = this._els;
    const idx = this._live("daqi_uk_aqi");
    const band = idx != null ? this._band(idx) : null;
    e.hero.style.setProperty("--c", band?.c || "var(--secondary-text-color)");
    e.num.textContent = idx != null ? String(Math.round(idx)) : "–";
    this._arcs.forEach((a, i) => (a.style.opacity = idx != null && i < Math.round(idx) ? "1" : "0.16"));
    const cat = this._text(h.states[this._sid("daqi_uk_category")]);
    e.cat.textContent = band ? cat || `${band.word} pollution` : h.states[this._sid("daqi_uk_aqi")] ? "Unavailable" : "Sensors not found";
    e.adv.textContent = band ? AQ_ADVICE[band.word] : `Looking for ${this._sid("daqi_uk_aqi")}`;

    const u = this._live("universal_air_quality_index");
    e.uaqi.hidden = u == null;
    if (u != null) {
      e.uaqi.style.setProperty("--c", this._uaqiColor(u));
      e.uaqiB.textContent = `${Math.round(u)} · ${this._text(h.states[this._sid("uaqi_category")])?.replace(/ air quality$/i, "") || this._uaqiWord(u)}`;
    }
    const domSt = h.states[this._sid("daqi_uk_dominant_pollutant")] || h.states[this._sid("uaqi_dominant_pollutant")];
    const domKey = this._dominantKey();
    const domName = domKey ? AQ_POLLUTANTS.find((p) => p.key === domKey).name : this._text(domSt);
    e.dom.hidden = !domName;
    e.domB.textContent = domName || "";
  }

  _paintTiles(i) {
    const h = this._hass;
    const d = this._data;
    const dom = this._dominantKey();
    for (const p of AQ_POLLUTANTS) {
      const t = this._tiles[p.key];
      const st = h.states[this._sid(p.key)];
      t.el.hidden = !st;
      if (!st) continue;
      const unit = st.attributes.unit_of_measurement || "";
      const v = i != null && d ? d.sampled[p.key]?.[i] ?? null : this._num(st.state);
      const si = this._subIndex(p, v, unit);
      const band = si ? this._band(si) : null;
      t.el.style.setProperty("--c", band?.c || "var(--secondary-text-color)");
      t.el.classList.toggle("main", p.key === dom && i == null);
      t.el.classList.toggle("dead", v == null);
      t.v.textContent = v != null ? this._fmtVal(v) : "–";
      t.u.textContent = unit;
      t.band.textContent = band ? `${band.word} · ${si}` : "";
      t.meter.forEach((m, k) => (m.style.background = si && k < si ? AQ_BANDS[k + 1].c : ""));
      t.el.title = `${p.desc}: ${st.state} ${unit}`;
    }
  }

  _paintSparks() {
    const d = this._data;
    for (const p of AQ_POLLUTANTS) {
      const t = this._tiles[p.key];
      const st = this._hass.states[this._sid(p.key)];
      const vals = d?.sampled[p.key];
      if (!st || !vals || !vals.some((v) => v != null)) {
        t.svg.innerHTML = "";
        continue;
      }
      const unit = st.attributes.unit_of_measurement || "";
      const conv = vals.map((v) => (v == null ? null : this._ugm3(p, v, unit)));
      const present = conv.filter((v) => v != null);
      const moderate = p.bands[2]; // top of band 3: Low/Moderate boundary
      const top = Math.max(moderate * 1.15, ...present) * 1.05;
      const n = conv.length;
      const x = (k) => ((k / (n - 1)) * 100).toFixed(2);
      const y = (v) => (30 - (v / top) * 28).toFixed(2);
      const segs = [];
      let cur = [];
      conv.forEach((v, k) => {
        if (v == null) {
          if (cur.length) segs.push(cur);
          cur = [];
        } else cur.push(`${x(k)},${y(v)}`);
      });
      if (cur.length) segs.push(cur);
      const peak = this._band(1 + p.bands.filter((b) => Math.max(...present) > b).length).c;
      const gid = `aq-g-${p.key}`;
      t.svg.innerHTML = `
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${peak}" stop-opacity="0.35"></stop><stop offset="1" stop-color="${peak}" stop-opacity="0"></stop></linearGradient></defs>
        <line class="th" x1="0" x2="100" y1="${y(moderate)}" y2="${y(moderate)}"></line>
        ${segs.map((s) => `<polygon fill="url(#${gid})" points="${s[0].split(",")[0]},30 ${s.join(" ")} ${s[s.length - 1].split(",")[0]},30"></polygon><polyline class="sl" stroke="${peak}" points="${s.join(" ")}"></polyline>`).join("")}`;
    }
  }

  _paintLegend(i) {
    const d = this._data;
    const lg = this._els.legend;
    const idx = i != null && d ? d.index[i] : this._live("daqi_uk_aqi");
    const uq = i != null && d ? d.sampled.universal_air_quality_index?.[i] : this._live("universal_air_quality_index");
    const multi = d && d.end - d.start > 26 * AQ_HOUR;
    const when = i != null && d ? `${this._time(d.times[i], multi)}${d.step > AQ_HOUR ? ` +${Math.round(d.step / AQ_HOUR)} h` : ""}` : "Now";
    const parts = [`<span class="lg when"></span>`];
    if (idx != null) {
      const b = this._band(idx);
      parts.push(`<span class="lg" style="--c:${b.c}"><span class="sw col"></span>DAQI <b>${Math.round(idx)}</b> ${b.word}</span>`);
    }
    if (uq != null) parts.push(`<span class="lg" style="--c:var(--primary-text-color)"><span class="sw"></span>Universal <b>${Math.round(uq)}</b></span>`);
    lg.innerHTML = parts.join("");
    lg.querySelector(".when").textContent = when;
  }

  /* ---------- data ---------- */

  async _fetch() {
    const h = this._hass;
    const numeric = ["daqi_uk_aqi", "universal_air_quality_index", ...AQ_POLLUTANTS.map((p) => p.key)];
    const ids = numeric.map((k) => this._sid(k)).filter((id) => h.states[id]);
    if (!ids.length) {
      this._els.body.innerHTML = `<div class="msg">Sensors not found. Check prefix.</div>`;
      this._fetchedAt = Date.now();
      return;
    }
    this._loading = true;
    const end = Date.now();
    const start = end - this._hours * AQ_HOUR;
    try {
      const res = await h.callWS({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const series = {};
      for (const k of numeric) {
        series[k] = (res?.[this._sid(k)] || [])
          .map((e) => ({
            t: e.lu != null ? e.lu * 1000 : e.lc != null ? e.lc * 1000 : Date.parse(e.last_changed || e.last_updated),
            v: this._num(e.s ?? e.state),
          }))
          .filter((x) => Number.isFinite(x.t))
          .sort((a, b) => a.t - b.t);
      }
      // Hourly buckets up to 3 days, then 2-hourly
      const step = this._hours <= 72 ? AQ_HOUR : 2 * AQ_HOUR;
      const nb = Math.max(2, Math.round((end - start) / step));
      const times = [];
      for (let i = 0; i < nb; i++) times.push(start + i * step);
      const sampled = {};
      for (const k of numeric) sampled[k] = times.map((t) => this._at(series[k], Math.min(end, t + step)));
      // DAQI column = worst value in the bucket
      const index = times.map((t) => {
        const s = series.daqi_uk_aqi;
        let worst = this._at(s, t);
        for (const p of s) if (p.t > t && p.t <= t + step && p.v != null) worst = worst == null ? p.v : Math.max(worst, p.v);
        return worst;
      });
      this._data = { start, end, step, times, series, sampled, index };
      this._error = false;
    } catch (err) {
      console.warn("air-quality-card: could not load history", err);
      this._error = true;
    } finally {
      this._loading = false;
      this._fetchedAt = Date.now();
      this._paintChart();
      this._paintSparks();
      this._paintTiles(null);
    }
  }

  _at(series, t) {
    let lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best >= 0 ? series[best].v : null;
  }

  _paintChart() {
    const body = this._els.body;
    const d = this._data;
    if (this._error || !d) {
      body.innerHTML = `<div class="msg">Couldn't load history. Check that the recorder is running.</div>`;
      return;
    }
    const n = d.times.length;
    const hasIdx = d.index.some((v) => v != null);
    const uq = d.sampled.universal_air_quality_index || [];
    const hasU = uq.some((v) => v != null);
    if (!hasIdx && !hasU) {
      body.innerHTML = `<div class="msg">No history yet for this period.</div>`;
      this._paintLegend(null);
      return;
    }
    const W = 1000;
    const yI = (v) => 100 - (v / 10) * 96;
    const yU = (v) => 100 - (v / 100) * 96;
    const bw = (W / n) * 0.72;
    const cols = d.index
      .map((v, i) => (v == null ? "" : `<rect x="${((i / n) * W + (W / n - bw) / 2).toFixed(1)}" y="${yI(Math.max(0.4, v)).toFixed(2)}" width="${bw.toFixed(1)}" height="${(100 - yI(Math.max(0.4, v))).toFixed(2)}" rx="2" fill="${this._band(v).c}" opacity="0.8"></rect>`))
      .join("");
    const xc = (i) => (((i + 0.5) / n) * W).toFixed(1);
    const segs = [];
    let cur = [];
    uq.forEach((v, i) => {
      if (v == null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else cur.push(`${xc(i)},${yU(v).toFixed(2)}`);
    });
    if (cur.length) segs.push(cur);
    const multi = d.end - d.start > 26 * AQ_HOUR;
    const span = d.end - d.start;

    body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid">${[3, 6, 9].map((k) => `<line x1="0" x2="${W}" y1="${yI(k)}" y2="${yI(k)}"></line>`).join("")}<line x1="0" x2="${W}" y1="100" y2="100"></line></g>
          ${cols}
          ${segs.map((s) => `<polyline class="uq" points="${s.join(" ")}"></polyline>`).join("")}
        </svg>
        <div class="cursor"></div>
        ${hasIdx ? [3, 6, 9].map((k) => `<span class="ax l" style="top:${yI(k) * 1.2}px">${k}</span>`).join("") : ""}
        ${hasU ? `<span class="ax r" style="top:${yU(100) * 1.2}px">100</span><span class="ax r" style="top:${yU(50) * 1.2}px">50</span>` : ""}
        <div class="times"><span>${this._time(d.start, multi)}</span><span>${this._time(d.start + span / 2, multi)}</span><span>Now</span></div>
      </div>`;

    const plot = body.querySelector(".plot");
    const svg = body.querySelector("svg");
    const cursor = body.querySelector(".cursor");
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const pbox = plot.getBoundingClientRect();
      const f = Math.min(0.9999, Math.max(0, (ev.clientX - box.left) / box.width));
      const i = Math.floor(f * n);
      this._scrub = i;
      cursor.style.left = `${box.left - pbox.left + ((i + 0.5) / n) * box.width}px`;
      plot.classList.add("scrub");
      this._els.card.classList.add("scrubbing");
      for (const t of Object.values(this._tiles)) t.sc.style.left = `${(i / (n - 1)) * 100}%`;
      this._paintLegend(i);
      this._paintTiles(i);
    };
    const leave = () => {
      this._scrub = null;
      plot.classList.remove("scrub");
      this._els.card.classList.remove("scrubbing");
      this._paintLegend(null);
      this._paintTiles(null);
    };
    plot.addEventListener("pointermove", move);
    plot.addEventListener("pointerdown", move);
    plot.addEventListener("pointerleave", leave);
    plot.addEventListener("pointercancel", leave);
    this._paintLegend(null);
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("air-quality-card")) customElements.define("air-quality-card", AirQualityCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "air-quality-card",
  name: "Air Quality Card",
  description: "UK DAQI gauge, pollutant tiles with bands and sparklines, and a history graph",
});
