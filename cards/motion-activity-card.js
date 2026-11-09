/**
 * motion-activity-card  (v2)
 * Same look as heating-dial-card and waste-collection-card.
 *
 * Shows UniFi Protect (or any) detections as activity instead of a thin timeline:
 * - Optional camera snapshot that refreshes every few seconds; tap for the live view.
 * - Status: what is being detected now, or how long since the last detection.
 * - One sensor: detections, busiest hour and motion time, plus a bar chart per hour.
 * - Several sensors (motion, person, vehicle, doorbell…): a count per type and an
 *   hour-by-hour heat strip for each, so person detections aren't lost inside motion.
 * - Recent detections as chips, coloured by type.
 * - Optional button that opens a link, e.g. UniFi Protect.
 *
 * Config:
 *   type: custom:motion-activity-card
 *   title: Front door
 *   camera_entity: camera.front_door_high_resolution_channel   # optional
 *   camera_refresh: 10                                         # seconds
 *   entities:                    # or a single `entity:`
 *     - binary_sensor.front_door_motion
 *     - entity: binary_sensor.front_door_person_detected
 *       name: Person
 *     - event.front_door_doorbell                               # event entities count each press
 *   hours: 24
 *   bucket_minutes: 60           # default 60, or 30 when hours <= 12
 *   recent: 8
 *   url: https://cloud-key.example/protect/
 *   url_label: Open Protect
 *
 * Install: copy to /config/www/motion-activity-card.js and add the resource
 * /local/motion-activity-card.js?v=2 (type: JavaScript module).
 */

const MA_REFRESH_MS = 5 * 60 * 1000;
const MA_MIN = 60000;

// [pattern, label, colour, icon, priority (lower = more important)]
const MA_TYPES = [
  [/doorbell|ring/i, "Doorbell", "#ef5350", "mdi:doorbell", 0],
  [/smoke|co_alarm|alarm/i, "Alarm", "#e53935", "mdi:smoke-detector-variant-alert", 0],
  [/person|people|human/i, "Person", "#42a5f5", "mdi:walk", 1],
  [/vehicle|\bcar\b/i, "Vehicle", "#ab47bc", "mdi:car", 2],
  [/animal|pet/i, "Animal", "#a1887f", "mdi:paw", 3],
  [/package|parcel/i, "Package", "#26a69a", "mdi:package-variant-closed", 4],
  [/speak|voice|audio/i, "Speaking", "#90a4ae", "mdi:account-voice", 5],
  [/motion/i, "Motion", "#ffb300", "mdi:motion-sensor", 9],
];

