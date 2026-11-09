/**
 * weather-forecast-card  (v1)
 * Same look as climate-overview-card, heating-dial-card and appliance-dial-card.
 *
 * - Hero: condition, temperature, feels like, today's high and low, and a plain
 *   sentence about rain (or frost) over the next 12 hours.
 * - Six stats: wind (arrow points the way the wind blows), rain, UV, humidity,
 *   pressure (with 3-hour trend) and visibility.
 * - Hourly graph: temperature coloured by warmth, feels-like dashed, rain chance
 *   bars, condition icons, wind arrows. Hover or drag to read any hour.
 * - Daily list: icon, rain chance, low/high with a range bar on a shared scale.
 *
 * Config:
 *   type: custom:weather-forecast-card
 *   entity: weather.bergholt_road
 *   prefix: sensor.bergholt_road   # optional, default sensor.<weather object id>
 *   sensors: { uv_index: sensor.other_uv }   # optional overrides per key
 *   hours: 24
 *   ranges: [12, 24, 48]
 *   view: hourly                   # or daily
 *
 * Sensor keys read from <prefix>_<key> when they exist (otherwise the weather
 * entity's own attributes are used): apparent_temperature, atmospheric_pressure,
 * cloud_coverage, dew_point, humidity, precipitation_intensity,
 * precipitation_probability, temperature, thunderstorm_probability, uv_index,
 * visibility, wind_direction, wind_gust_speed, wind_speed.
 *
 * Install: copy to /config/www/weather-forecast-card.js and add the resource
 * /local/weather-forecast-card.js?v=1 (type: JavaScript module).
 */

const WF_HOUR = 3600000;
const WF_TREND_MS = 10 * 60 * 1000;

const WF_COND = {
  "clear-night": { icon: "mdi:weather-night", label: "Clear", color: "#9fa8da" },
  cloudy: { icon: "mdi:weather-cloudy", label: "Cloudy", color: "#90a4ae" },
  exceptional: { icon: "mdi:alert-circle-outline", label: "Exceptional", color: "#ef5350" },
  fog: { icon: "mdi:weather-fog", label: "Fog", color: "#b0bec5" },
  hail: { icon: "mdi:weather-hail", label: "Hail", color: "#80deea" },
  lightning: { icon: "mdi:weather-lightning", label: "Thunder", color: "#ab47bc" },
  "lightning-rainy": { icon: "mdi:weather-lightning-rainy", label: "Thunderstorms", color: "#ab47bc" },
  partlycloudy: { icon: "mdi:weather-partly-cloudy", night: "mdi:weather-night-partly-cloudy", label: "Partly cloudy", color: "#ffb74d" },
  pouring: { icon: "mdi:weather-pouring", label: "Heavy rain", color: "#1e88e5" },
  rainy: { icon: "mdi:weather-rainy", label: "Rain", color: "#42a5f5" },
  snowy: { icon: "mdi:weather-snowy", label: "Snow", color: "#90caf9" },
  "snowy-rainy": { icon: "mdi:weather-snowy-rainy", label: "Sleet", color: "#81d4fa" },
  sunny: { icon: "mdi:weather-sunny", night: "mdi:weather-night", label: "Sunny", color: "#ffca28" },
  windy: { icon: "mdi:weather-windy", label: "Windy", color: "#80cbc4" },
  "windy-variant": { icon: "mdi:weather-windy-variant", label: "Windy", color: "#80cbc4" },
};
const WF_WET = new Set(["rainy", "pouring", "lightning-rainy", "snowy", "snowy-rainy", "hail"]);

// sensor key -> [weather attribute, weather unit attribute or fixed unit]
const WF_ATTR = {
  apparent_temperature: ["apparent_temperature", "temperature_unit"],
  atmospheric_pressure: ["pressure", "pressure_unit"],
  cloud_coverage: ["cloud_coverage", "%"],
  dew_point: ["dew_point", "temperature_unit"],
  humidity: ["humidity", "%"],
  temperature: ["temperature", "temperature_unit"],
  uv_index: ["uv_index", ""],
  visibility: ["visibility", "visibility_unit"],
  wind_direction: ["wind_bearing", "°"],
  wind_gust_speed: ["wind_gust_speed", "wind_speed_unit"],
  wind_speed: ["wind_speed", "wind_speed_unit"],
};
const WF_KEYS = [
  "apparent_temperature", "atmospheric_pressure", "cloud_coverage", "dew_point", "humidity", "precipitation_intensity",
  "precipitation_probability", "temperature", "thunderstorm_probability", "uv_index", "visibility", "wind_direction",
  "wind_gust_speed", "wind_speed",
];
const WF_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
// Temperature colour stops in °C
const WF_TEMP_STOPS = [[-10, "#7986cb"], [0, "#64b5f6"], [7, "#4dd0e1"], [13, "#aed581"], [19, "#ffd54f"], [25, "#ff8a65"], [32, "#e53935"]];

