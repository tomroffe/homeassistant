/**
 * energy-usage-card  (v1)
 * Same look as climate-overview-card, weather-forecast-card and appliance-dial-card.
 * Replaces the statistics-graph bar chart for appliance energy meters.
 *
 * - Total panel: energy and cost for the period, change against the previous
 *   period, daily average, and a share bar per appliance.
 * - One tile per appliance: energy, cost, change, number of runs and energy per
 *   run, last run, and "Running now" when a power sensor shows a load.
 * - Stacked bar graph (24 h, 7 d, 30 d or 12 months) with an average line.
 *   Hover or drag to read any bar.
 * - Habits: when the appliances run, by hour of day and by weekday (last 30 days),
 *   with the busiest window and, optionally, the share used off-peak.
 *
 * Config:
 *   type: custom:energy-usage-card
 *   entities:
 *     - entity: sensor.washing_machine_energy
 *       name: Washing Machine          # optional
 *       icon: mdi:washing-machine      # optional
 *       color: "#42a5f5"               # optional
 *       power: sensor.washing_machine_power   # optional, default <name>_power if it exists
 *     - entity: sensor.tumble_dryer_energy
 *   price: 0.245                       # optional, per kWh, number or sensor entity
 *   currency: GBP                      # optional, default from HA settings
 *   off_peak: ["00:30", "07:30"]       # optional, start and end
 *   range: 30d                         # 24h, 7d, 30d or 12m
 *   ranges: [24h, 7d, 30d, 12m]
 *   title: Appliances
 *
 * Energy comes from long-term statistics (recorder/statistics_during_period),
 * so the sensors need state_class total or total_increasing (as the energy
 * dashboard already requires).
 *
 * Install: copy to /config/www/energy-usage-card.js and add the resource
 * /local/energy-usage-card.js?v=1 (type: JavaScript module).
 */

const EU_HOUR = 3600000;
const EU_REFRESH_MS = 10 * 60 * 1000;
const EU_RUN_KWH = 0.05; // an hour counts as running above this
const EU_COLORS = ["#42a5f5", "#9ccc65", "#ffb74d", "#ba68c8", "#4dd0e1", "#f06292"];
const EU_RANGES = {
  "24h": { period: "hour", count: 24, label: "24 h", long: "24 hours" },
  "7d": { period: "day", count: 7, label: "7 d", long: "7 days" },
  "30d": { period: "day", count: 30, label: "30 d", long: "30 days" },
  "12m": { period: "month", count: 12, label: "12 m", long: "12 months" },
};
const EU_ICONS = [
  [/wash/, "mdi:washing-machine"],
  [/dry/, "mdi:tumble-dryer"],
  [/dish/, "mdi:dishwasher"],
  [/oven|cook/, "mdi:stove"],
  [/fridge|freez/, "mdi:fridge-outline"],
  [/kettle/, "mdi:kettle"],
  [/car|ev/, "mdi:car-electric"],
];

