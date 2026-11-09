/**
 * climate-overview-card  (v1)
 * Same look as heating-dial-card, waste-collection-card and motion-activity-card.
 *
 * One card instead of four: inside and outside temperature, humidity and light.
 * - Tiles: current value, how fast it is changing, low and high for the period,
 *   humidity comfort and dew point, light level and next sunrise or sunset.
 * - One graph: inside and outside temperature on the left scale, humidity on the
 *   right, light as a soft band along the bottom. Hover or drag to read any time.
 *
 * Config:
 *   type: custom:climate-overview-card
 *   inside: sensor.house_average_temperature
 *   outside: sensor.annex_parking_sensor_temperature
 *   humidity: sensor.house_average_humidity
 *   light: sensor.annex_parking_sensor_illuminance
 *   sun: sun.sun          # optional, default sun.sun when it exists
 *   hours: 24
 *   ranges: [6, 24, 72]
 *   names: { inside: Inside, outside: Outside, humidity: Humidity, light: Light }
 *
 * Install: copy to /config/www/climate-overview-card.js and add the resource
 * /local/climate-overview-card.js?v=1 (type: JavaScript module).
 */

const CO_POINTS = 144;
const CO_REFRESH_MS = 5 * 60 * 1000;
const CO_HOUR = 3600000;

const CO_KEYS = [
  { key: "inside", name: "Inside", color: "#ff7043", icon: "mdi:home-thermometer" },
  { key: "outside", name: "Outside", color: "#9ccc65", icon: "mdi:sun-thermometer" },
  { key: "humidity", name: "Humidity", color: "#42a5f5", icon: "mdi:water-percent" },
  { key: "light", name: "Light", color: "#ffca28", icon: "mdi:white-balance-sunny" },
];

const CO_STYLE = `
  ha-card { padding: 12px 12px 12px; container-type: inline-size; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  @container (min-width: 600px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .tile {
    display: flex; flex-direction: column; min-width: 0; padding: 10px 12px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .tile:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .t-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .disc {
    flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent);
  }
  .disc ha-icon { --mdc-icon-size: 17px; }
  .t-name { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t-val { display: flex; align-items: flex-start; margin-top: 6px; line-height: 1; }
  .t-val .v { font-size: 26px; font-weight: 400; font-variant-numeric: tabular-nums; }
  .t-val .u { font-size: 13px; margin: 2px 0 0 3px; color: var(--secondary-text-color); }
  .t-sub { font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .t-sub + .t-sub { margin-top: 1px; }
  .t-sub.hot { color: var(--c); }

  .chart { margin-top: 6px; padding: 10px 12px 8px; border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; }
  .lg { display: flex; align-items: center; gap: 5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lg b { font-weight: 500; color: var(--primary-text-color); }
  .sw { width: 10px; height: 3px; border-radius: 2px; background: var(--c); }
  .sw.area { height: 8px; background: color-mix(in srgb, var(--c) 45%, transparent); }
  .when { color: var(--primary-text-color); font-weight: 500; }
  .ranges { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .ranges button { color: var(--secondary-text-color); font-size: 12px; padding: 3px 8px; border-radius: 8px; }
  .ranges button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }

  .plot { position: relative; height: 136px; margin-top: 8px; padding: 0 30px; touch-action: pan-y; cursor: crosshair; }
  .plot svg { display: block; width: 100%; height: 120px; overflow: visible; }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .ln { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; stroke-width: 2; }
  .ln.hum { stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.85; }
  .lux { stroke: none; opacity: 0.22; }
  .cursor { position: absolute; top: 0; height: 120px; width: 1px; background: var(--primary-text-color); opacity: 0.5; pointer-events: none; display: none; }
  .plot.scrub .cursor { display: block; }
  .ax { position: absolute; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none; color: var(--secondary-text-color); }
  .ax.l { left: 0; } .ax.r { right: 0; text-align: right; color: #42a5f5; }
  .ax.t { top: 0; } .ax.b { top: 110px; }
  .times { position: absolute; left: 30px; right: 30px; bottom: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); pointer-events: none; }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
`;

class ClimateOverviewCard extends HTMLElement {
  static getStubConfig() {
    return { inside: "sensor.house_average_temperature", outside: "", humidity: "", light: "" };
  }