const WF_STYLE = `
  ha-card { padding: 12px; container-type: inline-size; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .panel { border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .disc {
    flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent);
  }

  .hero { display: block; width: 100%; padding: 12px; }
  .hero:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .h-row { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .hero .disc { width: 52px; height: 52px; }
  .hero .disc ha-icon { --mdc-icon-size: 32px; }
  .h-temp { display: flex; align-items: flex-start; line-height: 1; flex: none; }
  .h-temp .v { font-size: 40px; font-weight: 400; font-variant-numeric: tabular-nums; }
  .h-temp .u { font-size: 15px; margin: 4px 0 0 3px; color: var(--secondary-text-color); }
  .h-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
  .h-cond { font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h-sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .h-hl { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 13px; font-variant-numeric: tabular-nums; }
  .h-hl span { white-space: nowrap; }
  .h-hl .lbl { color: var(--secondary-text-color); font-size: 12px; margin-right: 3px; }
  .summary { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 9px; font-size: 13px;
    border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .summary[hidden] { display: none; }
  .summary ha-icon { --mdc-icon-size: 16px; color: var(--c); flex: none; }
  .summary span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @container (max-width: 340px) { .h-hl { display: none; } }

  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
  @container (min-width: 600px) { .stats { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
  .stat { display: flex; flex-direction: column; min-width: 0; padding: 8px 10px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .stat:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .s-head { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; }
  .s-head ha-icon { --mdc-icon-size: 15px; color: var(--c); flex: none; transition: transform 0.4s; }
  .s-head span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-val { margin-top: 5px; font-size: 18px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .s-val small { font-size: 11px; color: var(--secondary-text-color); margin-left: 2px; }
  .s-sub { font-size: 11px; color: var(--secondary-text-color); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .s-sub.hot { color: var(--c); }

  .chart { margin-top: 6px; padding: 10px 12px 10px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
  .seg { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .seg button { color: var(--secondary-text-color); font-size: 12px; padding: 3px 8px; border-radius: 8px; }
  .seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }
  .seg[hidden] { display: none; }
  .readout { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; margin-top: 8px; min-height: 18px; font-size: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .rd { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .rd b { font-weight: 500; color: var(--primary-text-color); }
  .rd.when b { font-weight: 500; }
  .sw { width: 10px; height: 3px; border-radius: 2px; background: var(--c); }
  .sw.dash { background: repeating-linear-gradient(90deg, var(--c) 0 3px, transparent 3px 5px); }
  .sw.bar { width: 8px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--c) 55%, transparent); }
  .rd ha-icon { --mdc-icon-size: 14px; color: var(--c); }

  .plot { position: relative; margin: 6px 4px 0; height: 186px; touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
  .plot svg { position: absolute; left: 0; top: 34px; display: block; width: 100%; height: 110px; overflow: visible; }
  .ln { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; stroke-width: 2.5; }
  .ln.feels { stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.7; }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .ov { position: absolute; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; pointer-events: none;
    font-size: 11px; line-height: 1; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ov.ic { top: 0; gap: 2px; }
  .ov.ic ha-icon { --mdc-icon-size: 20px; color: var(--c); }
  .ov.ic .p { color: #42a5f5; font-size: 10px; min-height: 10px; }
  .ov.tm { top: 150px; }
  .ov.wd { top: 166px; flex-direction: row; gap: 1px; }
  .ov.wd ha-icon { --mdc-icon-size: 12px; }
  .ov.tl { font-size: 12px; font-weight: 500; color: var(--primary-text-color); }
  .cursor { position: absolute; top: 30px; height: 118px; width: 1px; background: var(--primary-text-color); opacity: 0.45; pointer-events: none; display: none; transform: translateX(-50%); }
  .dot { position: absolute; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--card-background-color, #1c1c1c);
    transform: translate(-50%, -50%); pointer-events: none; display: none; }
  .plot.scrub .cursor, .plot.scrub .dot { display: block; }
  .plot.scrub .tl { opacity: 0.25; }

  .days { margin-top: 6px; display: flex; flex-direction: column; }
  .day { display: grid; grid-template-columns: 52px 26px 36px 34px minmax(40px, 1fr) 34px; align-items: center; gap: 6px;
    padding: 6px 0; font-size: 13px; font-variant-numeric: tabular-nums; }
  .day + .day { border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .day .dn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .day ha-icon { --mdc-icon-size: 20px; color: var(--c); }
  .day .rp { font-size: 11px; color: #42a5f5; }
  .day .lo { color: var(--secondary-text-color); text-align: right; }
  .day .hi { text-align: left; }
  .track { position: relative; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
  .now { position: absolute; top: 50%; width: 8px; height: 8px; border-radius: 50%; background: var(--primary-text-color);
    border: 2px solid var(--card-background-color, #1c1c1c); transform: translate(-50%, -50%); }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
`;

class WeatherForecastCard extends HTMLElement {
  static getStubConfig(hass) {
    const w = Object.keys(hass?.states || {}).find((e) => e.startsWith("weather."));
    return { entity: w || "weather.home" };
  }

  setConfig(config) {
    if (!config?.entity || !String(config.entity).startsWith("weather.")) throw new Error("Set entity to a weather entity, e.g. weather.bergholt_road");
    const changed = this._config?.entity !== config.entity;
    this._config = { hours: 24, ranges: [12, 24, 48], view: "hourly", ...config };
    this._hours = Number(this._config.hours) || 24;
    this._view = this._config.view === "daily" ? "daily" : "hourly";
    const obj = config.entity.split(".")[1];
    this._prefix = String(config.prefix || `sensor.${obj}`).replace(/_$/, "");
    if (!this._prefix.includes(".")) this._prefix = `sensor.${this._prefix}`;
    if (changed || !this._fc) {
      this._unsubscribe();
      this._fc = { hourly: null, daily: null };
    }
    this._scrub = null;
    this._lastKey = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    if (this._hass) this.hass = this._hass;
  }