const EU_STYLE = `
  ha-card { padding: 12px; container-type: inline-size; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .panel { border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .disc { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent); }
  .disc ha-icon { --mdc-icon-size: 17px; }
  .up { color: #ffb300; } .down { color: #66bb6a; }

  .hero { padding: 12px; }
  .h-top { display: flex; align-items: flex-start; gap: 10px; }
  .hero .disc { width: 40px; height: 40px; }
  .hero .disc ha-icon { --mdc-icon-size: 22px; }
  .h-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .h-title { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h-val { display: flex; align-items: baseline; gap: 4px; margin-top: 2px; line-height: 1.05; flex-wrap: wrap; }
  .h-val .v { font-size: 32px; font-variant-numeric: tabular-nums; }
  .h-val .u { font-size: 14px; color: var(--secondary-text-color); }
  .h-val .cost { font-size: 16px; margin-left: 8px; font-variant-numeric: tabular-nums; }
  .h-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
  .h-side b { font-weight: 500; color: var(--primary-text-color); }
  .h-side .chg { font-size: 13px; font-weight: 500; }
  .share { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 12px; gap: 2px;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .share i { display: block; height: 100%; background: var(--c); transition: flex-grow 0.4s; }
  .share-lg { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-top: 6px; font-size: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .share-lg span { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .share-lg b { color: var(--primary-text-color); font-weight: 500; }
  .dotc { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  @container (max-width: 360px) { .h-side .avg { display: none; } }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 6px; margin-top: 6px; }
  .tile { display: flex; flex-direction: column; min-width: 0; padding: 10px 12px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .tile:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .t-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .t-name { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
  .live { display: none; align-items: center; gap: 4px; font-size: 11px; color: var(--c); white-space: nowrap; }
  .live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--c); animation: eu-pulse 1.6s ease-in-out infinite; }
  .tile.on .live { display: flex; }
  @keyframes eu-pulse { 50% { opacity: 0.3; } }
  .t-val { display: flex; align-items: baseline; gap: 3px; margin-top: 6px; line-height: 1; }
  .t-val .v { font-size: 24px; font-variant-numeric: tabular-nums; }
  .t-val .u { font-size: 12px; color: var(--secondary-text-color); }
  .t-val .cost { margin-left: auto; font-size: 13px; font-variant-numeric: tabular-nums; }
  .t-sub { font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .t-sub + .t-sub { margin-top: 1px; }

  .chart { margin-top: 6px; padding: 10px 12px 8px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; font-variant-numeric: tabular-nums; }
  .lg { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .lg b { font-weight: 500; color: var(--primary-text-color); }
  .when { color: var(--primary-text-color); font-weight: 500; }
  .sw { width: 8px; height: 10px; border-radius: 2px; background: var(--c); }
  .sw.line { width: 10px; height: 0; border-top: 1.5px dashed var(--secondary-text-color); background: none; }
  .seg { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .seg button { color: var(--secondary-text-color); font-size: 12px; padding: 3px 8px; border-radius: 8px; }
  .seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }

  .plot { position: relative; height: 156px; margin-top: 8px; padding: 0 0 0 34px; touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
  .plot svg { display: block; width: 100%; height: 140px; overflow: visible; }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .avgln { stroke: var(--secondary-text-color); stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; opacity: 0.8; }
  .bars rect { transition: opacity 0.15s; }
  .plot.scrub .bars g:not(.hl) rect { opacity: 0.35; }
  .ax { position: absolute; left: 0; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none; color: var(--secondary-text-color); transform: translateY(-50%); }
  .times { position: absolute; left: 34px; right: 0; bottom: 0; height: 12px; font-size: 11px; color: var(--secondary-text-color); pointer-events: none; }
  .times span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }

  .habits { margin-top: 6px; padding: 10px 12px 10px; }
  .hb-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
  .hb-head .sub { font-size: 12px; color: var(--secondary-text-color); }
  .hb-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 8px; }
  @container (min-width: 520px) { .hb-grid { grid-template-columns: 2fr 1fr; } }
  .hb-title { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--secondary-text-color); margin-bottom: 4px; }
  .hb-title b { color: var(--primary-text-color); font-weight: 500; }
  .mini { position: relative; height: 62px; }
  .mini svg { display: block; width: 100%; height: 48px; overflow: visible; }
  .mini .op { fill: color-mix(in srgb, #7e57c2 22%, transparent); }
  .mini .lbls { position: absolute; left: 0; right: 0; bottom: 0; height: 11px; font-size: 10px; color: var(--secondary-text-color); }
  .mini .lbls span { position: absolute; transform: translateX(-50%); }
  .facts { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 8px; }
  .fact { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 10px; font-size: 12px; white-space: nowrap;
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); font-variant-numeric: tabular-nums; }
  .fact ha-icon { --mdc-icon-size: 14px; color: var(--c, var(--secondary-text-color)); }
  .fact b { font-weight: 500; }
`;