  setConfig(config) {
    if (!config || !CO_KEYS.some((k) => config[k.key])) throw new Error("Set at least one of inside, outside, humidity or light");
    this._config = { hours: 24, ranges: [6, 24, 72], ...config };
    this._hours = Number(this._config.hours) || 24;
    this._keys = CO_KEYS.filter((k) => this._config[k.key]).map((k) => ({
      ...k,
      entity: this._config[k.key],
      name: this._config.names?.[k.key] || k.name,
      color: this._config.colors?.[k.key] || k.color,
    }));
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
    if (!this._loading && Date.now() - this._fetchedAt > CO_REFRESH_MS) this._fetch();
    this._paintTiles();
    if (this._scrub == null) this._paintLegend(null);
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- layout ---------- */

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${CO_STYLE}</style>
      <ha-card>
        <div class="tiles"></div>
        <div class="chart">
          <div class="top"><div class="legend"><span class="lg when"></span></div><div class="ranges" role="group" aria-label="Time range"></div></div>
          <div class="body"><div class="msg">Loading history…</div></div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = { tiles: $(".tiles"), legend: $(".legend"), when: $(".when"), ranges: $(".ranges"), body: $(".body") };

    this._tiles = {};
    this._lg = {};
    for (const k of this._keys) {
      const t = document.createElement("button");
      t.className = "tile";
      t.style.setProperty("--c", k.color);
      t.innerHTML = `
        <div class="t-head"><span class="disc"><ha-icon></ha-icon></span><span class="t-name"></span></div>
        <div class="t-val"><span class="v">–</span><span class="u"></span></div>
        <div class="t-sub s1"></div><div class="t-sub s2"></div>`;
      t.querySelector("ha-icon").setAttribute("icon", k.icon);
      t.querySelector(".t-name").textContent = k.name;
      t.addEventListener("click", () => this._moreInfo(k.entity));
      this._els.tiles.append(t);
      const q = (s) => t.querySelector(s);
      this._tiles[k.key] = { el: t, v: q(".v"), u: q(".u"), s1: q(".s1"), s2: q(".s2") };

      const lg = document.createElement("span");
      lg.className = "lg";
      lg.style.setProperty("--c", k.color);
      lg.innerHTML = `<span class="sw${k.key === "light" ? " area" : ""}"></span><b></b>`;
      lg.title = k.name;
      this._els.legend.append(lg);
      this._lg[k.key] = lg.querySelector("b");
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

  _num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _fmt(v, d = 1) {
    return new Intl.NumberFormat(this._hass?.locale?.language, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }

  _time(t, withDay) {
    const opts = { hour: "2-digit", minute: "2-digit" };
    if (withDay) opts.weekday = "short";
    return new Date(t).toLocaleString(this._hass?.locale?.language, opts);
  }

  _live(key) {
    const k = this._keys.find((x) => x.key === key);
    const st = k && this._hass.states[k.entity];
    return st ? this._num(st.state) : null;
  }

  _unit(key) {
    const k = this._keys.find((x) => x.key === key);
    return this._hass.states[k?.entity]?.attributes.unit_of_measurement || "";
  }

  _dewPoint(t, rh) {
    if (t == null || rh == null || rh <= 0) return null;
    const a = 17.62, b = 243.12;
    const g = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * g) / (a - g);
  }

  _lightLevel(lx) {
    if (lx < 10) return "Dark";
    if (lx < 100) return "Dim";
    if (lx < 1000) return "Overcast";
    if (lx < 10000) return "Daylight";
    return "Bright sun";
  }

  _humidityLevel(rh) {
    if (rh < 35) return "Dry";
    if (rh <= 60) return "Comfortable";
    if (rh <= 70) return "Humid";
    return "Very humid";
  }

  /* ---------- data ---------- */

  async _fetch() {
    const h = this._hass;
    const ids = this._keys.map((k) => k.entity).filter((id) => h.states[id]);
    if (!ids.length) {
      this._els.body.innerHTML = `<div class="msg">Sensors not found.</div>`;
      return;
    }
    this._loading = true;
    const end = Date.now();
    const start = end - this._hours * CO_HOUR;
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
      for (const k of this._keys) {
        series[k.key] = (res?.[k.entity] || [])
          .map((e) => ({
            t: e.lu != null ? e.lu * 1000 : e.lc != null ? e.lc * 1000 : Date.parse(e.last_changed || e.last_updated),
            v: this._num(e.s ?? e.state),
          }))
          .filter((x) => Number.isFinite(x.t))
          .sort((a, b) => a.t - b.t);
      }
      const times = [];
      for (let i = 0; i < CO_POINTS; i++) times.push(start + ((end - start) * i) / (CO_POINTS - 1));
      const sampled = {};
      for (const k of this._keys) sampled[k.key] = times.map((t) => this._at(series[k.key], t));
      this._data = { start, end, times, series, sampled };
      this._error = false;
    } catch (err) {
      console.warn("climate-overview-card: could not load history", err);
      this._error = true;
    } finally {
      this._loading = false;
      this._fetchedAt = Date.now();
      this._paintChart();
      this._paintTiles();
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

  _minMax(key) {
    const v = (this._data?.sampled[key] || []).filter((x) => x != null);
    const live = this._live(key);
    if (live != null) v.push(live);
    return v.length ? [Math.min(...v), Math.max(...v)] : [null, null];
  }

  _trend(key) {
    const s = this._data?.series[key];
    const now = this._live(key);
    if (!s?.length || now == null) return null;
    const before = this._at(s, Date.now() - CO_HOUR);
    return before == null ? null : now - before;
  }

  /* ---------- drawing ---------- */

  _paintTiles() {
    const h = this._hass;
    if (!h || !this._tiles) return;
    const inside = this._live("inside");
    const outside = this._live("outside");
    for (const k of this._keys) {
      const t = this._tiles[k.key];
      const st = h.states[k.entity];
      const v = st ? this._num(st.state) : null;
      t.el.classList.toggle("dead", v == null);
      t.el.title = `${k.name}: ${st ? st.state : "not found"}`;
      if (v == null) {
        t.v.textContent = "–";
        t.u.textContent = "";
        t.s1.textContent = st ? "Unavailable" : "Not found";
        t.s2.textContent = "";
        continue;
      }
      const [lo, hi] = this._minMax(k.key);
      t.s1.classList.remove("hot");
      if (k.key === "inside" || k.key === "outside") {
        t.v.textContent = this._fmt(v);
        t.u.textContent = st.attributes.unit_of_measurement || "°C";
        const tr = this._trend(k.key);
        if (tr == null) t.s1.textContent = "";
        else if (Math.abs(tr) < 0.2) t.s1.textContent = "Steady";
        else {
          t.s1.textContent = `${tr > 0 ? "Rising" : "Falling"} ${this._fmt(Math.abs(tr))}° in 1 h`;
          t.s1.classList.toggle("hot", k.key === "inside");
        }
        if (k.key === "outside" && inside != null && !t.s1.textContent) {
          const d = inside - v;
          t.s1.textContent = `${this._fmt(Math.abs(d))}° ${d > 0 ? "colder" : "warmer"} than inside`;
        }
        t.s2.textContent = lo != null ? `Low ${this._fmt(lo)}°, high ${this._fmt(hi)}°` : "";
      } else if (k.key === "humidity") {
        t.v.textContent = String(Math.round(v));
        t.u.textContent = "%";
        t.s1.textContent = this._humidityLevel(v);
        const dp = this._dewPoint(inside, v);
        t.s2.textContent = dp != null ? `Dew point ${this._fmt(dp)}°` : lo != null ? `${Math.round(lo)}–${Math.round(hi)}%` : "";
      } else if (k.key === "light") {
        t.v.textContent = new Intl.NumberFormat(h.locale?.language, { maximumFractionDigits: 0 }).format(v);
        t.u.textContent = st.attributes.unit_of_measurement || "lx";
        t.s1.textContent = this._lightLevel(v);
        const sun = h.states[this._config.sun || "sun.sun"];
        if (sun) {
          const up = sun.state === "above_horizon";
          const next = Date.parse(up ? sun.attributes.next_setting : sun.attributes.next_rising);
          t.s2.textContent = Number.isFinite(next) ? `${up ? "Sunset" : "Sunrise"} ${this._time(next)}` : "";
        } else {
          t.s2.textContent = hi != null ? `Peak ${Math.round(hi)} lx` : "";
        }
      }
    }
    // Outside: say how it compares with inside when not changing much
    const out = this._tiles.outside;
    if (out && outside != null && inside != null && out.s1.textContent === "Steady") {
      const d = inside - outside;
      out.s1.textContent = `${this._fmt(Math.abs(d))}° ${d > 0 ? "colder" : "warmer"} than inside`;
    }
  }

  _paintLegend(idx) {
    if (!this._hass || !this._lg) return;
    const d = this._data;
    this._els.when.textContent = idx != null && d ? this._time(d.times[idx], d.end - d.start > 26 * CO_HOUR) : "Now";
    for (const k of this._keys) {
      const v = idx != null && d ? d.sampled[k.key][idx] : this._live(k.key);
      let txt = "–";
      if (v != null) {
        if (k.key === "humidity") txt = `${Math.round(v)}%`;
        else if (k.key === "light") txt = `${Math.round(v)} lx`;
        else txt = `${this._fmt(v)}°`;
      }
      this._lg[k.key].textContent = txt;
    }
  }

  _paintChart() {
    const body = this._els.body;
    const d = this._data;
    if (this._error || !d) {
      body.innerHTML = `<div class="msg">Couldn't load history. Check that the recorder is running.</div>`;
      return;
    }
    const W = 1000;
    const span = d.end - d.start;
    const x = (i) => ((i / (CO_POINTS - 1)) * W).toFixed(1);
    const temps = ["inside", "outside"].flatMap((k) => (d.sampled[k] || []).filter((v) => v != null));
    if (!temps.length && !(d.sampled.humidity || []).some((v) => v != null)) {
      body.innerHTML = `<div class="msg">No history yet for this period.</div>`;
      return;
    }
    const tLo = temps.length ? Math.floor(Math.min(...temps) - 0.5) : 0;
    const tHi = temps.length ? Math.ceil(Math.max(...temps) + 0.5) : 1;
    const hum = (d.sampled.humidity || []).filter((v) => v != null);
    const hLo = hum.length ? Math.floor(Math.min(...hum) - 2) : 0;
    const hHi = hum.length ? Math.ceil(Math.max(...hum) + 2) : 100;
    const yT = (v) => (96 - ((v - tLo) / (tHi - tLo || 1)) * 92).toFixed(2);
    const yH = (v) => (96 - ((v - hLo) / (hHi - hLo || 1)) * 92).toFixed(2);

    const poly = (vals, y, cls, color) => {
      const parts = [];
      let cur = [];
      vals.forEach((v, i) => {
        if (v == null) {
          if (cur.length) parts.push(cur);
          cur = [];
        } else cur.push(`${x(i)},${y(v)}`);
      });
      if (cur.length) parts.push(cur);
      return parts.map((p) => `<polyline class="${cls}" stroke="${color}" points="${p.join(" ")}"></polyline>`).join("");
    };

    // Light: log scale band along the bottom third
    let lux = "";
    const lv = d.sampled.light;
    if (lv && lv.some((v) => v != null)) {
      const maxL = Math.log10(Math.max(10, ...lv.filter((v) => v != null)) + 1);
      const yL = (v) => (100 - (Math.log10(Math.max(0, v) + 1) / maxL) * 34).toFixed(2);
      const pts = lv.map((v, i) => `${x(i)},${v == null ? 100 : yL(v)}`).join(" ");
      const color = this._keys.find((k) => k.key === "light").color;
      lux = `<polygon class="lux" fill="${color}" points="0,100 ${pts} ${W},100"></polygon>`;
    }

    const col = (key) => this._keys.find((k) => k.key === key)?.color;
    const lines =
      (d.sampled.humidity ? poly(d.sampled.humidity, yH, "ln hum", col("humidity")) : "") +
      (d.sampled.outside ? poly(d.sampled.outside, yT, "ln", col("outside")) : "") +
      (d.sampled.inside ? poly(d.sampled.inside, yT, "ln", col("inside")) : "");
    const multiDay = span > 26 * CO_HOUR;

    body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid"><line x1="0" x2="${W}" y1="4" y2="4"></line><line x1="0" x2="${W}" y1="50" y2="50"></line><line x1="0" x2="${W}" y1="96" y2="96"></line></g>
          ${lux}${lines}
        </svg>
        <div class="cursor"></div>
        ${temps.length ? `<span class="ax l t">${tHi}°</span><span class="ax l b">${tLo}°</span>` : ""}
        ${hum.length ? `<span class="ax r t">${hHi}%</span><span class="ax r b">${hLo}%</span>` : ""}
        <div class="times"><span>${this._time(d.start, multiDay)}</span><span>${this._time(d.start + span / 2, multiDay)}</span><span>Now</span></div>
      </div>`;

    const plot = body.querySelector(".plot");
    const svg = body.querySelector("svg");
    const cursor = body.querySelector(".cursor");
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const pbox = plot.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      this._scrub = Math.round(f * (CO_POINTS - 1));
      cursor.style.left = `${box.left - pbox.left + f * box.width}px`;
      plot.classList.add("scrub");
      this._paintLegend(this._scrub);
    };
    const leave = () => {
      this._scrub = null;
      plot.classList.remove("scrub");
      this._paintLegend(null);
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

if (!customElements.get("climate-overview-card")) customElements.define("climate-overview-card", ClimateOverviewCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "climate-overview-card",
  name: "Climate Overview Card",
  description: "Inside and outside temperature, humidity and light in one card with a combined graph",
});