  connectedCallback() {
    this._connected = true;
    this._subscribe();
  }

  disconnectedCallback() {
    this._connected = false;
    this._unsubscribe();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._els) return;
    this._subscribe();
    // Only repaint when something we show has changed
    const ids = [this._config.entity, "sun.sun", ...WF_KEYS.map((k) => this._sid(k))];
    const key = ids.map((id) => hass.states[id]);
    if (this._lastKey && key.every((s, i) => s === this._lastKey[i])) return;
    this._lastKey = key;
    if (Date.now() - (this._trendAt || 0) > WF_TREND_MS) this._fetchTrend();
    this._paintNow();
    if (this._view === "daily") this._paintChart();
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- forecast subscription ---------- */

  _subscribe() {
    if (this._subs || !this._hass || !this._connected || !this._config) return;
    const st = this._hass.states[this._config.entity];
    if (!st || !this._hass.connection) return;
    const feat = Number(st.attributes.supported_features) || 0;
    this._subs = [];
    for (const [type, bit] of [["hourly", 2], ["daily", 1]]) {
      if (!(feat & bit)) continue;
      const p = this._hass.connection
        .subscribeMessage(
          (msg) => {
            this._fc[type] = Array.isArray(msg?.forecast) ? msg.forecast : [];
            this._paintNow();
            this._paintChart();
          },
          { type: "weather/subscribe_forecast", forecast_type: type, entity_id: this._config.entity }
        )
        .catch((err) => {
          console.warn(`weather-forecast-card: ${type} forecast unavailable`, err);
          this._fc[type] = [];
          this._paintChart();
          return null;
        });
      this._subs.push(p);
    }
    if (!this._subs.length) this._paintChart();
  }

  _unsubscribe() {
    for (const p of this._subs || []) p.then((un) => typeof un === "function" && un()).catch(() => {});
    this._subs = null;
  }