class EnergyUsageCard extends HTMLElement {
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((e) => e.startsWith("sensor.") && hass.states[e].attributes.device_class === "energy");
    return { entities: ids.slice(0, 2).length ? ids.slice(0, 2) : ["sensor.washing_machine_energy"] };
  }

  setConfig(config) {
    const list = config?.entities || (config?.entity ? [config.entity] : []);
    if (!list.length) throw new Error("Set entities: a list of energy sensors");
    const ranges = (config.ranges || Object.keys(EU_RANGES)).map(String).filter((r) => EU_RANGES[r]);
    this._config = { title: "Appliances", ...config, ranges: ranges.length ? ranges : Object.keys(EU_RANGES) };
    this._items = list.map((e, i) => {
      const r = typeof e === "string" ? { entity: e } : { ...e };
      if (!r.entity) throw new Error("Each item needs an entity");
      return { ...r, color: r.color || EU_COLORS[i % EU_COLORS.length] };
    });
    const want = String(config.range || "30d");
    this._range = this._config.ranges.includes(want) ? want : this._config.ranges.includes("30d") ? "30d" : this._config.ranges[0];
    this._data = null;
    this._hourly = null;
    this._fetchedAt = 0;
    this._scrub = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._els) return;
    if (!this._loading && Date.now() - this._fetchedAt > EU_REFRESH_MS) this._fetch();
    const ids = [...this._items.flatMap((it) => [it.entity, this._powerId(it)]), typeof this._config.price === "string" ? this._config.price : null];
    const key = ids.map((id) => (id ? hass.states[id] : null));
    if (this._lastKey && key.every((s, i) => s === this._lastKey[i])) return;
    this._lastKey = key;
    this._paintSummary();
  }

  getCardSize() {
    return 10;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- layout ---------- */

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${EU_STYLE}</style>
      <ha-card>
        <div class="panel hero" style="--c:#ffca28">
          <div class="h-top">
            <span class="disc"><ha-icon icon="mdi:lightning-bolt"></ha-icon></span>
            <div class="h-main">
              <span class="h-title"></span>
              <div class="h-val"><span class="v">–</span><span class="u">kWh</span><span class="cost"></span></div>
            </div>
            <div class="h-side"><span class="chg"></span><span class="prev"></span><span class="avg"></span></div>
          </div>
          <div class="share"></div>
          <div class="share-lg"></div>
        </div>
        <div class="tiles"></div>
        <div class="panel chart">
          <div class="top"><div class="legend"></div><div class="seg ranges" role="group" aria-label="Period"></div></div>
          <div class="body"><div class="msg">Loading statistics…</div></div>
        </div>
        <div class="panel habits"></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      title: $(".h-title"), total: $(".h-val .v"), totalU: $(".h-val .u"), cost: $(".h-val .cost"),
      chg: $(".h-side .chg"), prev: $(".h-side .prev"), avg: $(".h-side .avg"), share: $(".share"), shareLg: $(".share-lg"),
      tiles: $(".tiles"), legend: $(".legend"), ranges: $(".ranges"), body: $(".body"), habits: $(".habits"),
    };

    this._tiles = {};
    for (const it of this._items) {
      const t = document.createElement("button");
      t.className = "tile";
      t.style.setProperty("--c", it.color);
      t.innerHTML = `
        <div class="t-head"><span class="disc"><ha-icon></ha-icon></span><span class="t-name"></span><span class="live"></span></div>
        <div class="t-val"><span class="v">–</span><span class="u">kWh</span><span class="cost"></span></div>
        <div class="t-sub s1"></div><div class="t-sub s2"></div><div class="t-sub s3"></div>`;
      t.addEventListener("click", () => this._moreInfo(it.entity));
      this._els.tiles.append(t);
      const q = (s) => t.querySelector(s);
      this._tiles[it.entity] = { el: t, icon: q("ha-icon"), name: q(".t-name"), live: q(".live"), v: q(".v"), cost: q(".cost"), s1: q(".s1"), s2: q(".s2"), s3: q(".s3") };
    }

    for (const r of this._config.ranges) {
      const b = document.createElement("button");
      b.textContent = EU_RANGES[r].label;
      b.setAttribute("aria-pressed", String(r === this._range));
      b.addEventListener("click", () => {
        if (r === this._range) return;
        this._range = r;
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

  _name(it) {
    const st = this._hass?.states[it.entity];
    if (it.name) return it.name;
    const fn = st?.attributes.friendly_name || it.entity.split(".")[1].replace(/_/g, " ");
    return fn.replace(/\s*energy$/i, "").replace(/^./, (c) => c.toUpperCase());
  }

  _icon(it) {
    if (it.icon) return it.icon;
    const s = `${it.entity} ${this._name(it)}`.toLowerCase();
    return EU_ICONS.find(([re]) => re.test(s))?.[1] || this._hass?.states[it.entity]?.attributes.icon || "mdi:flash";
  }

  _powerId(it) {
    if (it.power) return it.power;
    const guess = it.entity.replace(/_energy$/, "_power");
    return guess !== it.entity && this._hass?.states[guess] ? guess : null;
  }

  _watts(it) {
    const id = this._powerId(it);
    const st = id && this._hass.states[id];
    const v = st ? this._num(st.state) : null;
    if (v == null) return null;
    const u = st.attributes.unit_of_measurement || "W";
    return u === "kW" ? v * 1000 : v;
  }

  _factor(it) {
    const u = this._hass?.states[it.entity]?.attributes.unit_of_measurement || "kWh";
    if (u === "Wh") return 0.001;
    if (u === "MWh") return 1000;
    return 1;
  }

  _kwh(v) {
    const d = v < 10 ? 2 : v < 100 ? 1 : 0;
    return new Intl.NumberFormat(this._hass?.locale?.language, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }

  _price() {
    const p = this._config.price;
    if (p == null) return null;
    if (typeof p === "number") return p;
    const st = this._hass.states[p];
    if (st) {
      const v = this._num(st.state);
      if (v == null) return null;
      return /p\/kwh|pence/i.test(st.attributes.unit_of_measurement || "") ? v / 100 : v;
    }
    return this._num(p);
  }

  _pct(pct) {
    // Very large changes read better as a multiple
    return pct >= 200 ? `${Math.round(pct / 100 + 1)}×` : `${Math.abs(pct)}%`;
  }

  _money(v) {
    const cur = this._config.currency || this._hass.config?.currency || "GBP";
    try {
      return new Intl.NumberFormat(this._hass.locale?.language, { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(v);
    } catch (e) {
      return `${cur}${v.toFixed(2)}`;
    }
  }

  _cost(kwh) {
    const p = this._price();
    return p == null || kwh == null ? "" : this._money(kwh * p);
  }

  _label(t, period, long) {
    const lang = this._hass?.locale?.language;
    const d = new Date(t);
    if (period === "hour") return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", ...(long ? { weekday: "short" } : {}) });
    if (period === "day") return d.toLocaleDateString(lang, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
    return d.toLocaleDateString(lang, long ? { month: "long", year: "numeric" } : { month: "short" });
  }

  _ago(t) {
    const lang = this._hass?.locale?.language;
    const d = new Date(t);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const time = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    if (t >= today.getTime()) return `today ${time}`;
    if (t >= today.getTime() - 86400000) return `yesterday ${time}`;
    if (t >= today.getTime() - 6 * 86400000) return `${d.toLocaleDateString(lang, { weekday: "short" })} ${time}`;
    return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
  }

  _buckets(period, count) {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    if (period !== "hour") d.setHours(0);
    if (period === "month") d.setDate(1);
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const b = new Date(d);
      if (period === "hour") b.setHours(b.getHours() - i);
      else if (period === "day") b.setDate(b.getDate() - i);
      else b.setMonth(b.getMonth() - i);
      out.push(b.getTime());
    }
    return out;
  }

  _offPeak(h) {
    const op = this._config.off_peak;
    if (!Array.isArray(op) || op.length !== 2) return null;
    const m = (s) => {
      const [hh, mm] = String(s).split(":").map(Number);
      return (hh || 0) * 60 + (mm || 0);
    };
    const [a, b] = op.map(m);
    // Share of the hour [h, h+1) inside the window, in minutes
    let inside = 0;
    for (let x = h * 60; x < h * 60 + 60; x += 5) {
      const on = a <= b ? x >= a && x < b : x >= a || x < b;
      if (on) inside += 5;
    }
    return inside / 60;
  }

  /* ---------- data ---------- */

  async _stats(start, end, period) {
    const ids = this._items.map((it) => it.entity);
    const res = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: ids,
      period,
      types: ["change"],
    });
    const out = {};
    for (const it of this._items) {
      const f = this._factor(it);
      out[it.entity] = (res?.[it.entity] || [])
        .map((r) => ({ t: typeof r.start === "number" ? r.start : Date.parse(r.start), v: r.change == null ? null : Math.max(0, r.change * f) }))
        .filter((r) => Number.isFinite(r.t) && r.v != null);
    }
    return out;
  }

  _fill(rows, buckets) {
    const vals = buckets.map(() => 0);
    for (const r of rows) {
      for (let k = buckets.length - 1; k >= 0; k--) {
        if (r.t >= buckets[k] - 60000) {
          vals[k] += r.v;
          break;
        }
      }
    }
    return vals;
  }

  async _fetch() {
    const h = this._hass;
    if (!this._items.some((it) => h.states[it.entity])) {
      this._els.body.innerHTML = `<div class="msg">Energy sensors not found.</div>`;
      this._fetchedAt = Date.now();
      return;
    }
    this._loading = true;
    const rng = EU_RANGES[this._range];
    try {
      const all = this._buckets(rng.period, rng.count * 2);
      const buckets = all.slice(rng.count);
      const prevBuckets = all.slice(0, rng.count);
      const now = Date.now();
      const hourStart = now - 30 * 24 * EU_HOUR;
      const [main, hourly] = await Promise.all([
        this._stats(all[0], now, rng.period),
        rng.period === "hour" ? null : this._stats(Math.min(hourStart, buckets[0]), now, "hour"),
      ]);
      const series = {};
      const prev = {};
      for (const it of this._items) {
        const rows = main[it.entity] || [];
        series[it.entity] = this._fill(rows.filter((r) => r.t >= buckets[0] - 60000), buckets);
        prev[it.entity] = this._fill(rows.filter((r) => r.t < buckets[0] - 60000), prevBuckets).reduce((a, b) => a + b, 0);
      }
      // Hourly rows: runs for the period (30 d at most) and habits for the last 30 d
      let hours = hourly;
      if (rng.period === "hour") hours = await this._stats(hourStart, now, "hour");
      this._data = { range: this._range, period: rng.period, buckets, series, prev };
      this._hourly = { rows: hours, from: hourStart };
      this._error = false;
    } catch (err) {
      console.warn("energy-usage-card: could not load statistics", err);
      this._error = true;
    } finally {
      this._loading = false;
      this._fetchedAt = Date.now();
      this._paintSummary();
      this._paintChart();
      this._paintHabits();
    }
  }

  _runs(rows, from) {
    const hrs = rows.filter((r) => r.t >= from).sort((a, b) => a.t - b.t);
    const runs = [];
    let cur = null;
    for (const r of hrs) {
      if (r.v >= EU_RUN_KWH) {
        if (cur && r.t - cur.end <= EU_HOUR + 60000) {
          cur.end = r.t + EU_HOUR;
          cur.kwh += r.v;
        } else {
          cur = { start: r.t, end: r.t + EU_HOUR, kwh: r.v };
          runs.push(cur);
        }
      }
    }
    return runs;
  }

  /* ---------- painting ---------- */

  _paintSummary() {
    const h = this._hass;
    const e = this._els;
    const d = this._data;
    const rng = EU_RANGES[this._range];
    e.title.textContent = `${this._config.title} · last ${rng.long}`;
    const totals = this._items.map((it) => (d ? d.series[it.entity].reduce((a, b) => a + b, 0) : null));
    const total = d ? totals.reduce((a, b) => a + b, 0) : null;
    e.total.textContent = total != null ? this._kwh(total) : "–";
    e.cost.textContent = total != null ? this._cost(total) : "";

    const prevTotal = d ? this._items.reduce((a, it) => a + d.prev[it.entity], 0) : null;
    if (d && prevTotal > 0.05) {
      const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
      e.chg.className = `chg ${pct > 0 ? "up" : pct < 0 ? "down" : ""}`;
      e.chg.textContent = pct === 0 ? "Same as before" : `${pct > 0 ? "▲" : "▼"} ${this._pct(pct)}`;
      e.prev.innerHTML = `Previous <b>${this._kwh(prevTotal)} kWh</b>`;
    } else {
      e.chg.textContent = "";
      e.prev.textContent = "";
    }
    const days = rng.period === "hour" ? 1 : rng.period === "day" ? rng.count : rng.count * 30.4;
    e.avg.innerHTML = total != null && rng.period !== "hour" ? `<b>${this._kwh(total / days)} kWh</b> a day` : "";

    // Share bar
    e.share.innerHTML = this._items
      .map((it, i) => (totals[i] > 0 ? `<i style="--c:${it.color};flex-grow:${totals[i]}"></i>` : ""))
      .join("");
    e.shareLg.innerHTML = this._items
      .map((it, i) => {
        const pct = total > 0 ? Math.round((totals[i] / total) * 100) : null;
        return `<span style="--c:${it.color}"><span class="dotc"></span>${this._name(it)} <b>${pct != null ? `${pct}%` : "–"}</b></span>`;
      })
      .join("");

    // Tiles
    const runFrom = d ? Math.max(d.buckets[0], this._hourly?.from ?? 0) : 0;
    const runsCover = d && d.buckets[0] >= (this._hourly?.from ?? Infinity) - 60000;
    for (const [i, it] of this._items.entries()) {
      const t = this._tiles[it.entity];
      const st = h.states[it.entity];
      t.name.textContent = this._name(it);
      t.icon.setAttribute("icon", this._icon(it));
      t.el.title = st ? `${this._name(it)}: ${st.state} ${st.attributes.unit_of_measurement || ""}` : `${it.entity} not found`;
      const w = this._watts(it);
      const on = w != null && w > (it.threshold ?? 5);
      t.el.classList.toggle("on", on);
      t.live.textContent = on ? (w >= 1000 ? `${this._kwh(w / 1000)} kW` : `${Math.round(w)} W`) : "";
      if (!st) {
        t.v.textContent = "–";
        t.cost.textContent = "";
        t.s1.textContent = "Not found";
        t.s2.textContent = t.s3.textContent = "";
        continue;
      }
      const tot = totals[i];
      t.v.textContent = tot != null ? this._kwh(tot) : "–";
      t.cost.textContent = tot != null ? this._cost(tot) : "";
      const p = d?.prev[it.entity];
      if (d && p > 0.05) {
        const pct = Math.round(((tot - p) / p) * 100);
        t.s1.innerHTML = `<span class="${pct > 0 ? "up" : pct < 0 ? "down" : ""}">${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${this._pct(pct)}</span> vs previous ${rng.long}`;
      } else t.s1.textContent = d ? (tot > 0 ? "New this period" : "Not used") : "";

      // Runs: for the period when hourly data covers it, otherwise the last 30 days
      const rows = this._hourly?.rows?.[it.entity] || [];
      const runs = this._hourly ? this._runs(rows, runsCover ? runFrom : this._hourly.from) : [];
      if (this._hourly) {
        const per = runs.length ? runs.reduce((a, r) => a + r.kwh, 0) / runs.length : 0;
        const where = runsCover ? "" : " in 30 d";
        t.s2.textContent = runs.length
          ? `${runs.length} run${runs.length > 1 ? "s" : ""}${where} · ${this._kwh(per)} kWh${this._price() != null ? ` (${this._cost(per)})` : ""} each`
          : `No runs${where}`;
      } else t.s2.textContent = "";
      const allRuns = this._hourly ? this._runs(rows, 0) : [];
      const last = allRuns[allRuns.length - 1];
      t.s3.textContent = last ? `${on ? "Started" : "Last run"} ${this._ago(last.start)} · ${this._kwh(last.kwh)} kWh` : on ? "Running now" : "";
    }
  }

  _paintChart() {
    const body = this._els.body;
    const d = this._data;
    if (this._error || !d) {
      if (this._error) body.innerHTML = `<div class="msg">Couldn't load statistics. The sensors need a state class of total or total_increasing.</div>`;
      return;
    }
    const n = d.buckets.length;
    const totals = d.buckets.map((_, k) => this._items.reduce((a, it) => a + d.series[it.entity][k], 0));
    const max = Math.max(...totals);
    if (max <= 0) {
      body.innerHTML = `<div class="msg">No energy used in the last ${EU_RANGES[d.range].long}.</div>`;
      this._paintLegend(null);
      return;
    }
    const nice = (v) => {
      const p = 10 ** Math.floor(Math.log10(v));
      return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v);
    };
    const top = nice(max * 1.05);
    const W = 1000;
    const y = (v) => 100 - (v / top) * 96;
    const slot = W / n;
    const bw = slot * (n > 20 ? 0.66 : 0.56);
    const full = totals.slice(0, -1).filter((_, k) => k < n - 1);
    const avg = full.length ? full.reduce((a, b) => a + b, 0) / full.length : null;
    const bars = d.buckets
      .map((_, k) => {
        let base = 0;
        const x = (k * slot + (slot - bw) / 2).toFixed(1);
        const rects = this._items
          .map((it) => {
            const v = d.series[it.entity][k];
            if (v <= 0) return "";
            const y0 = y(base);
            base += v;
            const y1 = y(base);
            // Standby trickle gets no minimum height, so idle hours stay flat
            const hgt = v >= top * 0.01 ? Math.max(0.6, y0 - y1) : y0 - y1;
            return `<rect x="${x}" y="${y1.toFixed(2)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(2)}" fill="${it.color}"${k === n - 1 ? ' opacity="0.6"' : ""}></rect>`;
          })
          .join("");
        return `<g data-k="${k}">${rects}</g>`;
      })
      .join("");
    const tickIdx = n <= 8 ? d.buckets.map((_, k) => k) : [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];

    body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid"><line x1="0" x2="${W}" y1="${y(top)}" y2="${y(top)}"></line><line x1="0" x2="${W}" y1="${y(top / 2)}" y2="${y(top / 2)}"></line><line x1="0" x2="${W}" y1="100" y2="100"></line></g>
          <g class="bars">${bars}</g>
          ${avg ? `<line class="avgln" x1="0" x2="${W}" y1="${y(avg).toFixed(2)}" y2="${y(avg).toFixed(2)}"></line>` : ""}
        </svg>
        <span class="ax" style="top:${y(top) * 1.4}px">${this._kwh(top).replace(/[.,]0+$/, "")}</span>
        <span class="ax" style="top:${y(top / 2) * 1.4}px">${this._kwh(top / 2).replace(/[.,]0+$/, "")}</span>
        <span class="ax" style="top:${100 * 1.4}px">0</span>
        <div class="times">${tickIdx
          .map((k) => `<span style="left:${((k + 0.5) / n) * 100}%">${k === n - 1 && d.period !== "month" ? (d.period === "hour" ? "Now" : "Today") : this._label(d.buckets[k], d.period, false)}</span>`)
          .join("")}</div>
      </div>`;

    const plot = body.querySelector(".plot");
    const svg = plot.querySelector("svg");
    const groups = [...plot.querySelectorAll(".bars g")];
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const f = Math.min(0.9999, Math.max(0, (ev.clientX - box.left) / box.width));
      const k = Math.floor(f * n);
      if (k === this._scrub) return;
      this._scrub = k;
      groups.forEach((g, i) => g.classList.toggle("hl", i === k));
      plot.classList.add("scrub");
      this._paintLegend(k, totals, avg);
    };
    const leave = () => {
      this._scrub = null;
      plot.classList.remove("scrub");
      groups.forEach((g) => g.classList.remove("hl"));
      this._paintLegend(null, totals, avg);
    };
    plot.addEventListener("pointermove", move);
    plot.addEventListener("pointerdown", move);
    plot.addEventListener("pointerleave", leave);
    plot.addEventListener("pointercancel", leave);
    this._paintLegend(null, totals, avg);
  }

  _paintLegend(k, totals, avg) {
    const d = this._data;
    const lg = this._els.legend;
    if (!d) return (lg.innerHTML = "");
    const parts = [];
    if (k == null) {
      const peak = totals ? totals.indexOf(Math.max(...totals)) : -1;
      parts.push(`<span class="lg when">${d.period === "hour" ? "Each hour" : d.period === "day" ? "Each day" : "Each month"}</span>`);
      if (avg) parts.push(`<span class="lg"><span class="sw line"></span>Avg <b>${this._kwh(avg)}</b> kWh</span>`);
      if (peak >= 0 && totals[peak] > 0) parts.push(`<span class="lg">Peak <b>${this._kwh(totals[peak])}</b> ${this._label(d.buckets[peak], d.period, false)}</span>`);
    } else {
      parts.push(`<span class="lg when">${this._label(d.buckets[k], d.period, true)}</span>`);
      for (const it of this._items) {
        const v = d.series[it.entity][k];
        parts.push(`<span class="lg" style="--c:${it.color}"><span class="sw"></span><b>${this._kwh(v)}</b> kWh</span>`);
      }
      const c = this._cost(totals[k]);
      if (c && this._items.length > 1) parts.push(`<span class="lg">Total <b>${this._kwh(totals[k])}</b>${c ? ` · ${c}` : ""}</span>`);
      else if (c) parts.push(`<span class="lg"><b>${c}</b></span>`);
    }
    lg.innerHTML = parts.join("");
  }

  _paintHabits() {
    const el = this._els.habits;
    const hr = this._hourly;
    if (!hr?.rows) {
      el.hidden = true;
      return;
    }
    const byHour = this._items.map(() => Array(24).fill(0));
    const byDay = this._items.map(() => Array(7).fill(0)); // Mon..Sun
    let total = 0;
    let off = 0;
    const hasOff = this._offPeak(0) != null;
    this._items.forEach((it, i) => {
      for (const r of hr.rows[it.entity] || []) {
        if (r.t < hr.from) continue;
        const dt = new Date(r.t);
        byHour[i][dt.getHours()] += r.v;
        byDay[i][(dt.getDay() + 6) % 7] += r.v;
        total += r.v;
        if (hasOff) off += r.v * this._offPeak(dt.getHours());
      }
    });
    if (total <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const hourTot = Array.from({ length: 24 }, (_, hh) => byHour.reduce((a, s) => a + s[hh], 0));
    const dayTot = Array.from({ length: 7 }, (_, k) => byDay.reduce((a, s) => a + s[k], 0));

    // Busiest 3-hour window
    let bestH = 0;
    let bestV = -1;
    for (let hh = 0; hh < 24; hh++) {
      const v = hourTot[hh] + hourTot[(hh + 1) % 24] + hourTot[(hh + 2) % 24];
      if (v > bestV) {
        bestV = v;
        bestH = hh;
      }
    }
    const pad = (x) => String(x % 24).padStart(2, "0");
    const lang = this._hass?.locale?.language;
    const dayNames = Array.from({ length: 7 }, (_, k) => new Date(2024, 0, 1 + k).toLocaleDateString(lang, { weekday: "short" })); // 1 Jan 2024 = Monday
    const busyDay = dayTot.indexOf(Math.max(...dayTot));

    const stack = (series, n, W, gap) => {
      const max = Math.max(...Array.from({ length: n }, (_, k) => series.reduce((a, s) => a + s[k], 0))) || 1;
      const slot = W / n;
      const bw = slot * gap;
      let out = "";
      for (let k = 0; k < n; k++) {
        let base = 0;
        for (const [i, s] of series.entries()) {
          const v = s[k];
          if (v <= 0) continue;
          const y0 = 100 - (base / max) * 96;
          base += v;
          const y1 = 100 - (base / max) * 96;
          out += `<rect x="${(k * slot + (slot - bw) / 2).toFixed(1)}" y="${y1.toFixed(2)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, y0 - y1).toFixed(2)}" rx="1" fill="${this._items[i].color}"></rect>`;
        }
      }
      return out;
    };
    let opBands = "";
    if (hasOff) {
      const m = (s) => {
        const [hh, mm] = String(s).split(":").map(Number);
        return (hh || 0) * 60 + (mm || 0);
      };
      const [a, b] = this._config.off_peak.map(m);
      const rect = (x0, x1) => `<rect class="op" x="${((x0 / 1440) * 1000).toFixed(1)}" y="0" width="${(((x1 - x0) / 1440) * 1000).toFixed(1)}" height="100"></rect>`;
      opBands = a <= b ? rect(a, b) : rect(a, 1440) + rect(0, b);
    }

    const facts = [
      `<span class="fact" style="--c:#ffb74d"><ha-icon icon="mdi:clock-outline"></ha-icon>Busiest <b>${pad(bestH)}:00–${pad(bestH + 3)}:00</b></span>`,
      `<span class="fact" style="--c:#4fc3f7"><ha-icon icon="mdi:calendar-week"></ha-icon>Busiest day <b>${dayNames[busyDay]}</b></span>`,
    ];
    if (hasOff) facts.push(`<span class="fact" style="--c:#9575cd"><ha-icon icon="mdi:weather-night"></ha-icon>Off-peak <b>${Math.round((off / total) * 100)}%</b></span>`);
    const price = this._price();
    if (price != null) facts.push(`<span class="fact" style="--c:#81c784"><ha-icon icon="mdi:cash"></ha-icon>30 days <b>${this._money(total * price)}</b></span>`);

    el.innerHTML = `
      <div class="hb-head"><span>When they run</span><span class="sub">last 30 days · ${this._kwh(total)} kWh</span></div>
      <div class="hb-grid">
        <div>
          <div class="hb-title"><span>By hour of day</span>${hasOff ? `<span>shaded = off-peak</span>` : ""}</div>
          <div class="mini"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${opBands}${stack(byHour, 24, 1000, 0.7)}</svg>
            <div class="lbls">${[0, 6, 12, 18].map((hh) => `<span style="left:${((hh + 0.5) / 24) * 100}%">${pad(hh)}</span>`).join("")}<span style="left:${(23.5 / 24) * 100}%">23</span></div></div>
        </div>
        <div>
          <div class="hb-title"><span>By weekday</span></div>
          <div class="mini"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${stack(byDay, 7, 1000, 0.6)}</svg>
            <div class="lbls">${dayNames.map((nm, k) => `<span style="left:${((k + 0.5) / 7) * 100}%">${nm.slice(0, 2)}</span>`).join("")}</div></div>
        </div>
      </div>
      <div class="facts">${facts.join("")}</div>`;
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("energy-usage-card")) customElements.define("energy-usage-card", EnergyUsageCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-usage-card",
  name: "Energy Usage Card",
  description: "Appliance energy and cost with runs, comparisons, a stacked bar graph and usage habits",
});
