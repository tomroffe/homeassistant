/**
 * dehumidifier-card  (v2)
 * v2: `show_controls: false` shows only the history graph and stats.
 * A Home Assistant Lovelace card for a dehumidifier (any `humidifier.*` entity),
 * in the same style as heating-dial-card.
 *
 * - 270° dial: the big number is the target humidity, the dot is the room's
 *   humidity now. The arc is filled from the target up to the top of the range,
 *   the band the dehumidifier pulls the room out of.
 * - −/+ change the target (debounced), the middle button turns it on or off.
 * - Fault banners (tank full, defrosting, sensor errors) from the device's
 *   problem binary sensors.
 * - Tiles: water tank, timer and child lock, plus any other switch, select or
 *   number on the same device. Override with `controls:`.
 * - History: humidity, target and running periods with tank-full marks, plus
 *   running time, humidity range, time on target and tank-full count.
 *
 * Every related entity is found from the humidifier's device, so only `entity`
 * is required.
 *
 * Install: copy to /config/www/dehumidifier-card.js and add the resource
 * /local/dehumidifier-card.js?v=2 (type: JavaScript module).
 */

const ARC = "M 40.6 159.4 A 84 84 0 1 1 159.4 159.4"; // 270° arc, r=84, centre 100,100
const WATER = "var(--blue-color, #2196f3)";
const ALERT = "var(--error-color, #db4437)";
const WARN = "var(--warning-color, #ffa600)";
const COMMIT_DELAY = 1000; // wait for more -/+ taps before sending
const PENDING_TIMEOUT = 15000; // give up waiting for the new target to show
const REFRESH_MS = 5 * 60 * 1000;
const POINTS = 144;
const MIN = 60000;
const HOUR = 3600000;

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const isDead = (st) => !st || ["unavailable", "unknown"].includes(st.state);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card { padding: 12px 16px 16px; container-type: inline-size; height: 100%; box-sizing: border-box; }
  .header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 36px; }
  .name { font-size: 22px; font-weight: 400; color: var(--primary-text-color); max-width: calc(100% - 80px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .more { position: absolute; right: -4px; top: 50%; transform: translateY(-50%); }
  button {
    background: none; border: none; color: var(--primary-text-color);
    cursor: pointer; padding: 8px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font: inherit;
  }
  button:focus-visible { outline: 2px solid var(--dial-color); outline-offset: 2px; }

  /* No title: keep only the menu button, top right */
  ha-card.noname { position: relative; }
  ha-card.noname .header { position: absolute; top: 6px; right: 12px; min-height: 0; z-index: 1; }
  ha-card.noname .name { display: none; }
  ha-card.noname .more { position: static; transform: none; }

  /* History only (show_controls: false) */
  ha-card.hist-only .header, ha-card.hist-only .dial, ha-card.hist-only .alerts,
  ha-card.hist-only .select-row, ha-card.hist-only .controls { display: none !important; }
  ha-card.hist-only .hist { margin-top: 0; }

  /* Dial */
  .dial {
    position: relative; width: min(100%, var(--dial-size)); aspect-ratio: 1; margin: 4px auto 0;
    container-type: inline-size;
  }
  svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .track, .fill { fill: none; stroke-width: 16; stroke-linecap: round; }
  .track { stroke: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .fill { stroke: var(--dial-color); stroke-opacity: 0.45; display: none; transition: stroke-opacity 0.3s; }
  ha-card.drying .fill { stroke-opacity: 1; }
  .handle { fill: #fff; stroke: var(--dial-color); stroke-width: 4; display: none; }
  ha-card.active .fill, ha-card.active .handle { display: inline; }
  .cur { fill: var(--primary-text-color); stroke: var(--card-background-color, #1c1c1c); stroke-width: 2; display: none; }
  ha-card.has-cur .cur { display: inline; }
  .center {
    position: absolute; top: 0; left: 0; right: 0; height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; pointer-events: none;
    color: var(--primary-text-color);
  }
  .label { font-size: max(13px, 6.7cqw); font-weight: 500; margin-bottom: 2cqw; text-align: center; max-width: 72%; min-height: 1.2em; }
  .big { display: flex; align-items: flex-start; line-height: 1; }
  .value { font-size: 18.7cqw; font-weight: 400; font-variant-numeric: tabular-nums; }
  .value.word { font-size: 12cqw; margin: 3.5cqw 0 3.2cqw; }
  .unit { font-size: max(12px, 6.7cqw); margin: 1.3cqw 0 0 1.3cqw; }
  .sub { display: flex; align-items: center; gap: max(10px, 4cqw); font-size: max(12px, 5.3cqw); margin-top: 4.5cqw; min-height: 1.2em; }
  .part { display: flex; align-items: center; gap: 2px; font-variant-numeric: tabular-nums; }
  .part ha-icon { --mdc-icon-size: max(14px, 6cqw); color: var(--secondary-text-color); }
  .buttons {
    position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
    display: flex; justify-content: center; gap: 4cqw;
  }
  .round {
    width: max(32px, 13.5cqw); height: max(32px, 13.5cqw);
    padding: 0; border: 1px solid var(--outline-color, var(--divider-color));
  }
  .round ha-icon { --mdc-icon-size: max(18px, 7cqw); }
  .round:disabled { opacity: 0.35; cursor: default; }
  .round.power.on { color: var(--dial-color); border-color: color-mix(in srgb, var(--dial-color) 60%, transparent); }

  /* Fault banners */
  .alerts { display: grid; gap: 6px; margin-top: 12px; }
  .alerts:empty { display: none; }
  .alert {
    display: flex; align-items: center; justify-content: flex-start; gap: 12px; width: 100%; box-sizing: border-box;
    min-height: 56px; padding: 8px 14px 8px 10px; border-radius: 12px; text-align: left;
    background: color-mix(in srgb, var(--ctl-color) 14%, transparent);
  }
  .a-main { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .a-sub { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Mode pill (only for models with modes) */
  .select-row {
    position: relative; display: flex; align-items: center; height: 56px; margin-top: 12px;
    padding-left: 16px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dial-color); margin-right: 20px; flex: none; }
  .select-row select {
    appearance: none; -webkit-appearance: none; flex: 1; height: 100%; padding-right: 44px;
    background: transparent; border: none; outline: none; cursor: pointer;
    color: var(--primary-text-color); font: inherit; font-size: 16px;
  }
  select option { background: var(--card-background-color); color: var(--primary-text-color); }
  .select-row > ha-icon { position: absolute; right: 14px; pointer-events: none; color: var(--primary-text-color); }

  /* Tiles (same as appliance-dial-card) */
  .controls { display: grid; grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .controls:empty { display: none; }
  @container (max-width: 420px) {
    .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .controls.odd > .ctl:first-child { grid-column: 1 / -1; }
  }
  @container (max-width: 240px) { .controls { grid-template-columns: minmax(0, 1fr); } }
  .ctl {
    position: relative; display: flex; align-items: center; gap: 8px; min-height: 56px;
    padding: 8px; border-radius: 12px; box-sizing: border-box;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    transition: background 0.2s;
  }
  .ctl.wide { grid-column: 1 / -1; }
  .ctl.toggle, .ctl.select, .ctl.info, .ctl.tank { cursor: pointer; }
  .ctl:focus-visible, .ctl.select:focus-within { outline: 2px solid var(--ctl-color); outline-offset: 1px; }
  .ctl.unavailable { opacity: 0.45; pointer-events: none; }
  .ctl.tank.full { background: color-mix(in srgb, var(--ctl-color) 16%, transparent); }
  .ctl.tank.full .vtext { color: var(--ctl-color); font-weight: 500; }
  .badge {
    flex: none; width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--ctl-color); background: color-mix(in srgb, var(--ctl-color) 20%, transparent);
    transition: color 0.2s, background 0.2s;
  }
  .badge ha-icon, .badge ha-state-icon { --mdc-icon-size: 18px; }
  .ctl.off .badge { color: var(--secondary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .text { flex: 1; min-width: 0; }
  .cname {
    font-size: 14px; font-weight: 500; line-height: 1.25; color: var(--primary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cval { display: flex; align-items: center; gap: 2px; margin-top: 3px; min-height: 18px; font-size: 13px; color: var(--secondary-text-color); }
  .vtext { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .cval .caret { flex: none; --mdc-icon-size: 18px; }
  .ctl select { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; opacity: 0; cursor: pointer; }
  .mini { flex: none; width: 34px; height: 34px; padding: 0; border: 1px solid var(--outline-color, var(--divider-color)); }
  .mini ha-icon { --mdc-icon-size: 18px; }
  .mini:disabled { opacity: 0.35; cursor: default; }
  .sw { flex: none; position: relative; width: 34px; height: 18px; border-radius: 9px; background: var(--ctl-color); transition: background 0.2s; }
  .sw::after { content: ""; position: absolute; top: 2px; left: 18px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left 0.2s; }
  .ctl.off .sw { background: color-mix(in srgb, var(--primary-text-color) 25%, transparent); }
  .ctl.off .sw::after { left: 2px; }

  /* History (same as heating-stats-card) */
  .hist { margin-top: 16px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 13px; color: var(--secondary-text-color); min-width: 0; }
  .lg { display: flex; align-items: center; gap: 5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lg b { font-weight: 500; color: var(--primary-text-color); }
  .lg.tank-lg { color: var(--alert-color); font-weight: 500; }
  .key { width: 10px; height: 3px; border-radius: 2px; flex: none; }
  .key.h { background: var(--dial-color); }
  .key.g { background: color-mix(in srgb, var(--primary-text-color) 50%, transparent); }
  .key.b { height: 10px; background: color-mix(in srgb, var(--dial-color) 30%, transparent); }
  .when { color: var(--primary-text-color); font-weight: 500; }
  .ranges { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .ranges button {
    color: var(--secondary-text-color); font-size: 12px; padding: 4px 9px; border-radius: 8px;
  }
  .ranges button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }

  .plot { position: relative; height: 128px; margin: 10px 0 0; padding: 0 0 0 34px; touch-action: pan-y; cursor: crosshair; }
  .plot svg { display: block; width: 100%; height: 112px; overflow: visible; }
  .band { fill: color-mix(in srgb, var(--dial-color) 16%, transparent); }
  .tankbar { fill: var(--alert-color); }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .hline, .gline { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
  .hline { stroke: var(--dial-color); stroke-width: 2; }
  .gline { stroke: var(--primary-text-color); stroke-opacity: 0.45; stroke-width: 1.5; stroke-dasharray: 1 4; }
  .cursor { position: absolute; top: 0; height: 112px; width: 1px; background: var(--primary-text-color); opacity: 0.5; pointer-events: none; display: none; }
  .plot.scrub .cursor { display: block; }
  .ax { position: absolute; left: 0; font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1; pointer-events: none; color: var(--secondary-text-color); }
  .ax.t { top: 0; }
  .ax.b { top: 102px; }
  .times { position: absolute; left: 34px; right: 0; bottom: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); pointer-events: none; }

  .stats { display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
  @container (max-width: 520px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .st { padding: 8px 10px; border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); min-width: 0; }
  .st-l { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-v { font-size: 17px; margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-s { font-size: 12px; color: var(--secondary-text-color); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .st.live .st-s { color: var(--dial-color); }
  .st.bad .st-s { color: var(--alert-color); }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }

  @media (prefers-reduced-motion: reduce) { .fill, .ctl, .badge, .sw, .sw::after { transition: none; } }
`;

class DehumidifierCard extends HTMLElement {
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((id) => id.startsWith("humidifier."));
    const id = ids.find((x) => hass.states[x].attributes.device_class === "dehumidifier") || ids[0];
    return { entity: id || "humidifier.dehumidifier" };
  }

  setConfig(config) {
    if (!config || !String(config.entity || "").startsWith("humidifier.")) {
      throw new Error("entity must be a humidifier entity");
    }
    this._config = {
      color: WATER,
      alert_color: ALERT,
      history: true,
      hours: 24,
      ranges: [6, 24, 72],
      step: 5,
      tolerance: 2,
      ...config,
    };
    this._hours = Number(this._config.hours) || 24;
    clearTimeout(this._commitTimer);
    this._pending = null;
    this._links = null;
    this._entsRef = undefined;
    this._ctl = null;
    this._ctlKey = null;
    this._modesKey = null;
    this._alertsKey = null;
    this._data = null;
    this._fetchedAt = 0;
    this._fetchId = 0;
    this._loading = false;
    this._scrubIdx = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._update(), 30000); // keep the timer countdown moving
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearTimeout(this._commitTimer);
  }

  getCardSize() {
    if (this._config?.show_controls === false) return 5;
    return 9 + (this._config?.history ? 5 : 0);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- layout ---------- */

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="header">
          <span class="name"></span>
          <button class="more" title="More info"><ha-icon icon="mdi:dots-vertical"></ha-icon></button>
        </div>
        <div class="dial">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <path class="track" d="${ARC}" pathLength="100"></path>
            <path class="fill" d="${ARC}" pathLength="100" stroke-dasharray="0 200"></path>
            <circle class="cur" r="4" cx="40.6" cy="159.4"></circle>
            <circle class="handle" r="9" cx="40.6" cy="159.4"></circle>
          </svg>
          <div class="center" aria-live="polite">
            <div class="label"></div>
            <div class="big"><span class="value">--</span><span class="unit"></span></div>
            <div class="sub">
              <span class="part p-hum" title="Humidity now"><ha-icon icon="mdi:water-percent"></ha-icon><span class="t-hum"></span></span>
              <span class="part p-timer" title="Timer"><ha-icon icon="mdi:timer-outline"></ha-icon><span class="t-timer"></span></span>
            </div>
          </div>
          <div class="buttons">
            <button class="round minus" title="Lower target (drier)"><ha-icon icon="mdi:minus"></ha-icon></button>
            <button class="round power" title="Turn on or off"><ha-icon icon="mdi:power"></ha-icon></button>
            <button class="round plus" title="Raise target"><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
        </div>
        <div class="alerts" role="status"></div>
        <div class="select-row">
          <span class="dot"></span>
          <select aria-label="Mode"></select>
          <ha-icon icon="mdi:menu-down"></ha-icon>
        </div>
        <div class="controls"></div>
        <div class="hist">
          <div class="top">
            <div class="legend">
              <span class="lg when"></span>
              <span class="lg" title="Humidity"><span class="key h"></span><b class="v-h">–</b></span>
              <span class="lg" title="Target"><span class="key g"></span><b class="v-g">–</b></span>
              <span class="lg"><span class="key b"></span><span class="v-b">Off</span></span>
              <span class="lg tank-lg">Tank full</span>
            </div>
            <div class="ranges" role="group" aria-label="Time range"></div>
          </div>
          <div class="body"><div class="msg">Loading history…</div></div>
        </div>
      </ha-card>`;

    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      card: $("ha-card"),
      name: $(".name"),
      fill: $(".fill"),
      cur: $(".cur"),
      handle: $(".handle"),
      label: $(".label"),
      value: $(".value"),
      unit: $(".unit"),
      pHum: $(".p-hum"),
      tHum: $(".t-hum"),
      pTimer: $(".p-timer"),
      tTimer: $(".t-timer"),
      minus: $(".minus"),
      plus: $(".plus"),
      power: $(".power"),
      alerts: $(".alerts"),
      selectRow: $(".select-row"),
      select: $(".select-row select"),
      controls: $(".controls"),
      hist: $(".hist"),
      when: $(".when"),
      vh: $(".v-h"),
      vg: $(".v-g"),
      vb: $(".v-b"),
      tankLg: $(".tank-lg"),
      ranges: $(".ranges"),
      body: $(".body"),
    };
    const e = this._els;
    e.card.style.setProperty("--dial-color", c.color);
    e.card.style.setProperty("--alert-color", c.alert_color);
    const size = Number(c.dial_size) || 240;
    e.card.style.setProperty("--dial-size", `${Math.max(160, Math.min(320, size))}px`);
    e.card.classList.toggle("noname", c.show_name === false);
    e.card.classList.toggle("hist-only", c.show_controls === false);
    e.hist.style.display = c.history || c.show_controls === false ? "" : "none";
    e.selectRow.style.display = "none";

    $(".more").addEventListener("click", () => this._moreInfo(c.entity));
    e.minus.addEventListener("click", () => this._nudge(-1));
    e.plus.addEventListener("click", () => this._nudge(1));
    e.power.addEventListener("click", () => this._power());
    e.select.addEventListener("change", (ev) =>
      this._hass.callService("humidifier", "set_mode", { entity_id: c.entity, mode: ev.target.value })
    );

    for (const hrs of c.ranges) {
      const b = document.createElement("button");
      b.textContent = hrs % 24 === 0 && hrs > 24 ? `${hrs / 24} d` : `${hrs} h`;
      b.setAttribute("aria-pressed", String(hrs === this._hours));
      b.addEventListener("click", () => {
        if (hrs === this._hours) return;
        this._hours = hrs;
        e.ranges.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this._fetch();
      });
      e.ranges.append(b);
    }
  }

  /* ---------- formatting ---------- */

  _fmt(stateObj, value) {
    const h = this._hass;
    return h.formatEntityState ? h.formatEntityState(stateObj, value) : value ?? stateObj.state;
  }

  _fmtAttr(stateObj, attr, value) {
    const h = this._hass;
    const v = value ?? stateObj.attributes[attr];
    if (h.formatEntityAttributeValue) return h.formatEntityAttributeValue(stateObj, attr, v);
    const s = String(v ?? "");
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
  }

  _n(v, d = 0) {
    return new Intl.NumberFormat(this._hass?.locale?.language, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }

  _time(t, withDay) {
    const opts = { hour: "2-digit", minute: "2-digit" };
    if (withDay) opts.weekday = "short";
    return new Date(t).toLocaleString(this._hass?.locale?.language, opts);
  }

  _dur(ms) {
    const m = Math.round(ms / MIN);
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60);
    return m % 60 ? `${hrs} h ${m % 60} min` : `${hrs} h`;
  }

  _rangeText() {
    const hrs = this._hours;
    return hrs % 24 === 0 && hrs > 24 ? `${hrs / 24} days` : `${hrs} h`;
  }

  // "Arete® Two 12L Dehumidifier/Air Purifier Tank full" -> "Tank full"
  _shortName(id) {
    const st = this._hass.states[id];
    const full = st?.attributes.friendly_name || id;
    const device = this._hass.states[this._config.entity]?.attributes.friendly_name;
    if (device && full.toLowerCase().startsWith(device.toLowerCase()) && full.length > device.length) {
      const rest = full.slice(device.length).trim();
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return full;
  }

  /* ---------- related entities ---------- */

  /** Finds the humidity sensor, timer, tank and fault sensors, and controls on the same device. */
  _resolve() {
    const h = this._hass;
    const c = this._config;
    if (this._links && this._entsRef === h.entities) return this._links;
    this._entsRef = h.entities;
    const reg = h.entities || {};
    const devId = reg[c.entity]?.device_id;
    let ids;
    if (devId) {
      ids = Object.keys(reg).filter((id) => id !== c.entity && reg[id].device_id === devId);
    } else {
      // No registry (or no device): fall back to entities named after the humidifier
      const obj = c.entity.split(".")[1];
      ids = Object.keys(h.states).filter((id) => id !== c.entity && id.split(".")[1].startsWith(`${obj}_`));
    }
    ids = ids.filter((id) => h.states[id] && !reg[id]?.hidden).sort();

    const dom = (id) => id.split(".")[0];
    const dc = (id) => h.states[id]?.attributes.device_class;
    // `false` in the config switches a feature off, a string overrides it
    const pick = (key, test) => (c[key] !== undefined ? c[key] || null : ids.find(test) || null);

    const humidity = pick("humidity_entity", (id) => dom(id) === "sensor" && dc(id) === "humidity");
    const temperature = pick("temperature_entity", (id) => dom(id) === "sensor" && dc(id) === "temperature");
    const timer = pick("timer_entity", (id) => dom(id) === "select" && /countdown|timer/.test(id));
    const tank = pick("tank_entity", (id) => dom(id) === "binary_sensor" && /tank/.test(id));
    const problems = Array.isArray(c.problem_entities)
      ? [...c.problem_entities]
      : ids.filter((id) => dom(id) === "binary_sensor" && dc(id) === "problem");
    if (tank && !problems.includes(tank)) problems.unshift(tank);

    let controls;
    if (Array.isArray(c.controls)) {
      controls = c.controls.map((x) => (typeof x === "string" ? { entity: x } : x)).filter((x) => x && x.entity);
    } else {
      const name = (id) => h.states[id]?.attributes.friendly_name || id;
      const rest = ids
        .filter((id) => ["switch", "select", "number"].includes(dom(id)) && id !== timer)
        .filter((id) => reg[id]?.entity_category !== "diagnostic")
        .sort((a, b) => name(a).localeCompare(name(b)));
      controls = [timer, ...rest].filter(Boolean).map((entity) => ({ entity }));
    }
    this._links = { humidity, temperature, timer, tank, problems, controls };
    return this._links;
  }

  _problemKind(id) {
    if (id === this._links?.tank) return "tank";
    if (/defrost/i.test(id)) return "defrost";
    return "fault";
  }

  _activeProblems() {
    const h = this._hass;
    return (this._links?.problems || [])
      .map((id) => ({ id, st: h.states[id] }))
      .filter((p) => p.st?.state === "on")
      .map((p) => ({ id: p.id, kind: this._problemKind(p.id), since: Date.parse(p.st.last_changed) }));
  }

  _current() {
    const h = this._hass;
    const L = this._links;
    const sensor = L?.humidity && h.states[L.humidity];
    const v = sensor && !isDead(sensor) ? num(sensor.state) : null;
    return v ?? num(h.states[this._config.entity]?.attributes.current_humidity);
  }

  /**
   * Tuya-style countdown selects ("cancel", "1h", "2h"...) don't report the time left,
   * so the end is estimated from when the option was chosen.
   */
  _timerInfo() {
    const id = this._links?.timer;
    const st = id && this._hass.states[id];
    if (!st) return null;
    const m = /^(\d+(?:\.\d+)?)\s*h/i.exec(st.state);
    if (!m) return null;
    const end = Date.parse(st.last_changed) + Number(m[1]) * HOUR;
    if (!(end > Date.now())) return null;
    return { end, left: end - Date.now() };
  }

  _timerOption(st, o) {
    if (/^(cancel|off|0h?)$/i.test(o)) return "Off";
    const m = /^(\d+(?:\.\d+)?)\s*h$/i.exec(o);
    return m ? `${m[1]} h` : this._fmt(st, o);
  }

  /* ---------- state ---------- */

  _update() {
    if (!this._hass || !this._els) return;
    const h = this._hass;
    const c = this._config;
    const e = this._els;
    this._resolve();

    const st = h.states[c.entity];
    const a = st?.attributes || {};
    const dead = isDead(st);
    const off = st?.state === "off";
    const min = num(a.min_humidity) ?? 30;
    const max = num(a.max_humidity) ?? 80;
    e.name.textContent = c.name || a.friendly_name || c.entity;

    // Clear a sent -/+ change once it shows up (or after a timeout)
    if (this._pending != null && this._pendingSent) {
      const landed = st?.state === "on" && num(a.humidity) === this._pending;
      if (landed || Date.now() - this._pendingAt > PENDING_TIMEOUT) this._pending = null;
    }

    const target = this._pending ?? (off || dead ? null : num(a.humidity));
    const current = this._current();
    const problems = this._activeProblems();
    const tankFull = problems.some((p) => p.kind === "tank");
    const fault = problems.some((p) => p.kind === "fault");
    const defrost = problems.some((p) => p.kind === "defrost");
    const action = a.action; // newer integrations report drying / idle / off
    const drying = !off && !dead && !tankFull && (action
      ? action === "drying"
      : current != null && target != null && current > target);

    let label = "";
    let labelColor = "";
    if (!st) label = "Entity not found";
    else if (dead) label = "Unavailable";
    else if (this._pending != null) label = off ? "Turn on at" : "Set to";
    else if (off) label = "";
    else if (tankFull) [label, labelColor] = ["Tank full", "var(--alert-color)"];
    else if (fault) [label, labelColor] = ["Fault", "var(--alert-color)"];
    else if (defrost) [label, labelColor] = ["Defrosting", WARN];
    else if (action && action !== "drying") label = this._fmtAttr(st, "action");
    else if (drying) [label, labelColor] = ["Drying", "var(--dial-color)"];
    else if (target != null) label = "Target reached";
    e.label.textContent = label;
    e.label.style.color = labelColor;

    // Dial: fill from the target to the top of the range
    const span = max - min || 1;
    const frac = (v) => Math.min(1, Math.max(0, (v - min) / span));
    const pos = (f) => {
      const ang = ((135 + 270 * f) * Math.PI) / 180;
      return [(100 + 84 * Math.cos(ang)).toFixed(2), (100 + 84 * Math.sin(ang)).toFixed(2)];
    };
    const hasTarget = target != null;
    e.card.classList.toggle("active", hasTarget);
    e.card.classList.toggle("drying", drying && hasTarget);
    if (hasTarget) {
      const f = frac(target);
      e.fill.setAttribute("stroke-dasharray", `${((1 - f) * 100).toFixed(2)} 200`);
      e.fill.setAttribute("stroke-dashoffset", (-f * 100).toFixed(2));
      const [x, y] = pos(f);
      e.handle.setAttribute("cx", x);
      e.handle.setAttribute("cy", y);
    }
    const hasCur = current != null && !dead;
    e.card.classList.toggle("has-cur", hasCur);
    if (hasCur) {
      const [x, y] = pos(frac(current));
      e.cur.setAttribute("cx", x);
      e.cur.setAttribute("cy", y);
    }
    e.value.textContent = hasTarget ? this._n(target) : st && !dead ? "Off" : "--";
    e.value.classList.toggle("word", !hasTarget);
    e.unit.textContent = hasTarget ? "%" : "";

    e.pHum.style.display = hasCur ? "" : "none";
    e.tHum.textContent = hasCur ? `${Math.round(current)} %` : "";
    const timer = this._timerInfo();
    e.pTimer.style.display = timer ? "" : "none";
    e.pTimer.title = timer ? `Timer: turns ${off ? "on" : "off"} at about ${this._time(timer.end)}` : "";
    e.tTimer.textContent = timer ? this._dur(Math.ceil(timer.left / MIN) * MIN) : "";

    e.minus.disabled = !st || dead || (hasTarget && target <= min);
    e.plus.disabled = !st || dead || (hasTarget && target >= max);
    e.power.disabled = !st || dead;
    e.power.classList.toggle("on", !!st && !off && !dead);
    e.power.setAttribute("aria-pressed", String(!!st && !off && !dead));
    e.power.title = off ? "Turn on" : "Turn off";
    this._dialState = { min, max, target: off || dead ? null : num(a.humidity), current, off };

    this._updateAlerts(problems);

    // Mode picker, only on models that have modes
    const modes = Array.isArray(a.available_modes) ? a.available_modes : [];
    const showModes = modes.length > 0 && !dead && c.show_modes !== false;
    e.selectRow.style.display = showModes ? "" : "none";
    if (showModes) {
      const key = modes.join("|");
      if (key !== this._modesKey) {
        this._modesKey = key;
        e.select.replaceChildren(...modes.map((m) => this._option(m, this._fmtAttr(st, "mode", m))));
      }
      if (this.shadowRoot.activeElement !== e.select) e.select.value = a.mode ?? "";
    }

    this._updateControls();

    if (c.history || c.show_controls === false) {
      if (!this._loading && Date.now() - this._fetchedAt > REFRESH_MS) this._fetch();
      else if (this._scrubIdx == null) this._paintLegend(null);
    }
  }

  _option(value, label) {
    const op = document.createElement("option");
    op.value = value;
    op.textContent = label;
    return op;
  }

  /* ---------- fault banners ---------- */

  _updateAlerts(problems) {
    const key = problems.map((p) => `${p.id}@${p.since}`).join("|");
    if (key === this._alertsKey) return;
    this._alertsKey = key;
    const order = { tank: 0, fault: 1, defrost: 2 };
    const rows = [...problems].sort((x, y) => order[x.kind] - order[y.kind]).map((p) => {
      const b = document.createElement("button");
      b.className = "alert";
      const color = p.kind === "defrost" ? WARN : "var(--alert-color)";
      b.style.setProperty("--ctl-color", color);
      b.innerHTML = `
        <div class="badge"><ha-icon></ha-icon></div>
        <div class="text"><div class="a-main"></div><div class="a-sub"></div></div>`;
      const since = Number.isFinite(p.since) ? `Since ${this._time(p.since, Date.now() - p.since > 20 * HOUR)}` : "";
      let icon, main, sub;
      if (p.kind === "tank") {
        icon = "mdi:pail-remove-outline";
        main = "Tank full";
        sub = "Empty the tank to start drying again";
      } else if (p.kind === "defrost") {
        icon = "mdi:snowflake-melt";
        main = "Defrosting";
        sub = "Normal in a cool room. Drying resumes by itself";
      } else {
        icon = "mdi:alert-circle-outline";
        main = this._shortName(p.id);
        sub = "Reported by the dehumidifier";
      }
      b.querySelector("ha-icon").setAttribute("icon", icon);
      b.querySelector(".a-main").textContent = main;
      b.querySelector(".a-sub").textContent = [sub, since].filter(Boolean).join(" · ");
      b.title = `${main}. ${sub}`;
      b.addEventListener("click", () => this._moreInfo(p.id));
      return b;
    });
    this._els.alerts.replaceChildren(...rows);
  }

  /* ---------- tiles ---------- */

  _buildControls() {
    const L = this._links;
    const wrap = this._els.controls;
    this._ctl = [];
    const tiles = [];

    if (L.tank) {
      const tile = document.createElement("div");
      tile.className = "ctl tank";
      tile.tabIndex = 0;
      tile.innerHTML = `
        <div class="badge"><ha-icon></ha-icon></div>
        <div class="text"><div class="cname">Water tank</div><div class="cval"><span class="vtext"></span></div></div>`;
      tile.addEventListener("click", () => this._moreInfo(L.tank));
      tile.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          tile.click();
        }
      });
      tiles.push(tile);
      this._ctl.push({ type: "tank", cfg: { entity: L.tank }, tile, icon: tile.querySelector("ha-icon"), vtext: tile.querySelector(".vtext") });
    }

    for (const cfg of L.controls) {
      const domain = cfg.entity.split(".")[0];
      const type = ["switch", "input_boolean", "light", "fan"].includes(domain)
        ? "toggle"
        : ["select", "input_select"].includes(domain)
        ? "select"
        : ["number", "input_number"].includes(domain)
        ? "number"
        : "info";

      const tile = document.createElement("div");
      tile.className = `ctl ${type}`;
      if (cfg.full_width ?? type === "number") tile.classList.add("wide"); // steppers need the room
      tile.style.setProperty("--ctl-color", cfg.color || "var(--dial-color)");
      tile.innerHTML = `
        <div class="badge"></div>
        <div class="text">
          <div class="cname"></div>
          <div class="cval">
            <span class="vtext"></span>
            ${type === "select" ? `<ha-icon class="caret" icon="mdi:menu-down"></ha-icon>` : ""}
            ${type === "toggle" ? `<span class="sw"></span>` : ""}
          </div>
        </div>
        ${type === "select" ? `<select></select>` : ""}
        ${type === "number"
          ? `<button class="mini minus" title="Decrease"><ha-icon icon="mdi:minus"></ha-icon></button>
             <button class="mini plus" title="Increase"><ha-icon icon="mdi:plus"></ha-icon></button>`
          : ""}`;

      const isTimer = cfg.entity === L.timer;
      const iconName = cfg.icon || (isTimer ? "mdi:timer-outline" : null);
      const iconEl = document.createElement(iconName ? "ha-icon" : "ha-state-icon");
      if (iconName) iconEl.setAttribute("icon", iconName);
      tile.querySelector(".badge").append(iconEl);

      const item = {
        cfg, domain, type, tile, iconEl, isTimer,
        name: tile.querySelector(".cname"),
        vtext: tile.querySelector(".vtext"),
        select: tile.querySelector("select"),
        minus: tile.querySelector(".minus"),
        plus: tile.querySelector(".plus"),
        optsKey: null,
      };

      if (type === "toggle") {
        tile.tabIndex = 0;
        tile.setAttribute("role", "switch");
        tile.addEventListener("click", () =>
          this._hass.callService(domain === "input_boolean" ? "input_boolean" : "homeassistant", "toggle", {
            entity_id: cfg.entity,
          })
        );
        tile.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            tile.click();
          }
        });
      } else if (type === "select") {
        item.select.addEventListener("change", (ev) =>
          this._hass.callService(domain, "select_option", { entity_id: cfg.entity, option: ev.target.value })
        );
      } else if (type === "number") {
        item.minus.addEventListener("click", () => this._step(item, -1));
        item.plus.addEventListener("click", () => this._step(item, 1));
      } else {
        tile.tabIndex = 0;
        tile.addEventListener("click", () => this._moreInfo(cfg.entity));
      }
      tiles.push(tile);
      this._ctl.push(item);
    }

    wrap.replaceChildren(...tiles);
    const n = tiles.length;
    wrap.style.setProperty("--cols", n <= 3 ? Math.max(1, n) : n === 4 ? 2 : 3);
    wrap.classList.toggle("odd", n % 2 === 1);
  }

  _updateControls() {
    const h = this._hass;
    const L = this._links;
    const key = [L.tank, ...L.controls.map((x) => x.entity)].join("|");
    if (key !== this._ctlKey) {
      this._ctlKey = key;
      this._buildControls();
    }

    for (const it of this._ctl) {
      const st = h.states[it.cfg.entity];

      if (it.type === "tank") {
        const full = st?.state === "on";
        it.tile.classList.toggle("full", full);
        it.tile.classList.toggle("unavailable", isDead(st));
        it.tile.style.setProperty("--ctl-color", full ? "var(--alert-color)" : "var(--dial-color)");
        it.icon.setAttribute("icon", full ? "mdi:pail-remove-outline" : "mdi:pail-outline");
        it.vtext.textContent = !st ? "Entity not found" : isDead(st) ? "Unavailable" : full ? "Full, empty it" : "OK";
        it.tile.title = full ? "The tank is full. Empty it to start drying again." : "Water tank";
        continue;
      }

      const name = it.cfg.name || (it.isTimer ? "Timer" : this._shortName(it.cfg.entity));
      it.name.textContent = name;
      it.tile.title = name;
      if (it.iconEl.localName === "ha-state-icon") {
        it.iconEl.hass = h;
        it.iconEl.stateObj = st;
      }
      if (!st) {
        it.vtext.textContent = "Entity not found";
        it.tile.classList.add("unavailable");
        continue;
      }
      it.tile.classList.toggle("unavailable", st.state === "unavailable");

      if (it.type === "toggle") {
        const on = st.state === "on";
        it.vtext.textContent = "";
        it.tile.classList.toggle("off", !on);
        it.tile.setAttribute("aria-checked", String(on));
        it.tile.setAttribute("aria-label", name);
        continue;
      }

      if (it.isTimer) {
        const t = this._timerInfo();
        const off = h.states[this._config.entity]?.state === "off";
        it.vtext.textContent = t ? `${off ? "On" : "Off"} at ${this._time(t.end)}` : "Off";
        it.tile.classList.toggle("off", !t);
        it.tile.title = t ? "Timer. The end time is estimated from when it was set." : "Timer";
      } else {
        it.vtext.textContent = this._fmt(st);
      }

      if (it.type === "select") {
        const opts = st.attributes.options || [];
        const key = opts.join("|");
        if (key !== it.optsKey) {
          it.optsKey = key;
          it.select.setAttribute("aria-label", name);
          it.select.replaceChildren(
            ...opts.map((o) => this._option(o, it.isTimer ? this._timerOption(st, o) : this._fmt(st, o)))
          );
        }
        if (this.shadowRoot.activeElement !== it.select) it.select.value = st.state;
      } else if (it.type === "number") {
        const v = Number(st.state);
        it.minus.disabled = !(v > (st.attributes.min ?? -Infinity));
        it.plus.disabled = !(v < (st.attributes.max ?? Infinity));
      }
    }
  }

  _step(it, dir) {
    const st = this._hass.states[it.cfg.entity];
    if (!st) return;
    const { min = -Infinity, max = Infinity, step = 1 } = st.attributes;
    const decimals = (String(step).split(".")[1] || "").length;
    const cur = Number(st.state);
    const next = Number(Math.min(max, Math.max(min, cur + dir * step)).toFixed(decimals));
    if (Number.isNaN(next) || next === cur) return;
    this._hass.callService(it.domain, "set_value", { entity_id: it.cfg.entity, value: next });
  }

  /* ---------- actions ---------- */

  _nudge(dir) {
    const d = this._dialState;
    if (!d) return;
    const step = num(this._config.step) || 5;
    const base = this._pending ?? d.target ?? num(this._hass.states[this._config.entity]?.attributes.humidity) ?? 50;
    const snapped = Math.round((base + dir * step) / step) * step;
    const next = Math.min(d.max, Math.max(d.min, snapped));
    if (this._pending == null && d.target != null && next === d.target) return;
    this._pending = next;
    this._pendingSent = false;
    this._pendingAt = Date.now();
    clearTimeout(this._commitTimer);
    this._commitTimer = setTimeout(() => this._commit(), COMMIT_DELAY);
    this._update();
  }

  async _commit() {
    const v = this._pending;
    if (v == null) return;
    const h = this._hass;
    const id = this._config.entity;
    this._pendingSent = true;
    this._pendingAt = Date.now();
    try {
      if (h.states[id]?.state === "off") await h.callService("humidifier", "turn_on", { entity_id: id });
      await h.callService("humidifier", "set_humidity", { entity_id: id, humidity: v });
    } catch (err) {
      console.warn("dehumidifier-card: could not set humidity", err);
      this._pending = null;
      this._update();
    }
  }

  _power() {
    const st = this._hass.states[this._config.entity];
    if (isDead(st)) return;
    clearTimeout(this._commitTimer);
    this._pending = null;
    this._hass.callService("humidifier", st.state === "off" ? "turn_on" : "turn_off", { entity_id: this._config.entity });
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  /* ---------- history ---------- */

  async _fetch() {
    const h = this._hass;
    const c = this._config;
    const L = this._resolve();
    const id = ++this._fetchId;
    this._loading = true;
    const end = Date.now();
    const start = end - this._hours * HOUR;
    const ids = [c.entity, L.humidity, L.tank].filter((x) => x && h.states[x]);
    try {
      const res = ids.length
        ? await h.callWS({
            type: "history/history_during_period",
            start_time: new Date(start).toISOString(),
            end_time: new Date(end).toISOString(),
            entity_ids: ids,
            minimal_response: false,
            no_attributes: false,
            significant_changes_only: false,
          })
        : {};
      if (id !== this._fetchId) return;
      this._data = this._process(res || {}, start, end);
    } catch (err) {
      console.warn("dehumidifier-card: could not load history", err);
      if (id === this._fetchId) this._data = { error: true };
    } finally {
      if (id === this._fetchId) {
        this._loading = false;
        this._fetchedAt = Date.now();
        this._paint();
      }
    }
  }

  _series(raw) {
    // Works with both the compressed ({s, a, lu}) and full history formats
    let attrs = {};
    return (raw || [])
      .map((e) => {
        attrs = e.a ?? e.attributes ?? attrs;
        const t = e.lu != null ? e.lu * 1000 : Date.parse(e.last_updated || e.last_changed);
        return { t, s: e.s ?? e.state, a: attrs };
      })
      .filter((x) => Number.isFinite(x.t))
      .sort((x, y) => x.t - y.t);
  }

  _at(series, t) {
    let lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].t <= t) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best >= 0 ? series[best] : null;
  }

  _live(e) {
    return e && !["unavailable", "unknown"].includes(e.s) ? e : null;
  }

  _runs(series, on, start, end) {
    const runs = [];
    let cur = null;
    for (const e of series) {
      const t = Math.max(e.t, start);
      if (on(e) && !cur) cur = { start: t };
      else if (!on(e) && cur) {
        cur.end = t;
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push({ start: cur.start, end, running: true });
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && r.start - last.end < 2 * MIN) {
        last.end = r.end;
        last.running = r.running;
      } else merged.push({ ...r });
    }
    return merged.filter((r) => r.end - r.start >= MIN || r.running);
  }

  _process(res, start, end) {
    const c = this._config;
    const L = this._links;
    const ds = this._series(res[c.entity]);
    const hs = L.humidity ? this._series(res[L.humidity]) : [];
    const ts = L.tank ? this._series(res[L.tank]) : [];

    const times = [];
    for (let i = 0; i < POINTS; i++) times.push(start + ((end - start) * i) / (POINTS - 1));
    const hum = [], target = [];
    for (const t of times) {
      const d = this._live(this._at(ds, t));
      const s = this._live(this._at(hs, t));
      const hv = s ? num(s.s) : null;
      hum.push(hv ?? (d ? num(d.a?.current_humidity) : null));
      target.push(d?.s === "on" ? num(d.a?.humidity) : null);
    }

    const runs = this._runs(ds, (e) => e.s === "on", start, end);
    const total = runs.reduce((a, r) => a + (r.end - r.start), 0);
    const full = this._runs(ts, (e) => e.s === "on", start, end);

    // On target: share of running time at or below target (+ tolerance)
    const tol = num(c.tolerance) ?? 2;
    let nT = 0, inT = 0, dev = 0;
    hum.forEach((v, i) => {
      if (v == null || target[i] == null) return;
      nT++;
      dev += v - target[i];
      if (v <= target[i] + tol) inT++;
    });

    const vals = hum.filter((v) => v != null);
    const tvals = target.filter((v) => v != null);
    return {
      start, end, times, hum, target, runs, total, full, tol,
      hMin: vals.length ? Math.min(...vals) : null,
      hMax: vals.length ? Math.max(...vals) : null,
      hAvg: avg(vals),
      gMin: tvals.length ? Math.min(...tvals) : null,
      gMax: tvals.length ? Math.max(...tvals) : null,
      onTarget: nT ? inT / nT : null,
      dev: nT ? dev / nT : null,
      hasTank: !!L.tank,
    };
  }

  _paint() {
    const d = this._data;
    const body = this._els.body;
    this._scrubIdx = null;
    if (!d || d.error) {
      body.innerHTML = `<div class="msg">Couldn't load history. Check that the recorder is running.</div>`;
      this._paintLegend(null);
      return;
    }
    if (d.hMin == null) {
      body.innerHTML = `<div class="msg">No humidity history yet for this period.</div>`;
      this._paintLegend(null);
      return;
    }

    const W = 1000;
    const span = d.end - d.start;
    const x = (t) => (((t - d.start) / span) * W).toFixed(1);
    const lo = Math.min(d.hMin, d.gMin ?? Infinity);
    const hi = Math.max(d.hMax, d.gMax ?? -Infinity);
    const yLo = Math.max(0, Math.floor((lo - 3) / 5) * 5);
    const yHi = Math.min(100, Math.ceil((hi + 3) / 5) * 5);
    const y = (v) => (92 - ((v - yLo) / (yHi - yLo || 1)) * 88).toFixed(2);
    const lines = (vals, cls) => {
      const parts = [];
      let cur = [];
      vals.forEach((v, i) => {
        if (v == null) {
          if (cur.length) parts.push(cur);
          cur = [];
        } else cur.push(`${x(d.times[i])},${y(v)}`);
      });
      if (cur.length) parts.push(cur);
      return parts.map((p) => `<polyline class="${cls}" points="${p.join(" ")}"></polyline>`).join("");
    };
    const rect = (r, cls, y0, hgt) =>
      `<rect class="${cls}" x="${x(r.start)}" y="${y0}" width="${Math.max(1.5, x(r.end) - x(r.start))}" height="${hgt}"></rect>`;
    const bands = d.runs.map((r) => rect(r, "band", 0, 100)).join("");
    const tank = d.full.map((r) => rect(r, "tankbar", 95, 5)).join("");
    const multiDay = span > 26 * HOUR;

    body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid"><line x1="0" x2="${W}" y1="4" y2="4"></line><line x1="0" x2="${W}" y1="48" y2="48"></line><line x1="0" x2="${W}" y1="92" y2="92"></line></g>
          ${bands}${lines(d.target, "gline")}${lines(d.hum, "hline")}${tank}
        </svg>
        <div class="cursor"></div>
        <span class="ax t">${yHi}%</span><span class="ax b">${yLo}%</span>
        <div class="times"><span>${esc(this._time(d.start, multiDay))}</span><span>${esc(this._time(d.start + span / 2, multiDay))}</span><span>Now</span></div>
      </div>
      <div class="stats"></div>`;

    this._paintStats();
    this._paintLegend(null);

    const plot = body.querySelector(".plot");
    const cursor = body.querySelector(".cursor");
    const svg = body.querySelector("svg");
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const pbox = plot.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      this._scrubIdx = Math.round(f * (POINTS - 1));
      cursor.style.left = `${box.left - pbox.left + f * box.width}px`;
      plot.classList.add("scrub");
      this._paintLegend(this._scrubIdx);
    };
    const leave = () => {
      this._scrubIdx = null;
      plot.classList.remove("scrub");
      this._paintLegend(null);
    };
    plot.addEventListener("pointermove", move);
    plot.addEventListener("pointerdown", move);
    plot.addEventListener("pointerleave", leave);
    plot.addEventListener("pointercancel", leave);
  }

  _paintLegend(idx) {
    const e = this._els;
    const h = this._hass;
    const d = this._data;
    if (!h || !e) return;
    let hum, tgt, on, full, when;
    if (idx != null && d?.times) {
      const at = d.times[idx];
      hum = d.hum[idx];
      tgt = d.target[idx];
      on = d.runs.some((r) => at >= r.start && at <= r.end);
      full = d.full.some((r) => at >= r.start && at <= r.end);
      when = this._time(at, d.end - d.start > 26 * HOUR);
    } else {
      const st = h.states[this._config.entity];
      on = st?.state === "on";
      hum = this._current();
      tgt = on ? num(st.attributes.humidity) : null;
      full = !!this._links?.tank && h.states[this._links.tank]?.state === "on";
      when = "Now";
    }
    e.when.textContent = when;
    e.vh.textContent = hum != null ? `${Math.round(hum)} %` : "–";
    e.vg.textContent = tgt != null ? `→ ${Math.round(tgt)}%` : "";
    e.vg.parentElement.style.display = tgt != null ? "" : "none";
    e.vb.textContent = on ? "Running" : "Off";
    e.vb.style.color = on ? "var(--dial-color)" : "";
    e.tankLg.style.display = full ? "" : "none";
  }

  _cell(label, value, sub, cls, title) {
    return `<div class="st${cls ? ` ${cls}` : ""}"${title ? ` title="${esc(title)}"` : ""}><div class="st-l">${esc(label)}</div><div class="st-v">${esc(value)}</div><div class="st-s">${esc(sub)}</div></div>`;
  }

  _dewPoint(t, rh) {
    if (t == null || rh == null || rh <= 0) return null;
    const a = 17.62, b = 243.12;
    const g = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * g) / (a - g);
  }

  _comfort(rh) {
    if (rh < 35) return "Dry";
    if (rh <= 60) return "Comfortable";
    if (rh <= 70) return "Humid";
    return "Very humid";
  }

  _paintStats() {
    const d = this._data;
    const h = this._hass;
    const L = this._links;
    const box = this._els.body.querySelector(".stats");
    const onNow = h.states[this._config.entity]?.state === "on";
    const pct = Math.round((d.total / (d.end - d.start)) * 100);

    const cur = this._current();
    const tempSt = L.temperature && h.states[L.temperature];
    const dp = this._dewPoint(tempSt && !isDead(tempSt) ? num(tempSt.state) : null, cur);
    const humSub = dp != null
      ? `Dew point now ${this._n(dp, 1)}°`
      : cur != null
      ? `${this._comfort(cur)} now`
      : `Average ${Math.round(d.hAvg)}%`;

    let devText = d.onTarget == null ? "Wasn't running" : "";
    if (d.dev != null) {
      const r = Math.round(d.dev);
      devText = r === 0 ? "Average spot on" : `Average ${Math.abs(r)}% ${r > 0 ? "above" : "below"}`;
    }

    const cells = [
      this._cell("Running", this._dur(d.total), onNow ? "On now" : `${pct}% of ${this._rangeText()}`, onNow ? "live" : "",
        "Time the dehumidifier was switched on"),
      this._cell("Humidity", `${Math.round(d.hMin)}–${Math.round(d.hMax)}%`, humSub, "",
        "Lowest to highest. Mould is more likely when it stays above 70%"),
      this._cell("On target", d.onTarget != null ? `${Math.round(d.onTarget * 100)}%` : "–", devText, "",
        `Share of running time with the humidity no more than ${d.tol}% above the target`),
    ];
    if (d.hasTank) {
      const n = d.full.length;
      const last = d.full[n - 1];
      const fullNow = !!last?.running;
      cells.push(
        this._cell(
          "Tank full",
          n ? `${n} ${n === 1 ? "time" : "times"}` : "None",
          fullNow ? "Full now" : last ? `Last ${this._time(last.start, d.end - last.start > 20 * HOUR)}` : "Not in this period",
          fullNow ? "bad" : "",
          "How often the tank filled up and stopped the dehumidifier"
        )
      );
    }
    box.style.setProperty("--n", cells.length);
    box.innerHTML = cells.join("");
  }
}

if (!customElements.get("dehumidifier-card")) customElements.define("dehumidifier-card", DehumidifierCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "dehumidifier-card",
  name: "Dehumidifier Card",
  description: "Humidity dial, tank and fault alerts, timer and history for a dehumidifier",
});