  /* ---------- layout ---------- */

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${WF_STYLE}</style>
      <ha-card>
        <button class="panel hero">
          <div class="h-row">
            <span class="disc"><ha-icon></ha-icon></span>
            <div class="h-temp"><span class="v">–</span><span class="u"></span></div>
            <div class="h-text"><span class="h-cond"></span><span class="h-sub s1"></span><span class="h-sub s2"></span></div>
            <div class="h-hl"><span><span class="lbl">High</span><b class="hi">–</b></span><span><span class="lbl">Low</span><b class="lo">–</b></span></div>
          </div>
          <div class="summary"><ha-icon></ha-icon><span></span></div>
        </button>
        <div class="stats"></div>
        <div class="panel chart">
          <div class="top">
            <div class="seg views" role="group" aria-label="Forecast view"></div>
            <div class="seg ranges" role="group" aria-label="Hours shown"></div>
          </div>
          <div class="body"><div class="msg">Loading forecast…</div></div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      hero: $(".hero"), disc: $(".hero .disc"), icon: $(".hero .disc ha-icon"), v: $(".h-temp .v"), u: $(".h-temp .u"),
      cond: $(".h-cond"), s1: $(".h-sub.s1"), s2: $(".h-sub.s2"), hi: $(".h-hl .hi"), lo: $(".h-hl .lo"),
      summary: $(".summary"), sumIcon: $(".summary ha-icon"), sumText: $(".summary span"),
      stats: $(".stats"), views: $(".views"), ranges: $(".ranges"), body: $(".body"),
    };
    this._els.hero.addEventListener("click", () => this._moreInfo(this._config.entity));

    this._stats = {};
    const defs = [
      ["wind", "Wind", "mdi:navigation", "#80cbc4", "wind_speed"],
      ["rain", "Rain", "mdi:umbrella-outline", "#42a5f5", "precipitation_probability"],
      ["uv", "UV", "mdi:sun-wireless-outline", "#ffca28", "uv_index"],
      ["humidity", "Humidity", "mdi:water-percent", "#4fc3f7", "humidity"],
      ["pressure", "Pressure", "mdi:gauge", "#b39ddb", "atmospheric_pressure"],
      ["visibility", "Visibility", "mdi:eye-outline", "#a5d6a7", "visibility"],
    ];
    for (const [key, name, icon, color, sensor] of defs) {
      const b = document.createElement("button");
      b.className = "stat";
      b.style.setProperty("--c", color);
      b.innerHTML = `<div class="s-head"><ha-icon></ha-icon><span></span></div><div class="s-val">–</div><div class="s-sub"></div>`;
      b.querySelector("ha-icon").setAttribute("icon", icon);
      b.querySelector(".s-head span").textContent = name;
      b.addEventListener("click", () => {
        const id = this._sid(sensor);
        this._moreInfo(this._hass?.states[id] ? id : this._config.entity);
      });
      this._els.stats.append(b);
      this._stats[key] = { el: b, icon: b.querySelector("ha-icon"), val: b.querySelector(".s-val"), sub: b.querySelector(".s-sub") };
    }

    for (const [v, label] of [["hourly", "Hourly"], ["daily", "Daily"]]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.v = v;
      b.setAttribute("aria-pressed", String(v === this._view));
      b.addEventListener("click", () => {
        if (this._view === v) return;
        this._view = v;
        this._syncButtons();
        this._paintChart();
      });
      this._els.views.append(b);
    }
    for (const hrs of this._config.ranges) {
      const b = document.createElement("button");
      b.textContent = `${hrs} h`;
      b.dataset.h = hrs;
      b.addEventListener("click", () => {
        if (this._hours === hrs) return;
        this._hours = hrs;
        this._syncButtons();
        this._paintChart();
      });
      this._els.ranges.append(b);
    }
    this._syncButtons();
  }

  _syncButtons() {
    this._els.views.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === this._view)));
    this._els.ranges.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.h) === this._hours)));
    this._els.ranges.hidden = this._view !== "hourly";
  }

  /* ---------- helpers ---------- */

  _sid(key) {
    return this._config.sensors?.[key] || `${this._prefix}_${key}`;
  }

  _w() {
    return this._hass?.states[this._config.entity];
  }

  _num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _fmt(v, d = 1) {
    return new Intl.NumberFormat(this._hass?.locale?.language, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }

  _deg(v) {
    // One decimal unless it is a whole number
    return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : this._fmt(v);
  }

  _time(t, opts = {}) {
    return new Date(t).toLocaleTimeString(this._hass?.locale?.language, { hour: "2-digit", minute: "2-digit", ...opts });
  }

  _day(t) {
    return new Date(t).toLocaleDateString(this._hass?.locale?.language, { weekday: "short" });
  }

  _get(key) {
    const h = this._hass;
    const s = h.states[this._sid(key)];
    if (s) {
      const v = this._num(s.state);
      if (v != null) return { v, u: s.attributes.unit_of_measurement || "" };
    }
    const w = this._w();
    const a = WF_ATTR[key];
    if (w && a) {
      const v = this._num(w.attributes[a[0]]);
      if (v != null) return { v, u: a[1].endsWith("_unit") ? w.attributes[a[1]] || "" : a[1] };
    }
    return null;
  }

  _tUnit() {
    return this._w()?.attributes.temperature_unit || "°C";
  }

  _toC(v) {
    return this._tUnit().includes("F") ? ((v - 32) * 5) / 9 : v;
  }

  _tempColor(v) {
    const c = this._toC(v);
    const s = WF_TEMP_STOPS;
    if (c <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (c <= s[i][0]) {
        const f = (c - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        return this._mix(s[i - 1][1], s[i][1], f);
      }
    }
    return s[s.length - 1][1];
  }

  _mix(a, b, f) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, "0")).join("")}`;
  }

  _cond(c, night) {
    const d = WF_COND[c] || { icon: "mdi:weather-cloudy-alert", label: c ? String(c).replace(/[-_]/g, " ") : "Unknown", color: "#90a4ae" };
    return { ...d, icon: night && d.night ? d.night : d.icon };
  }

  _isNight(f) {
    if (f && f.is_daytime != null) return f.is_daytime === false;
    if (!f) return this._hass.states["sun.sun"]?.state === "below_horizon";
    const h = new Date(f.t).getHours();
    return h < 6 || h >= 20;
  }

  _compass(deg) {
    if (deg == null) return "";
    return WF_COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  }

  _bearing(v) {
    const n = this._num(v);
    if (n != null) return n;
    const i = WF_COMPASS.indexOf(String(v || "").toUpperCase());
    return i >= 0 ? i * 22.5 : null;
  }

  _uvLevel(uv) {
    if (uv < 3) return ["Low", "#9ccc65"];
    if (uv < 6) return ["Moderate", "#ffca28"];
    if (uv < 8) return ["High", "#ffa726"];
    if (uv < 11) return ["Very high", "#ef5350"];
    return ["Extreme", "#ab47bc"];
  }

  _visWord(v, u) {
    const km = /mi/.test(u) ? v * 1.609 : /^m$/.test(u) ? v / 1000 : v;
    if (km >= 20) return "Very good";
    if (km >= 10) return "Good";
    if (km >= 4) return "Moderate";
    if (km >= 1) return "Poor";
    return "Fog";
  }

  _hourly() {
    const now = Date.now();
    return (this._fc.hourly || [])
      .map((f) => ({ ...f, t: Date.parse(f.datetime) }))
      .filter((f) => Number.isFinite(f.t) && f.t > now - WF_HOUR)
      .sort((a, b) => a.t - b.t);
  }

  _daily() {
    return (this._fc.daily || [])
      .map((f) => ({ ...f, t: Date.parse(f.datetime) }))
      .filter((f) => Number.isFinite(f.t))
      .sort((a, b) => a.t - b.t);
  }

  _todayHighLow() {
    const today = new Date().toDateString();
    const d = this._daily().find((f) => new Date(f.t).toDateString() === today);
    if (d && this._num(d.temperature) != null) return [this._num(d.temperature), this._num(d.templow)];
    const hrs = this._hourly().filter((f) => new Date(f.t).toDateString() === today).map((f) => this._num(f.temperature)).filter((v) => v != null);
    const cur = this._get("temperature")?.v;
    if (cur != null) hrs.push(cur);
    return hrs.length ? [Math.max(...hrs), Math.min(...hrs)] : [null, null];
  }

  _summary() {
    const hrs = this._hourly().slice(0, 12);
    const w = this._w();
    if (!hrs.length) return null;
    const wet = (f) => (this._num(f.precipitation_probability) ?? 0) >= 50 || WF_WET.has(f.condition);
    const pct = (f) => this._num(f.precipitation_probability);
    const nowWet = WF_WET.has(w?.state) || wet(hrs[0]);
    let text;
    let icon;
    let color = "#42a5f5";
    if (nowWet) {
      const dry = hrs.findIndex((f, i) => i > 0 && !wet(f));
      icon = "mdi:umbrella";
      text = dry > 0 ? `Rain easing around ${this._time(hrs[dry].t)}` : `Wet for the next ${hrs.length} hours`;
    } else {
      const i = hrs.findIndex(wet);
      if (i >= 0) {
        icon = "mdi:umbrella-outline";
        const p = pct(hrs[i]);
        text = `Rain likely from ${this._time(hrs[i].t)}${p != null ? ` (${Math.round(p)}%)` : ""}`;
      } else {
        const maxP = Math.max(0, ...hrs.map((f) => pct(f) ?? 0));
        icon = "mdi:weather-partly-cloudy";
        color = "#ffca28";
        text = `Dry for the next ${hrs.length} hours${maxP >= 20 ? `, ${Math.round(maxP)}% chance of a shower` : ""}`;
      }
    }
    // Frost or heat in the next 24 h
    const day = this._hourly().slice(0, 24);
    const temps = day.map((f) => ({ t: f.t, v: this._num(f.temperature) })).filter((x) => x.v != null);
    if (temps.length) {
      const low = temps.reduce((a, b) => (b.v < a.v ? b : a));
      if (this._toC(low.v) <= 1) text += ` · Frost risk, ${this._deg(low.v)}° at ${this._time(low.t)}`;
    }
    return { text, icon, color };
  }

  /* ---------- current conditions ---------- */

  _paintNow() {
    const h = this._hass;
    if (!h || !this._els) return;
    const e = this._els;
    const w = this._w();
    if (!w) {
      e.cond.textContent = "Weather entity not found";
      e.s1.textContent = this._config.entity;
      return;
    }
    const night = this._isNight(null);
    const c = this._cond(w.state, night);
    e.hero.style.setProperty("--c", c.color);
    e.icon.setAttribute("icon", c.icon);
    const t = this._get("temperature");
    e.v.textContent = t ? this._deg(t.v) : "–";
    e.u.textContent = t?.u || this._tUnit();
    const formatted = typeof h.formatEntityState === "function" ? h.formatEntityState(w) : null;
    e.cond.textContent = formatted && formatted !== w.state ? formatted : c.label;
    const feels = this._get("apparent_temperature");
    const cloud = this._get("cloud_coverage");
    e.s1.textContent = feels ? `Feels like ${this._deg(feels.v)}°` : "";
    e.s2.textContent = cloud ? `Cloud ${Math.round(cloud.v)}%` : "";
    const [hi, lo] = this._todayHighLow();
    e.hi.textContent = hi != null ? `${this._deg(hi)}°` : "–";
    e.lo.textContent = lo != null ? `${this._deg(lo)}°` : "–";
    const sum = this._summary();
    e.summary.hidden = !sum;
    if (sum) {
      e.summary.style.setProperty("--c", sum.color);
      e.sumIcon.setAttribute("icon", sum.icon);
      e.sumText.textContent = sum.text;
    }
    this._paintStats();
  }

  _paintStats() {
    const s = this._stats;
    const val = (el, v, u) => {
      el.innerHTML = "";
      el.append(document.createTextNode(v));
      if (u) {
        const sm = document.createElement("small");
        sm.textContent = u;
        el.append(sm);
      }
    };
    const hrs = this._hourly();

    // Wind
    const ws = this._get("wind_speed");
    const wg = this._get("wind_gust_speed");
    const wdS = this._hass.states[this._sid("wind_direction")];
    const bearing = this._bearing(wdS?.state) ?? this._bearing(this._w()?.attributes.wind_bearing);
    if (ws) val(s.wind.val, String(Math.round(ws.v)), ws.u);
    else val(s.wind.val, "–");
    s.wind.icon.style.transform = bearing != null ? `rotate(${bearing + 180}deg)` : "";
    s.wind.sub.textContent = [wg ? `Gusts ${Math.round(wg.v)}` : "", bearing != null ? `from ${this._compass(bearing)}` : ""].filter(Boolean).join(" · ");

    // Rain
    const pp = this._get("precipitation_probability") ?? (hrs[0] && this._num(hrs[0].precipitation_probability) != null ? { v: this._num(hrs[0].precipitation_probability), u: "%" } : null);
    val(s.rain.val, pp ? String(Math.round(pp.v)) : "–", pp ? "%" : "");
    const pi = this._get("precipitation_intensity");
    const th = this._get("thunderstorm_probability");
    const total = hrs.slice(0, 24).reduce((a, f) => a + (this._num(f.precipitation) ?? 0), 0);
    const pUnit = this._w()?.attributes.precipitation_unit || "mm";
    s.rain.sub.classList.toggle("hot", !!(pi && pi.v > 0) || !!(th && th.v >= 20));
    if (th && th.v >= 20) s.rain.sub.textContent = `Thunder ${Math.round(th.v)}%`;
    else if (pi && pi.v > 0) s.rain.sub.textContent = `Now ${this._fmt(pi.v)} ${pi.u}`;
    else if (total > 0) s.rain.sub.textContent = `${this._fmt(total)} ${pUnit} next 24 h`;
    else s.rain.sub.textContent = hrs.length ? "None expected" : "";

    // UV
    const uv = this._get("uv_index");
    if (uv) {
      const [word, color] = this._uvLevel(uv.v);
      s.uv.el.style.setProperty("--c", color);
      val(s.uv.val, this._deg(uv.v), word);
    } else val(s.uv.val, "–");
    const today = new Date().toDateString();
    const uvHrs = hrs.filter((f) => new Date(f.t).toDateString() === today && this._num(f.uv_index) != null);
    if (uvHrs.length) {
      const pk = uvHrs.reduce((a, b) => (this._num(b.uv_index) > this._num(a.uv_index) ? b : a));
      s.uv.sub.textContent = this._num(pk.uv_index) > (uv?.v ?? 0) ? `Peak ${this._deg(this._num(pk.uv_index))} at ${this._time(pk.t)}` : "Peak has passed";
    } else s.uv.sub.textContent = "";

    // Humidity
    const hu = this._get("humidity");
    const dp = this._get("dew_point");
    val(s.humidity.val, hu ? String(Math.round(hu.v)) : "–", hu ? "%" : "");
    s.humidity.sub.textContent = dp ? `Dew point ${this._deg(dp.v)}°` : "";

    // Pressure
    const pr = this._get("atmospheric_pressure");
    val(s.pressure.val, pr ? String(Math.round(pr.v)) : "–", pr?.u || "");
    if (this._trend != null && pr) {
      const d = this._trend;
      const step = /inHg/i.test(pr.u) ? 0.03 : 1;
      s.pressure.sub.textContent = Math.abs(d) < step ? "Steady" : `${d > 0 ? "Rising" : "Falling"} ${this._fmt(Math.abs(d), step < 1 ? 2 : 1)} in 3 h`;
    } else if (pr) {
      const hpa = /inHg/i.test(pr.u) ? pr.v * 33.86 : /kPa/i.test(pr.u) ? pr.v * 10 : pr.v;
      s.pressure.sub.textContent = hpa < 1000 ? "Low" : hpa > 1022 ? "High" : "Normal";
    } else s.pressure.sub.textContent = "";

    // Visibility
    const vis = this._get("visibility");
    val(s.visibility.val, vis ? this._deg(vis.v) : "–", vis?.u || "");
    s.visibility.sub.textContent = vis ? this._visWord(vis.v, vis.u) : "";
  }

  async _fetchTrend() {
    this._trendAt = Date.now();
    const id = this._sid("atmospheric_pressure");
    if (!this._hass.states[id] || typeof this._hass.callWS !== "function") return;
    const end = Date.now();
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(end - 3 * WF_HOUR).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: [id],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const pts = (res?.[id] || []).map((e) => this._num(e.s ?? e.state)).filter((v) => v != null);
      const cur = this._num(this._hass.states[id]?.state);
      this._trend = pts.length && cur != null ? cur - pts[0] : null;
    } catch (err) {
      this._trend = null;
    }
    this._paintStats();
  }

  /* ---------- graph ---------- */

  _paintChart() {
    if (!this._els || !this._hass) return;
    if (this._view === "daily") this._paintDaily();
    else this._paintHourly();
  }

  _msg(text) {
    this._els.body.innerHTML = `<div class="msg"></div>`;
    this._els.body.firstChild.textContent = text;
  }

  _paintHourly() {
    const w = this._w();
    if (!w) return this._msg("Weather entity not found.");
    if (this._fc.hourly == null) {
      const feat = Number(w.attributes.supported_features) || 0;
      return this._msg(feat & 2 ? "Loading forecast…" : "This weather entity has no hourly forecast.");
    }
    const pts = this._hourly().slice(0, this._hours);
    const n = pts.length;
    if (n < 2) return this._msg("No hourly forecast yet.");
    const W = 1000;
    const tv = pts.map((f) => this._num(f.temperature));
    const fv = pts.map((f) => this._num(f.apparent_temperature));
    const pv = pts.map((f) => this._num(f.precipitation_probability));
    const all = [...tv, ...fv].filter((v) => v != null);
    let lo = all.length ? Math.floor(Math.min(...all)) : 0;
    let hi = all.length ? Math.ceil(Math.max(...all)) : 1;
    if (hi - lo < 4) {
      const mid = (hi + lo) / 2;
      lo = Math.floor(mid - 2);
      hi = Math.ceil(mid + 2);
    }
    const xc = (i) => ((i + 0.5) / n) * W;
    const pct = (i) => ((i + 0.5) / n) * 100;
    const yT = (v) => 8 + (1 - (v - lo) / (hi - lo)) * 58;
    const line = (vals) => {
      const segs = [];
      let cur = [];
      vals.forEach((v, i) => {
        if (v == null) {
          if (cur.length) segs.push(cur);
          cur = [];
        } else cur.push(`${xc(i).toFixed(1)},${yT(v).toFixed(2)}`);
      });
      if (cur.length) segs.push(cur);
      return segs;
    };
    const tSegs = line(tv);
    const fSegs = line(fv);
    const area = tSegs.map((s) => {
      const first = s[0].split(",")[0];
      const last = s[s.length - 1].split(",")[0];
      return `<polygon fill="url(#wf-area)" points="${first},100 ${s.join(" ")} ${last},100"></polygon>`;
    }).join("");
    const bw = Math.max(2, (W / n) * 0.62);
    const bars = pv.map((p, i) => (p ? `<rect x="${(xc(i) - bw / 2).toFixed(1)}" y="${(100 - p * 0.3).toFixed(2)}" width="${bw.toFixed(1)}" height="${(p * 0.3).toFixed(2)}" rx="2" fill="#42a5f5" opacity="${(0.18 + (p / 100) * 0.4).toFixed(2)}"></rect>` : "")).join("");
    const cHi = this._tempColor(hi);
    const cMid = this._tempColor((hi + lo) / 2);
    const cLo = this._tempColor(lo);

    const step = Math.max(1, Math.ceil(n / 7));
    const marks = [];
    for (let i = 0; i < n; i += step) marks.push(i);
    const ov = [];
    for (const i of marks) {
      const f = pts[i];
      const c = this._cond(f.condition, this._isNight(f));
      const p = pv[i];
      const date = new Date(f.t);
      const tl = date.getHours() === 0 && i > 0 ? this._day(f.t) : i === 0 && f.t <= Date.now() ? "Now" : this._time(f.t);
      const b = this._bearing(f.wind_bearing);
      const ws = this._num(f.wind_speed);
      ov.push(`<div class="ov ic" style="left:${pct(i)}%;--c:${c.color}"><ha-icon icon="${c.icon}"></ha-icon><span class="p">${p != null && p >= 20 ? `${Math.round(p)}%` : ""}</span></div>`);
      ov.push(`<div class="ov tm" style="left:${pct(i)}%">${tl}</div>`);
      if (ws != null)
        ov.push(`<div class="ov wd" style="left:${pct(i)}%"><ha-icon icon="mdi:navigation" style="transform:rotate(${(b ?? 0) + 180}deg);${b == null ? "visibility:hidden" : ""}"></ha-icon>${Math.round(ws)}</div>`);
    }
    // High and low labels on the temperature line
    const idx = tv.map((v, i) => [v, i]).filter((x) => x[0] != null);
    if (idx.length) {
      const mx = idx.reduce((a, b) => (b[0] > a[0] ? b : a));
      const mn = idx.reduce((a, b) => (b[0] < a[0] ? b : a));
      ov.push(`<div class="ov tl" style="left:${pct(mx[1])}%;top:${34 + yT(mx[0]) * 1.1 - 17}px">${Math.round(mx[0])}°</div>`);
      if (mn[1] !== mx[1]) ov.push(`<div class="ov tl" style="left:${pct(mn[1])}%;top:${34 + yT(mn[0]) * 1.1 + 6}px">${Math.round(mn[0])}°</div>`);
    }

    const body = this._els.body;
    body.innerHTML = `
      <div class="readout"></div>
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="wf-temp" gradientUnits="userSpaceOnUse" x1="0" y1="${yT(hi)}" x2="0" y2="${yT(lo)}">
              <stop offset="0" stop-color="${cHi}"></stop><stop offset="0.5" stop-color="${cMid}"></stop><stop offset="1" stop-color="${cLo}"></stop>
            </linearGradient>
            <linearGradient id="wf-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${cMid}" stop-opacity="0.22"></stop><stop offset="1" stop-color="${cMid}" stop-opacity="0"></stop>
            </linearGradient>
          </defs>
          <g class="grid"><line x1="0" x2="${W}" y1="100" y2="100"></line></g>
          ${bars}${area}
          ${fSegs.map((s) => `<polyline class="ln feels" stroke="${cMid}" points="${s.join(" ")}"></polyline>`).join("")}
          ${tSegs.map((s) => `<polyline class="ln" stroke="url(#wf-temp)" points="${s.join(" ")}"></polyline>`).join("")}
        </svg>
        ${ov.join("")}
        <div class="cursor"></div><div class="dot"></div>
      </div>`;

    const plot = body.querySelector(".plot");
    const cursor = body.querySelector(".cursor");
    const dot = body.querySelector(".dot");
    const readout = body.querySelector(".readout");
    const tU = "°";
    const wsU = w.attributes.wind_speed_unit || "";
    const pU = w.attributes.precipitation_unit || "mm";

    const show = (i) => {
      const parts = [];
      if (i == null) {
        if (idx.length) {
          const mx = idx.reduce((a, b) => (b[0] > a[0] ? b : a));
          const mn = idx.reduce((a, b) => (b[0] < a[0] ? b : a));
          parts.push(`<span class="rd when"><b>Next ${n} h</b></span>`);
          parts.push(`<span class="rd" style="--c:${this._tempColor(mx[0])}"><span class="sw"></span>High <b>${this._deg(mx[0])}${tU}</b> ${this._time(pts[mx[1]].t)}</span>`);
          parts.push(`<span class="rd" style="--c:${this._tempColor(mn[0])}"><span class="sw"></span>Low <b>${this._deg(mn[0])}${tU}</b> ${this._time(pts[mn[1]].t)}</span>`);
        }
        const total = pts.reduce((a, f) => a + (this._num(f.precipitation) ?? 0), 0);
        const maxP = Math.max(0, ...pv.map((p) => p ?? 0));
        parts.push(`<span class="rd" style="--c:#42a5f5"><span class="sw bar"></span>Rain <b>${Math.round(maxP)}%</b>${total > 0 ? ` ${this._fmt(total)} ${pU}` : ""}</span>`);
      } else {
        const f = pts[i];
        const multi = new Date(f.t).toDateString() !== new Date().toDateString();
        parts.push(`<span class="rd when"><b>${multi ? `${this._day(f.t)} ` : ""}${this._time(f.t)}</b></span>`);
        if (tv[i] != null) parts.push(`<span class="rd" style="--c:${this._tempColor(tv[i])}"><span class="sw"></span><b>${this._deg(tv[i])}${tU}</b></span>`);
        if (fv[i] != null) parts.push(`<span class="rd" style="--c:${cMid}"><span class="sw dash"></span>Feels <b>${this._deg(fv[i])}${tU}</b></span>`);
        const amt = this._num(f.precipitation);
        if (pv[i] != null) parts.push(`<span class="rd" style="--c:#42a5f5"><span class="sw bar"></span><b>${Math.round(pv[i])}%</b>${amt ? ` ${this._fmt(amt)} ${pU}` : ""}</span>`);
        const ws = this._num(f.wind_speed);
        if (ws != null) parts.push(`<span class="rd" style="--c:#80cbc4"><ha-icon icon="mdi:weather-windy"></ha-icon><b>${Math.round(ws)}</b> ${wsU}</span>`);
        const c = this._cond(f.condition, this._isNight(f));
        parts.push(`<span class="rd" style="--c:${c.color}"><ha-icon icon="${c.icon}"></ha-icon>${c.label}</span>`);
      }
      readout.innerHTML = parts.join("");
    };
    const move = (ev) => {
      const box = plot.getBoundingClientRect();
      const f = Math.min(0.9999, Math.max(0, (ev.clientX - box.left) / box.width));
      const i = Math.floor(f * n);
      this._scrub = i;
      cursor.style.left = `${pct(i)}%`;
      if (tv[i] != null) {
        dot.style.left = `${pct(i)}%`;
        dot.style.top = `${34 + yT(tv[i]) * 1.1}px`;
        dot.style.background = this._tempColor(tv[i]);
        dot.style.visibility = "visible";
      } else dot.style.visibility = "hidden";
      plot.classList.add("scrub");
      show(i);
    };
    const leave = () => {
      this._scrub = null;
      plot.classList.remove("scrub");
      show(null);
    };
    plot.addEventListener("pointermove", move);
    plot.addEventListener("pointerdown", move);
    plot.addEventListener("pointerleave", leave);
    plot.addEventListener("pointercancel", leave);
    show(null);
  }

  _paintDaily() {
    const w = this._w();
    if (!w) return this._msg("Weather entity not found.");
    if (this._fc.daily == null) {
      const feat = Number(w.attributes.supported_features) || 0;
      return this._msg(feat & 1 ? "Loading forecast…" : "This weather entity has no daily forecast.");
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = this._daily().filter((f) => f.t >= today.getTime() - 12 * WF_HOUR).slice(0, 10);
    if (!days.length) return this._msg("No daily forecast yet.");
    const his = days.map((f) => this._num(f.temperature));
    const los = days.map((f, i) => this._num(f.templow) ?? his[i]);
    const vals = [...his, ...los].filter((v) => v != null);
    const cur = this._get("temperature")?.v;
    if (cur != null) vals.push(cur);
    const gLo = Math.min(...vals);
    const gHi = Math.max(...vals);
    const span = gHi - gLo || 1;
    const pos = (v) => ((v - gLo) / span) * 100;
    const todayStr = new Date().toDateString();

    const rows = days.map((f, i) => {
      const isToday = new Date(f.t).toDateString() === todayStr;
      const c = this._cond(f.condition, false);
      const p = this._num(f.precipitation_probability);
      const hi = his[i];
      const lo = los[i];
      let bar = "";
      if (hi != null && lo != null) {
        const a = pos(Math.min(lo, hi));
        const b = pos(Math.max(lo, hi));
        bar = `<span class="fill" style="left:${a}%;width:${Math.max(2, b - a)}%;background:linear-gradient(90deg, ${this._tempColor(lo)}, ${this._tempColor(hi)})"></span>`;
        if (isToday && cur != null) bar += `<span class="now" style="left:${pos(cur)}%"></span>`;
      }
      return `
        <div class="day" title="${c.label}">
          <span class="dn">${isToday ? "Today" : this._day(f.t)}</span>
          <ha-icon icon="${c.icon}" style="--c:${c.color}"></ha-icon>
          <span class="rp">${p != null && p >= 10 ? `${Math.round(p)}%` : ""}</span>
          <span class="lo">${lo != null ? `${Math.round(lo)}°` : ""}</span>
          <span class="track">${bar}</span>
          <span class="hi">${hi != null ? `${Math.round(hi)}°` : ""}</span>
        </div>`;
    });
    this._els.body.innerHTML = `<div class="days">${rows.join("")}</div>`;
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("weather-forecast-card")) customElements.define("weather-forecast-card", WeatherForecastCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "weather-forecast-card",
  name: "Weather Forecast Card",
  description: "Current conditions, six key stats, an hourly graph and a daily range list",
});
