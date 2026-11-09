/**
 * travel-time-card  (v1)
 * Same look as climate-overview-card and weather-forecast-card.
 * Works with Google Maps / Waze travel time sensors (state in minutes).
 *
 * - One tile per route: time now, how it compares with the usual time for this
 *   time of day, arrival time if you leave now, and distance. Tap a tile to graph
 *   it; tap again for its details.
 * - Today: today's times against the usual range (middle half of the last
 *   `days` days of the same kind, weekday or weekend) and the usual median for
 *   the rest of the day, with the best time to leave in the next 3 hours.
 * - Week: every route over the last 7 days.
 *
 * Config:
 *   type: custom:travel-time-card
 *   entities:
 *     - entity: sensor.google_travel_time
 *       name: Work
 *     - entity: sensor.work_besafety
 *       name: BeSafety
 *   days: 14            # history used for "usual"
 *   view: today         # or week
 *
 * Install: copy to /config/www/travel-time-card.js and add the resource
 * /local/travel-time-card.js?v=1 (type: JavaScript module).
 */

const TT_HOUR = 3600000;
const TT_DAY = 24 * TT_HOUR;
const TT_REFRESH_MS = 10 * 60 * 1000;
const TT_SLOT = 15 * 60 * 1000;
const TT_SLOTS = TT_DAY / TT_SLOT;
const TT_STALE = 2 * TT_HOUR;
const TT_COLORS = ["#4fc3f7", "#ffb74d", "#ba68c8", "#81c784", "#f06292"];
const TT_GOOD = "#66bb6a";
const TT_SLOW = "#ffb300";
const TT_BAD = "#ef5350";

const TT_STYLE = `
  ha-card { padding: 12px; container-type: inline-size; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .panel { border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }

  .routes { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; }
  .route { display: flex; flex-direction: column; min-width: 0; padding: 10px 12px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .route:hover { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .route.sel { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 75%, transparent); }
  .r-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .disc { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent); }
  .disc ha-icon { --mdc-icon-size: 17px; }
  .r-names { display: flex; flex-direction: column; min-width: 0; }
  .r-name { font-size: 13px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-path { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-val { display: flex; align-items: baseline; gap: 6px; margin-top: 8px; line-height: 1; }
  .r-val .v { font-size: 26px; font-variant-numeric: tabular-nums; }
  .r-val .u { font-size: 13px; color: var(--secondary-text-color); }
  .r-val .lvl { width: 8px; height: 8px; border-radius: 50%; background: var(--lvl, transparent); align-self: center; margin-left: 2px; }
  .r-sub { font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .r-sub + .r-sub { margin-top: 1px; }
  .r-sub.lvl { color: var(--lvl, var(--secondary-text-color)); }
  .dead { opacity: 0.6; }

  .chart { margin-top: 6px; padding: 10px 12px 8px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; font-variant-numeric: tabular-nums; }
  .lg { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .lg b { font-weight: 500; color: var(--primary-text-color); }
  .when { color: var(--primary-text-color); font-weight: 500; }
  .sw { width: 10px; height: 3px; border-radius: 2px; background: var(--c); }
  .sw.dash { background: repeating-linear-gradient(90deg, var(--c) 0 3px, transparent 3px 5px); }
  .sw.band { height: 8px; background: color-mix(in srgb, var(--c) 30%, transparent); }
  .seg { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .seg button { color: var(--secondary-text-color); font-size: 12px; padding: 3px 8px; border-radius: 8px; }
  .seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }

  .plot { position: relative; height: 136px; margin-top: 8px; padding: 0 0 0 34px; touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
  .plot svg { display: block; width: 100%; height: 120px; overflow: visible; }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .grid line.day { stroke: color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
  .ln { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; stroke-width: 2.25; }
  .ln.med { stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.8; }
  .band { stroke: none; opacity: 0.2; }
  .nowln { stroke: var(--primary-text-color); stroke-dasharray: 2 3; opacity: 0.45; vector-effect: non-scaling-stroke; }
  .cursor { position: absolute; top: 0; height: 120px; width: 1px; background: var(--primary-text-color); opacity: 0.5; pointer-events: none; display: none; }
  .plot.scrub .cursor { display: block; }
  .ax { position: absolute; left: 0; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none; color: var(--secondary-text-color); }
  .ax.t { top: 0; } .ax.b { top: 110px; }
  .times { position: absolute; left: 34px; right: 0; bottom: 0; height: 12px; font-size: 11px; color: var(--secondary-text-color); pointer-events: none; }
  .times span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .times span:first-child { transform: none; }
  .times span:last-child { transform: translateX(-100%); }
  .hint { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; font-size: 13px;
    border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .hint ha-icon { --mdc-icon-size: 16px; color: var(--c); flex: none; }
  .hint span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
`;