const MA_STYLE = `
  ha-card { padding: 14px 16px 16px; container-type: inline-size; }
  .top { display: flex; align-items: center; gap: 12px; }
  .badge {
    flex: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--secondary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    transition: color 0.2s, background 0.2s;
  }
  .badge ha-icon { --mdc-icon-size: 22px; }
  ha-card.on .badge { color: var(--ac); background: color-mix(in srgb, var(--ac) 22%, transparent); }
  .head { flex: 1; min-width: 0; cursor: pointer; }
  .title { font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; }
  ha-card.on .status { color: var(--ac); font-weight: 500; }
  .link {
    flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 999px;
    font-size: 13px; font-weight: 500; text-decoration: none; color: var(--primary-text-color);
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
  .link:hover { background: color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
  .link:focus-visible, .cam:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .link ha-icon { --mdc-icon-size: 18px; }

  /* Camera */
  .cam {
    position: relative; display: block; width: 100%; margin-top: 12px; padding: 0; border: none; cursor: pointer;
    aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .cam img { display: block; width: 100%; height: 100%; object-fit: cover; }
  ha-card.on .cam { box-shadow: inset 0 0 0 2px var(--ac); }
  .cam-tag {
    position: absolute; left: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; color: #fff;
    background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px);
  }
  .cam-tag ha-icon { --mdc-icon-size: 16px; }
  .cam-tag.alert { background: color-mix(in srgb, var(--ac) 85%, black); }
  .cam-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--secondary-text-color); }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 6px; margin-top: 12px; }
  .st { padding: 8px 10px; border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); min-width: 0; cursor: default; }
  .st[role="button"] { cursor: pointer; }
  .st-l { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-l ha-icon { --mdc-icon-size: 15px; color: var(--tc); flex: none; }
  .st-v { font-size: 17px; margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-s { font-size: 12px; color: var(--secondary-text-color); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .st.dead { opacity: 0.5; }
  .st.live .st-s { color: var(--tc); font-weight: 500; }

  /* Charts */
  .chart { margin-top: 10px; padding: 10px 10px 6px; border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .chart-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--secondary-text-color); min-height: 16px; }
  .chart-head b { font-weight: 500; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .bars { display: flex; align-items: flex-end; gap: 2px; height: 84px; margin-top: 6px; touch-action: pan-y; }
  .bar { flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; cursor: pointer; }
  .bar i { display: block; width: 100%; border-radius: 3px 3px 1px 1px; min-height: 2px; background: color-mix(in srgb, var(--tc) 70%, transparent); }
  .bar.zero i { background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .bar.now i { background: var(--tc); }
  .bar.sel i { background: var(--primary-text-color); }

  .hrows { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
  .hrow { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 8px; }
  .hl { display: flex; align-items: center; gap: 5px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hl ha-icon { --mdc-icon-size: 15px; color: var(--tc); flex: none; }
  .cells { display: flex; gap: 2px; height: 18px; touch-action: pan-y; }
  .cell { flex: 1; min-width: 0; border-radius: 3px; cursor: pointer; background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
  .cell.sel { outline: 2px solid var(--primary-text-color); outline-offset: -1px; }
  .hrow.dead { opacity: 0.45; }
  .axis { position: relative; height: 16px; margin-top: 5px; font-size: 11px; color: var(--secondary-text-color); }
  .axis.offset { margin-left: 92px; }
  .axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .axis span:first-child { transform: none; }
  .axis span:last-child { transform: translateX(-100%); }

  /* Recent */
  .recent { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .ev {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px 5px 8px; border-radius: 999px;
    font-size: 12px; font-variant-numeric: tabular-nums; color: var(--primary-text-color);
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .ev ha-icon { --mdc-icon-size: 14px; color: var(--tc); }
  .ev small { color: var(--secondary-text-color); font-size: 12px; }
  .ev.live { background: color-mix(in srgb, var(--tc) 20%, transparent); }
  .msg { padding: 14px 2px 2px; font-size: 13px; color: var(--secondary-text-color); }
  @media (prefers-reduced-motion: reduce) { .badge { transition: none; } }
`;

class MotionActivityCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "binary_sensor.motion", hours: 24 };
  }

  setConfig(config) {
    const list = config?.entities || (config?.entity ? [config.entity] : []);
    if (!list.length) throw new Error("Set entity: or entities: to your motion / detection sensors");
    this._config = { hours: 24, recent: 8, url_label: "Open Protect", camera_refresh: 10, ...config };
    this._items = list
      .map((x) => (typeof x === "string" ? { entity: x } : x))
      .filter((x) => x?.entity)
      .map((x) => {
        const t = MA_TYPES.find(([re]) => re.test(x.name || x.entity));
        return {
          entity: x.entity,
          isEvent: x.entity.startsWith("event."),
          name: x.name || t?.[1] || null,
          color: x.color || t?.[2] || "var(--primary-color)",
          icon: x.icon || t?.[3] || "mdi:motion-sensor",
          prio: t?.[4] ?? 5,
        };
      });
    const hrs = Number(this._config.hours) || 24;
    this._bucket = (Number(this._config.bucket_minutes) || (hrs <= 12 ? 30 : 60)) * MA_MIN;
    this._data = null;
    this._fetchedAt = 0;
    this._changeKey = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._els) return;
    const key = this._items.map((i) => hass.states[i.entity]?.last_changed).join("|");
    const changed = key !== this._changeKey;
    if (!this._loading && (Date.now() - this._fetchedAt > MA_REFRESH_MS || (changed && Date.now() - this._fetchedAt > 20000))) {
      this._changeKey = key;
      this._fetch();
    }
    this._paintStatus();
    this._paintCamera();
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._paintStatus(), 30000);
    clearInterval(this._camTimer);
    const secs = Math.max(2, Number(this._config?.camera_refresh) || 10);
    this._camTimer = setInterval(() => {
      if (document.visibilityState === "visible") this._paintCamera(true);
    }, secs * 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearInterval(this._camTimer);
  }

  getCardSize() {
    return (this._config?.camera_entity ? 4 : 0) + 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  _name(item) {
    return item.name || this._hass?.states[item.entity]?.attributes.friendly_name || item.entity;
  }

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>${MA_STYLE}</style>
      <ha-card>
        <div class="top">
          <div class="badge"><ha-icon icon="mdi:motion-sensor"></ha-icon></div>
          <div class="head" role="button" tabindex="0">
            <div class="title"></div>
            <div class="status" aria-live="polite"></div>
          </div>
          ${c.url ? `<a class="link" target="_blank" rel="noopener noreferrer"><ha-icon icon="mdi:cctv"></ha-icon><span></span></a>` : ""}
        </div>
        ${c.camera_entity
          ? `<button class="cam" aria-label="Open live view"><img alt=""><span class="cam-msg"></span><span class="cam-tag"><ha-icon icon="mdi:video-outline"></ha-icon><span>Live view</span></span></button>`
          : ""}
        <div class="body"><div class="msg">Loading activity…</div></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      card: $("ha-card"), title: $(".title"), status: $(".status"), head: $(".head"), body: $(".body"),
      link: $(".link"), badgeIcon: $(".badge ha-icon"), cam: $(".cam"), img: $(".cam img"),
      camMsg: $(".cam-msg"), camTag: $(".cam-tag"),
    };
    if (this._els.link) {
      this._els.link.href = c.url;
      this._els.link.querySelector("span").textContent = c.url_label;
    }
    const open = () => this._moreInfo(this._items[0].entity);
    this._els.head.addEventListener("click", open);
    this._els.head.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });
    if (this._els.cam) this._els.cam.addEventListener("click", () => this._moreInfo(c.camera_entity));
  }

  /* ---------- data ---------- */

  async _fetch() {
    const h = this._hass;
    const ids = this._items.map((i) => i.entity).filter((id) => h.states[id]);
    if (!ids.length) {
      this._els.body.innerHTML = `<div class="msg">Entity not found: ${this._items[0].entity}</div>`;
      return;
    }
    this._loading = true;
    const end = Date.now();
    const start = end - (Number(this._config.hours) || 24) * 3600000;
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
      const events = new Map();
      const dead = new Set();
      for (const item of this._items) {
        const rows = (res?.[item.entity] || [])
          .map((e) => ({
            s: e.s ?? e.state,
            t: e.lu != null ? e.lu * 1000 : e.lc != null ? e.lc * 1000 : Date.parse(e.last_changed || e.last_updated),
          }))
          .filter((r) => Number.isFinite(r.t))
          .sort((a, b) => a.t - b.t);
        if (rows.length && rows.every((r) => ["unavailable", "unknown"].includes(r.s))) dead.add(item.entity);
        events.set(item.entity, item.isEvent ? this._pressEvents(rows, start) : this._onEvents(rows, start, end));
      }
      this._data = { start, end, events, dead };
      this._error = false;
    } catch (err) {
      console.warn("motion-activity-card: could not load history", err);
      this._error = true;
    } finally {
      this._loading = false;
      this._fetchedAt = Date.now();
      this._paint();
    }
  }

  _onEvents(rows, start, end) {
    const out = [];
    let cur = null;
    for (const r of rows) {
      if (r.s === "on" && !cur) cur = { start: Math.max(r.t, start), clipped: r.t < start };
      else if (r.s !== "on" && cur) {
        cur.end = r.t;
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push({ ...cur, end, live: true });
    return out;
  }

  _pressEvents(rows, start) {
    // Event entities: the state is the time of each press
    const out = [];
    const seen = new Set();
    for (const r of rows) {
      const t = Date.parse(r.s);
      if (!Number.isFinite(t) || t < start || seen.has(t)) continue;
      seen.add(t);
      out.push({ start: t, end: t, instant: true });
    }
    return out;
  }

  /* ---------- formatting ---------- */

  _time(t) {
    return new Date(t).toLocaleTimeString(this._hass?.locale?.language, { hour: "2-digit", minute: "2-digit" });
  }

  _dur(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  _ago(t) {
    const m = Math.floor((Date.now() - t) / MA_MIN);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.floor(h / 24)} d ago`;
  }

  _list(names) {
    try {
      return new Intl.ListFormat(this._hass?.locale?.language, { type: "conjunction" }).format(names);
    } catch (_) {
      return names.join(", ");
    }
  }

  /* ---------- live parts ---------- */

  _active() {
    const h = this._hass;
    return this._items
      .filter((i) => {
        const st = h.states[i.entity];
        if (!st) return false;
        if (i.isEvent) return Number.isFinite(Date.parse(st.state)) && Date.now() - Date.parse(st.state) < 2 * MA_MIN;
        return st.state === "on";
      })
      .sort((a, b) => a.prio - b.prio);
  }

  _paintStatus() {
    const e = this._els;
    const h = this._hass;
    const c = this._config;
    if (!e || !h) return;
    const first = h.states[this._items[0].entity];
    e.title.textContent = c.title || first?.attributes.friendly_name || this._items[0].entity;
    let active = this._active();
    // Person/vehicle/etc. already imply motion, so don't list motion alongside them
    if (active.some((i) => i.prio < 9)) active = active.filter((i) => i.prio < 9);
    const on = active.length > 0;
    e.card.classList.toggle("on", on);
    const top = active[0] || this._items[0];
    e.card.style.setProperty("--ac", top.color);
    e.badgeIcon.setAttribute("icon", top.icon);

    let text;
    if (!first) text = "Entity not found";
    else if (on) {
      const names = active.map((i) => (i.isEvent ? `${this._name(i)} pressed` : this._name(i)));
      text = this._items.length === 1 ? `Motion now, started ${this._time(Date.parse(first.last_changed))}` : `${this._list(names)} detected now`;
      if (active[0].isEvent && active.length === 1) text = `${this._name(active[0])} pressed ${this._ago(Date.parse(h.states[active[0].entity].state))}`;
    } else if (this._data) {
      const lasts = [...this._items]
        .sort((a, b) => a.prio - b.prio)
        .map((i) => ({ i, ev: this._data.events.get(i.entity)?.at(-1) }))
        .filter((x) => x.ev);
      if (!lasts.length) text = "Clear. Nothing detected in this period";
      else if (this._items.length === 1) text = `Clear. Last motion ${this._ago(lasts[0].ev.start)} at ${this._time(lasts[0].ev.start)}`;
      else {
        const parts = lasts.slice(0, 2).map((x) => `${this._name(x.i).toLowerCase()} ${this._ago(x.ev.start)}`);
        text = `Clear. Last ${parts.join(", ")}`;
      }
    } else text = "Clear";
    e.status.textContent = text;

    if (e.camTag) {
      e.camTag.classList.toggle("alert", on);
      e.camTag.querySelector("ha-icon").setAttribute("icon", on ? top.icon : "mdi:video-outline");
      e.camTag.querySelector("span").textContent = on ? `${this._name(top)} detected` : "Live view";
    }
  }

  _paintCamera(force) {
    const e = this._els;
    if (!e?.img || !this._hass) return;
    const st = this._hass.states[this._config.camera_entity];
    const pic = st?.attributes.entity_picture;
    if (!pic || st.state === "unavailable") {
      e.camMsg.textContent = st ? "Camera unavailable" : "Camera not found";
      e.img.removeAttribute("src");
      this._camBase = null;
      return;
    }
    e.camMsg.textContent = "";
    if (!force && pic === this._camBase) return;
    this._camBase = pic;
    const src = `${pic}${pic.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const pre = new Image();
    pre.onload = () => {
      e.img.src = src;
    };
    pre.src = src; // swap only once loaded, so the picture never flashes blank
  }

  /* ---------- history parts ---------- */

  _paint() {
    const body = this._els.body;
    if (this._error || !this._data) {
      body.innerHTML = `<div class="msg">Couldn't load history. Check that the recorder is running.</div>`;
      return;
    }
    const { start, end, events, dead } = this._data;
    const b = this._bucket;
    const first = Math.floor(start / b) * b;
    const times = [];
    for (let t = first; t < end; t += b) times.push(t);
    const count = (list) => {
      const n = times.map(() => 0);
      const ms = times.map(() => 0);
      for (const x of list) {
        if (!x.clipped) {
          const i = Math.floor((x.start - first) / b);
          if (n[i] != null) n[i]++;
        }
        times.forEach((t, i) => {
          const ov = Math.min(x.end, t + b) - Math.max(x.start, t);
          if (ov > 0) ms[i] += ov;
        });
      }
      return { n, ms };
    };
    const hrs = Number(this._config.hours) || 24;
    const period = hrs % 24 === 0 && hrs > 24 ? `${hrs / 24} days` : `${hrs} h`;
    const per = b >= 3600000 ? "hour" : `${b / MA_MIN} min`;
    const single = this._items.length === 1;

    body.innerHTML = `
      <div class="stats"></div>
      <div class="chart">
        <div class="chart-head"><span class="ch-l"></span><span class="ch-r"></span></div>
        ${single ? `<div class="bars"></div><div class="axis"></div>` : `<div class="hrows"></div><div class="axis offset"></div>`}
      </div>
      <div class="recent"></div>`;
    const stats = body.querySelector(".stats");
    const chL = body.querySelector(".ch-l");
    const chR = body.querySelector(".ch-r");
    const range = (i) => `${this._time(times[i])}–${this._time(times[i] + b)}`;

    if (single) {
      const item = this._items[0];
      const list = events.get(item.entity) || [];
      const { n, ms } = count(list);
      const max = Math.max(1, ...n);
      const counted = list.filter((x) => !x.clipped).length;
      const totalMs = list.reduce((a, x) => a + (x.end - x.start), 0);
      let bi = -1;
      n.forEach((v, i) => {
        if (v > (n[bi] || 0)) bi = i;
      });
      stats.innerHTML = [
        this._stat("Detections", String(counted)),
        this._stat("Busiest", bi >= 0 ? `${this._time(times[bi])}, ${n[bi]}` : "–"),
        this._stat(item.isEvent ? "Last press" : "Motion time", item.isEvent ? (list.length ? this._time(list.at(-1).start) : "–") : totalMs ? this._dur(totalMs) : "–"),
      ].join("");
      chL.textContent = `Detections per ${per}`;
      const bars = body.querySelector(".bars");
      bars.style.setProperty("--tc", item.color);
      const sel = (i) => {
        bars.querySelectorAll(".bar").forEach((el, j) => el.classList.toggle("sel", j === i));
        chR.innerHTML = i == null ? "" : `${range(i)}: <b>${n[i]}</b>${ms[i] ? `, ${this._dur(ms[i])}` : ""}`;
      };
      n.forEach((v, i) => {
        const el = document.createElement("div");
        el.className = "bar";
        if (!v) el.classList.add("zero");
        if (i === n.length - 1) el.classList.add("now");
        el.title = `${this._time(times[i])}: ${v}`;
        const fill = document.createElement("i");
        fill.style.height = `${v ? Math.max(6, (v / max) * 100) : 2}%`;
        el.append(fill);
        el.addEventListener("pointerenter", () => sel(i));
        el.addEventListener("click", () => sel(i));
        bars.append(el);
      });
      bars.addEventListener("pointerleave", () => sel(null));
    } else {
      chL.textContent = `Detections per ${per}`;
      const rowsBox = body.querySelector(".hrows");
      const cellsAll = [];
      for (const item of this._items) {
        const list = events.get(item.entity) || [];
        const isDead = dead.has(item.entity) || !this._hass.states[item.entity];
        const counted = list.filter((x) => !x.clipped).length;
        const last = list.at(-1);
        const liveNow = this._active().includes(item);
        stats.insertAdjacentHTML(
          "beforeend",
          this._stat(
            this._name(item),
            isDead ? "–" : String(counted),
            isDead ? "Unavailable" : liveNow ? "Now" : last ? `Last ${this._time(last.start)}` : "None",
            { color: item.color, icon: item.icon, dead: isDead, live: liveNow, entity: item.entity }
          )
        );

        const { n, ms } = count(list);
        const max = Math.max(1, ...n);
        const row = document.createElement("div");
        row.className = "hrow";
        if (isDead) row.classList.add("dead");
        row.style.setProperty("--tc", item.color);
        row.innerHTML = `<div class="hl"><ha-icon></ha-icon><span></span></div><div class="cells"></div>`;
        row.querySelector("ha-icon").setAttribute("icon", item.icon);
        row.querySelector(".hl span").textContent = this._name(item);
        const cells = row.querySelector(".cells");
        n.forEach((v, i) => {
          const cell = document.createElement("div");
          cell.className = "cell";
          if (v) cell.style.background = `color-mix(in srgb, ${item.color} ${Math.round(25 + 75 * (v / max))}%, transparent)`;
          cell.title = `${this._name(item)} ${this._time(times[i])}: ${v}`;
          const show = () => {
            cellsAll.forEach((x) => x.classList.remove("sel"));
            cell.classList.add("sel");
            chR.innerHTML = `${this._name(item)}, ${range(i)}: <b>${v}</b>${ms[i] && !item.isEvent ? `, ${this._dur(ms[i])}` : ""}`;
          };
          cell.addEventListener("pointerenter", show);
          cell.addEventListener("click", show);
          cells.append(cell);
          cellsAll.push(cell);
        });
        rowsBox.append(row);
      }
      rowsBox.addEventListener("pointerleave", () => {
        cellsAll.forEach((x) => x.classList.remove("sel"));
        chR.textContent = "";
      });
      stats.querySelectorAll(".st[data-entity]").forEach((el) => {
        el.addEventListener("click", () => this._moreInfo(el.dataset.entity));
      });
    }

    // Time axis
    const axis = body.querySelector(".axis");
    const step = Math.max(1, Math.round(times.length / 5));
    for (let i = 0; i < times.length; i += step) {
      if (i / times.length > 0.85) break;
      const s = document.createElement("span");
      s.style.left = `${(i / times.length) * 100}%`;
      s.textContent = this._time(times[i]);
      axis.append(s);
    }
    const nowLbl = document.createElement("span");
    nowLbl.style.left = "100%";
    nowLbl.textContent = "Now";
    axis.append(nowLbl);

    // Recent detections, all types together
    const all = [];
    for (const item of this._items) for (const x of events.get(item.entity) || []) all.push({ ...x, item });
    all.sort((a, b2) => b2.start - a.start);
    const recent = all.slice(0, Number(this._config.recent) || 8);
    const box = body.querySelector(".recent");
    if (!recent.length) {
      box.outerHTML = `<div class="msg">Nothing detected in the last ${period}.</div>`;
    } else {
      for (const x of recent) {
        const chip = document.createElement("span");
        chip.className = "ev";
        chip.style.setProperty("--tc", x.item.color);
        if (x.live) chip.classList.add("live");
        chip.innerHTML = `<ha-icon></ha-icon><span></span><small></small>`;
        chip.querySelector("ha-icon").setAttribute("icon", x.item.icon);
        chip.querySelector("span").textContent = this._time(x.start);
        chip.querySelector("small").textContent = x.live ? "now" : x.instant ? this._name(x.item) : single ? this._dur(x.end - x.start) : `${this._name(x.item)}, ${this._dur(x.end - x.start)}`;
        chip.title = this._name(x.item);
        box.append(chip);
      }
    }
    this._paintStatus();
  }

  _stat(label, value, sub, opt = {}) {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
    const cls = ["st", opt.dead ? "dead" : "", opt.live ? "live" : ""].filter(Boolean).join(" ");
    const attrs = opt.entity ? ` role="button" tabindex="0" data-entity="${esc(opt.entity)}"` : "";
    const style = opt.color ? ` style="--tc:${esc(opt.color)}"` : "";
    const icon = opt.icon ? `<ha-icon icon="${esc(opt.icon)}"></ha-icon>` : "";
    return `<div class="${cls}"${attrs}${style}><div class="st-l">${icon}<span>${esc(label)}</span></div><div class="st-v">${esc(value)}</div>${sub != null ? `<div class="st-s">${esc(sub)}</div>` : ""}</div>`;
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("motion-activity-card")) customElements.define("motion-activity-card", MotionActivityCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "motion-activity-card",
  name: "Motion Activity Card",
  description: "Camera snapshot with motion, person and other detections as activity, plus a link out",
});