class TravelTimeCard extends HTMLElement {
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((e) => e.startsWith("sensor.") && /travel|commute|waze/.test(e));
    return { entities: ids.length ? ids.slice(0, 2) : ["sensor.google_travel_time"] };
  }

  setConfig(config) {
    const list = config?.entities || (config?.entity ? [config.entity] : []);
    if (!list.length) throw new Error("Set entities: a list of travel time sensors");
    this._config = { days: 14, view: "today", ...config };
    this._routes = list.map((e, i) => {
      const r = typeof e === "string" ? { entity: e } : { ...e };
      if (!r.entity) throw new Error("Each route needs an entity");
      return { ...r, color: r.color || TT_COLORS[i % TT_COLORS.length] };
    });
    this._view = this._config.view === "week" ? "week" : "today";
    if (!this._routes.some((r) => r.entity === this._sel)) this._sel = this._routes[0].entity;
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
    if (!this._loading && Date.now() - this._fetchedAt > TT_REFRESH_MS) this._fetch();
    const key = this._routes.map((r) => hass.states[r.entity]);
    if (this._lastKey && key.every((s, i) => s === this._lastKey[i])) return;
    this._lastKey = key;
    this._paintRoutes();
    if (this._scrub == null && this._data) this._paintChart();
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
      <style>${TT_STYLE}</style>
      <ha-card>
        <div class="routes"></div>
        <div class="panel chart">
          <div class="top"><div class="legend"></div><div class="seg views" role="group" aria-label="Period"></div></div>
          <div class="body"><div class="msg">Loading history…</div></div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = { routes: $(".routes"), legend: $(".legend"), views: $(".views"), body: $(".body") };

    this._tiles = {};
    for (const r of this._routes) {
      const t = document.createElement("button");
      t.className = "route";
      t.style.setProperty("--c", r.color);
      t.innerHTML = `
        <div class="r-head"><span class="disc"><ha-icon></ha-icon></span><div class="r-names"><span class="r-name"></span><span class="r-path"></span></div></div>
        <div class="r-val"><span class="v">–</span><span class="u"></span><span class="lvl"></span></div>
        <div class="r-sub lvl s1"></div><div class="r-sub s2"></div>`;
      t.addEventListener("click", () => {
        if (this._sel === r.entity || this._routes.length === 1) return this._moreInfo(r.entity);
        this._sel = r.entity;
        this._paintRoutes();
        this._paintChart();
      });
      this._els.routes.append(t);
      const q = (s) => t.querySelector(s);
      this._tiles[r.entity] = { el: t, icon: q("ha-icon"), name: q(".r-name"), path: q(".r-path"), v: q(".v"), u: q(".u"), s1: q(".s1"), s2: q(".s2") };
    }

    for (const [v, label] of [["today", "Today"], ["week", "Week"]]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("aria-pressed", String(v === this._view));
      b.addEventListener("click", () => {
        if (this._view === v) return;
        this._view = v;
        this._els.views.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this._paintChart();
      });
      this._els.views.append(b);
    }
  }

  /* ---------- helpers ---------- */

  _num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _minutes(st, raw) {
    const v = this._num(raw ?? st?.state);
    if (v == null) return null;
    const u = String(st?.attributes?.unit_of_measurement || "min").toLowerCase();
    if (u === "s") return v / 60;
    if (u === "h") return v * 60;
    if (u === "d") return v * 1440;
    return v;
  }

  _dur(m) {
    const r = Math.round(m);
    if (r < 60) return [String(r), "min"];
    const h = Math.floor(r / 60);
    return [`${h} h ${String(r % 60).padStart(2, "0")}`, ""];
  }

  _durText(m) {
    const [v, u] = this._dur(m);
    return u ? `${v} ${u}` : v;
  }

  _time(t, opts = {}) {
    return new Date(t).toLocaleTimeString(this._hass?.locale?.language, { hour: "2-digit", minute: "2-digit", ...opts });
  }

  _day(t) {
    return new Date(t).toLocaleDateString(this._hass?.locale?.language, { weekday: "short" });
  }

  _midnight(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  _place(v) {
    if (v == null || v === "") return "";
    const s = String(v);
    const st = this._hass.states[s];
    if (st) return st.attributes.friendly_name || s;
    if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(s)) return "";
    return s.split(",")[0].trim();
  }

  _distance(a) {
    const d = a.distance;
    if (d == null || d === "") return "";
    if (typeof d === "number" || /^[\d.]+$/.test(String(d))) {
      const imperial = this._hass.config?.unit_system?.length === "mi" || a.units === "imperial";
      return `${Math.round(Number(d) * 10) / 10} ${imperial ? "mi" : "km"}`;
    }
    return String(d);
  }

  _modeIcon(st, r) {
    if (r.icon) return r.icon;
    const m = String(st?.attributes.travel_mode || st?.attributes.mode || "").toLowerCase();
    if (m.includes("transit") || m.includes("bus")) return "mdi:bus";
    if (m.includes("walk")) return "mdi:walk";
    if (m.includes("bicycl") || m.includes("bike")) return "mdi:bike";
    return st?.attributes.icon || "mdi:car";
  }

  _at(series, t, maxAge = Infinity) {
    let lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0 || t - series[best].t > maxAge) return null;
    return series[best].v;
  }

  _q(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /* ---------- data ---------- */

  async _fetch() {
    const h = this._hass;
    const ids = this._routes.map((r) => r.entity).filter((id) => h.states[id]);
    if (!ids.length) {
      this._els.body.innerHTML = `<div class="msg">Travel time sensors not found.</div>`;
      this._fetchedAt = Date.now();
      return;
    }
    this._loading = true;
    const end = Date.now();
    const days = Math.max(1, Number(this._config.days) || 14);
    const start = this._midnight(end) - days * TT_DAY;
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
      for (const r of this._routes) {
        const st = h.states[r.entity];
        series[r.entity] = (res?.[r.entity] || [])
          .map((e) => ({
            t: e.lu != null ? e.lu * 1000 : e.lc != null ? e.lc * 1000 : Date.parse(e.last_changed || e.last_updated),
            v: this._minutes(st, e.s ?? e.state),
          }))
          .filter((x) => Number.isFinite(x.t))
          .sort((a, b) => a.t - b.t);
      }
      this._data = { start, end, days, series, usual: {} };
      for (const r of this._routes) this._data.usual[r.entity] = this._usual(series[r.entity], end, days);
      this._error = false;
    } catch (err) {
      console.warn("travel-time-card: could not load history", err);
      this._error = true;
    } finally {
      this._loading = false;
      this._fetchedAt = Date.now();
      this._paintRoutes();
      this._paintChart();
    }
  }

  // Usual times per 15-minute slot from previous days of the same kind
  _usual(series, now, days) {
    const today = this._midnight(now);
    const weekend = (t) => [0, 6].includes(new Date(t).getDay());
    const isWe = weekend(now);
    const all = [];
    for (let d = 1; d <= days; d++) {
      const mid = this._midnight(today - d * TT_DAY + TT_HOUR * 12);
      const vals = [];
      let any = false;
      for (let s = 0; s < TT_SLOTS; s++) {
        const v = this._at(series, mid + s * TT_SLOT, TT_STALE);
        vals.push(v);
        if (v != null) any = true;
      }
      if (any) all.push({ we: weekend(mid), vals });
    }
    let pick = all.filter((x) => x.we === isWe);
    let kind = isWe ? "weekend" : "weekday";
    if (pick.length < 2) {
      pick = all;
      kind = "day";
    }
    if (!pick.length) return null;
    const slots = [];
    for (let s = 0; s < TT_SLOTS; s++) {
      const v = pick.map((x) => x.vals[s]).filter((x) => x != null).sort((a, b) => a - b);
      slots.push(v.length >= 2 ? { lo: this._q(v, 0.25), med: this._q(v, 0.5), hi: this._q(v, 0.75), n: v.length } : v.length ? { lo: v[0], med: v[0], hi: v[0], n: 1 } : null);
    }
    return { slots, days: pick.length, kind };
  }

  _usualNow(entity, t = Date.now()) {
    const u = this._data?.usual[entity];
    if (!u) return null;
    const s = Math.floor((t - this._midnight(t)) / TT_SLOT);
    return u.slots[Math.min(TT_SLOTS - 1, s)];
  }

  _level(now, med) {
    if (now == null || med == null) return null;
    const r = now / med;
    if (r <= 1.08 || now - med < 2) return TT_GOOD;
    if (r <= 1.3) return TT_SLOW;
    return TT_BAD;
  }

  /* ---------- painting ---------- */

  _paintRoutes() {
    const h = this._hass;
    if (!h) return;
    for (const r of this._routes) {
      const t = this._tiles[r.entity];
      const st = h.states[r.entity];
      t.el.classList.toggle("sel", r.entity === this._sel && this._routes.length > 1);
      t.icon.setAttribute("icon", this._modeIcon(st, r));
      const name = r.name || st?.attributes.friendly_name || r.entity;
      t.name.textContent = name;
      const a = st?.attributes || {};
      const o = this._place(a.origin);
      const d = this._place(a.destination);
      t.path.textContent = o && d ? `${o} → ${d}` : d ? `To ${d}` : o ? `From ${o}` : "";
      t.path.hidden = !t.path.textContent;
      const m = this._minutes(st);
      t.el.classList.toggle("dead", m == null);
      if (m == null) {
        t.v.textContent = "–";
        t.u.textContent = "";
        t.s1.textContent = st ? "Unavailable" : "Not found";
        t.s2.textContent = "";
        t.el.style.removeProperty("--lvl");
        continue;
      }
      const [v, u] = this._dur(m);
      t.v.textContent = v;
      t.u.textContent = u;
      const usual = this._usualNow(r.entity);
      const lvl = this._level(m, usual?.med);
      if (lvl) t.el.style.setProperty("--lvl", lvl);
      else t.el.style.removeProperty("--lvl");
      if (usual) {
        const diff = Math.round(m - usual.med);
        t.s1.textContent = Math.abs(diff) < 2 ? "About usual for now" : `${Math.abs(diff)} min ${diff > 0 ? "slower" : "quicker"} than usual`;
      } else t.s1.textContent = this._data ? "No usual time yet" : "";
      const dist = this._distance(a);
      t.s2.textContent = [`Arrive ${this._time(Date.now() + m * 60000)}`, dist].filter(Boolean).join(" · ");
    }
  }

  _paintChart() {
    if (!this._els) return;
    const d = this._data;
    if (this._error || !d) {
      if (this._error) this._els.body.innerHTML = `<div class="msg">Couldn't load history. Check that the recorder is running.</div>`;
      return;
    }
    if (this._view === "week") this._paintWeek();
    else this._paintToday();
  }

  _scrubber(plot, svg, n, onMove, onLeave) {
    const cursor = plot.querySelector(".cursor");
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const pbox = plot.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      const i = Math.round(f * (n - 1));
      this._scrub = i;
      cursor.style.left = `${box.left - pbox.left + (i / (n - 1)) * box.width}px`;
      plot.classList.add("scrub");
      onMove(i);
    };
    const leave = () => {
      this._scrub = null;
      plot.classList.remove("scrub");
      onLeave();
    };
    plot.addEventListener("pointermove", move);
    plot.addEventListener("pointerdown", move);
    plot.addEventListener("pointerleave", leave);
    plot.addEventListener("pointercancel", leave);
  }

  _poly(vals, x, y, cls, color) {
    const segs = [];
    let cur = [];
    vals.forEach((v, i) => {
      if (v == null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(2)}`);
    });
    if (cur.length) segs.push(cur);
    return segs.map((s) => `<polyline class="${cls}" stroke="${color}" points="${s.join(" ")}"></polyline>`).join("");
  }

  _scale(vals) {
    const v = vals.filter((x) => x != null);
    if (!v.length) return [0, 10];
    let lo = Math.floor((Math.min(...v) * 0.9) / 5) * 5;
    let hi = Math.ceil((Math.max(...v) * 1.05) / 5) * 5;
    if (hi - lo < 10) hi = lo + 10;
    return [Math.max(0, lo), hi];
  }

  _paintToday() {
    const d = this._data;
    const r = this._routes.find((x) => x.entity === this._sel) || this._routes[0];
    const st = this._hass.states[r.entity];
    const series = d.series[r.entity] || [];
    const usual = d.usual[r.entity];
    const now = Date.now();
    const mid = this._midnight(now);
    const nowSlot = Math.min(TT_SLOTS - 1, Math.floor((now - mid) / TT_SLOT));
    const n = TT_SLOTS + 1;
    const today = [];
    for (let s = 0; s < n; s++) {
      const t = mid + s * TT_SLOT;
      today.push(t <= now ? this._at(series, t, TT_STALE) : null);
    }
    const live = this._minutes(st);
    if (live != null) today[nowSlot] = live;
    const slot = (s) => usual?.slots[Math.min(TT_SLOTS - 1, s)];
    if (!today.some((v) => v != null) && !usual) {
      this._els.body.innerHTML = `<div class="msg">No history yet for ${r.name || st?.attributes.friendly_name || r.entity}.</div>`;
      this._paintLegendToday(r, null, today, usual);
      return;
    }
    const all = [...today];
    if (usual) for (const s of usual.slots) if (s) all.push(s.lo, s.hi);
    const [lo, hi] = this._scale(all);
    const W = 1000;
    const x = (i) => (i / (n - 1)) * W;
    const y = (v) => 96 - ((v - lo) / (hi - lo)) * 92;

    let band = "";
    let med = "";
    if (usual) {
      const segs = [];
      let cur = [];
      for (let s = 0; s < n; s++) {
        const u = slot(s);
        if (!u) {
          if (cur.length) segs.push(cur);
          cur = [];
        } else cur.push([s, u]);
      }
      if (cur.length) segs.push(cur);
      band = segs
        .map((sg) => {
          const top = sg.map(([s, u]) => `${x(s).toFixed(1)},${y(u.hi).toFixed(2)}`);
          const bot = sg.slice().reverse().map(([s, u]) => `${x(s).toFixed(1)},${y(u.lo).toFixed(2)}`);
          return `<polygon class="band" fill="${r.color}" points="${top.join(" ")} ${bot.join(" ")}"></polygon>`;
        })
        .join("");
      med = this._poly(Array.from({ length: n }, (_, s) => slot(s)?.med ?? null), x, y, "ln med", r.color);
    }
    const line = this._poly(today, x, y, "ln", r.color);
    const nowX = x((now - mid) / TT_SLOT);
    const ticks = [0, 6, 12, 18, 24];

    this._els.body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid"><line x1="0" x2="${W}" y1="4" y2="4"></line><line x1="0" x2="${W}" y1="50" y2="50"></line><line x1="0" x2="${W}" y1="96" y2="96"></line>
            ${ticks.slice(1, -1).map((hh) => `<line x1="${(hh / 24) * W}" x2="${(hh / 24) * W}" y1="4" y2="96"></line>`).join("")}</g>
          ${band}${med}${line}
          <line class="nowln" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="0" y2="100"></line>
        </svg>
        <div class="cursor"></div>
        <span class="ax t">${hi}m</span><span class="ax b">${lo}m</span>
        <div class="times">${ticks.map((hh) => `<span style="left:${(hh / 24) * 100}%">${hh === 24 ? "24:00" : this._time(mid + hh * TT_HOUR)}</span>`).join("")}</div>
      </div>
      <div class="hint"><ha-icon></ha-icon><span></span></div>`;

    const hint = this._hint(r, usual, nowSlot, live);
    const hEl = this._els.body.querySelector(".hint");
    if (hint) {
      hEl.style.setProperty("--c", hint.color);
      hEl.querySelector("ha-icon").setAttribute("icon", hint.icon);
      hEl.querySelector("span").textContent = hint.text;
    } else hEl.remove();

    const plot = this._els.body.querySelector(".plot");
    const svg = plot.querySelector("svg");
    this._scrubber(plot, svg, n, (i) => this._paintLegendToday(r, i, today, usual), () => this._paintLegendToday(r, null, today, usual));
    this._paintLegendToday(r, null, today, usual);
  }

  _hint(r, usual, nowSlot, live) {
    if (!usual) {
      return { icon: "mdi:history", color: "var(--secondary-text-color)", text: "Usual times appear after a couple of days of history" };
    }
    const mid = this._midnight(Date.now());
    const ahead = [];
    for (let s = nowSlot; s <= Math.min(TT_SLOTS - 1, nowSlot + 12); s++) if (usual.slots[s]) ahead.push({ s, med: usual.slots[s].med });
    if (!ahead.length) return null;
    const best = ahead.reduce((a, b) => (b.med < a.med - 0.25 ? b : a));
    const ref = live ?? ahead[0].med;
    const save = Math.round(ref - best.med);
    if (best.s > nowSlot && save >= 3) {
      return { icon: "mdi:clock-check-outline", color: TT_GOOD, text: `Leave around ${this._time(mid + best.s * TT_SLOT)} to save about ${save} min (usually ${this._durText(best.med)})` };
    }
    const worst = ahead.reduce((a, b) => (b.med > a.med ? b : a));
    if (worst.med - ref >= 3) {
      return { icon: "mdi:car-clock", color: TT_SLOW, text: `Leave now: it usually builds to ${this._durText(worst.med)} by ${this._time(mid + worst.s * TT_SLOT)}` };
    }
    return { icon: "mdi:check-circle-outline", color: TT_GOOD, text: "No better time to leave in the next 3 hours" };
  }

  _paintLegendToday(r, i, today, usual) {
    const lg = this._els.legend;
    const mid = this._midnight(Date.now());
    const st = this._hass.states[r.entity];
    const v = i == null ? this._minutes(st) : today[i];
    const u = i == null ? this._usualNow(r.entity) : usual?.slots[Math.min(TT_SLOTS - 1, i)];
    const parts = [`<span class="lg when">${i == null ? "Now" : this._time(mid + i * TT_SLOT)}</span>`];
    if (v != null) parts.push(`<span class="lg" style="--c:${r.color}"><span class="sw"></span><b>${this._durText(v)}</b></span>`);
    if (u) {
      parts.push(`<span class="lg" style="--c:${r.color}"><span class="sw dash"></span>Usual <b>${this._durText(u.med)}</b></span>`);
      if (u.hi - u.lo >= 1) parts.push(`<span class="lg" style="--c:${r.color}"><span class="sw band"></span>${Math.round(u.lo)}–${Math.round(u.hi)} min</span>`);
    }
    if (this._routes.length > 1 && i == null) parts.push(`<span class="lg">${r.name || st?.attributes.friendly_name || ""}</span>`);
    lg.innerHTML = parts.join("");
  }

  _paintWeek() {
    const d = this._data;
    const end = Date.now();
    const start = end - 7 * TT_DAY;
    const step = 30 * 60 * 1000;
    const n = Math.round((end - start) / step) + 1;
    const times = Array.from({ length: n }, (_, i) => start + i * step);
    const vals = {};
    const all = [];
    for (const r of this._routes) {
      vals[r.entity] = times.map((t) => this._at(d.series[r.entity] || [], t, TT_STALE));
      all.push(...vals[r.entity]);
    }
    if (!all.some((v) => v != null)) {
      this._els.body.innerHTML = `<div class="msg">No history yet for the last 7 days.</div>`;
      this._els.legend.innerHTML = "";
      return;
    }
    const [lo, hi] = this._scale(all);
    const W = 1000;
    const x = (i) => (i / (n - 1)) * W;
    const xt = (t) => ((t - start) / (end - start)) * W;
    const y = (v) => 96 - ((v - lo) / (hi - lo)) * 92;
    const mids = [];
    for (let m = this._midnight(start) + TT_DAY; m < end; m += TT_DAY) mids.push(m);
    // Selected route on top
    const order = [...this._routes].sort((a, b) => (a.entity === this._sel) - (b.entity === this._sel));
    const lines = order.map((r) => this._poly(vals[r.entity], x, y, "ln", r.color)).join("");

    this._els.body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid"><line x1="0" x2="${W}" y1="4" y2="4"></line><line x1="0" x2="${W}" y1="50" y2="50"></line><line x1="0" x2="${W}" y1="96" y2="96"></line>
            ${mids.map((m) => `<line class="day" x1="${xt(m).toFixed(1)}" x2="${xt(m).toFixed(1)}" y1="4" y2="96"></line>`).join("")}</g>
          ${lines}
        </svg>
        <div class="cursor"></div>
        <span class="ax t">${hi}m</span><span class="ax b">${lo}m</span>
        <div class="times">${mids.map((m) => `<span style="left:${((m + TT_DAY / 2 - start) / (end - start)) * 100}%;transform:translateX(-50%)">${this._day(m)}</span>`).join("")}</div>
      </div>`;

    const legend = (i) => {
      const parts = [`<span class="lg when">${i == null ? "Last 7 days" : `${this._day(times[i])} ${this._time(times[i])}`}</span>`];
      for (const r of this._routes) {
        const st = this._hass.states[r.entity];
        const name = r.name || st?.attributes.friendly_name || r.entity;
        let txt;
        if (i == null) {
          const v = vals[r.entity].filter((x) => x != null);
          txt = v.length ? `${name} <b>${Math.round(Math.min(...v))}–${Math.round(Math.max(...v))}</b> min` : `${name} –`;
        } else {
          const v = vals[r.entity][i];
          txt = `${name} <b>${v != null ? this._durText(v) : "–"}</b>`;
        }
        parts.push(`<span class="lg" style="--c:${r.color}"><span class="sw"></span>${txt}</span>`);
      }
      this._els.legend.innerHTML = parts.join("");
    };
    const plot = this._els.body.querySelector(".plot");
    this._scrubber(plot, plot.querySelector("svg"), n, legend, () => legend(null));
    legend(null);
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("travel-time-card")) customElements.define("travel-time-card", TravelTimeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "travel-time-card",
  name: "Travel Time Card",
  description: "Journey times now, against the usual for this time of day, with today and week graphs",
});
