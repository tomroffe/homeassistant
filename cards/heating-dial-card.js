/**
 * heating-dial-card  (v4)
 * Companion to appliance-dial-card, with the same thermostat-style look.
 *
 * custom:heating-dial-card
 *   Whole-house mode (no `entity`): one dial that sets every Better Thermostat room.
 *     - Big number is the house target; small dot on the arc is the average room temperature.
 *     - -/+ set all rooms (switches the house preset to Manual), power turns all rooms off/on.
 *     - Preset buttons (Comfort, Eco, Sleep, Away, Boost, Off), each with its own -/+;
 *       Boost also has -/+ for its length. `show_name: false` hides the title.
 *     - Boiler status line and a list of rooms with temperature, humidity and target.
 *   Room mode (`entity: climate.<room>`): target dial, current temperature and humidity,
 *     -/+, power, the room's own preset picker, optional control tiles.
 *
 * custom:heating-rooms-card
 *   A grid of room dials for every Better Thermostat room (or a `rooms:` list).
 *   `history: true` pairs each dial with a room history panel.
 *
 * custom:heating-stats-card
 *   Whole house: average room temperature and humidity with boiler-on periods shaded,
 *   plus last cycle, boiler time and cycle stats.
 *   One room (`entity: climate.<room>`): temperature, target and humidity with
 *   valve-open periods shaded, plus valve time, time on target, warm-up and
 *   cool-down rates, heat-loss coefficient (with `outdoor_entity`) and dew point.
 *
 * Works with packages/hive_call_for_heat.yaml (v2).
 * Install: copy to /config/www/heating-dial-card.js and add the resource
 * /local/heating-dial-card.js (type: JavaScript module).
 */

const ARC = "M 40.6 159.4 A 84 84 0 1 1 159.4 159.4"; // 270° arc, r=84, centre 100,100
const HEAT = "var(--state-climate-heat-color, #ff8100)";
const HOUSE_PRESETS = ["Comfort", "Eco", "Sleep", "Away", "Boost", "Off"];
const PRESET_ICONS = {
  comfort: "mdi:sofa-outline",
  eco: "mdi:leaf",
  sleep: "mdi:weather-night",
  away: "mdi:home-export-outline",
  boost: "mdi:rocket-launch-outline",
  manual: "mdi:hand-back-right-outline",
  home: "mdi:home-outline",
  off: "mdi:power",
};
const PRESET_COLORS = {
  comfort: "#ffb74d",
  eco: "#66bb6a",
  sleep: "#7986cb",
  away: "#4dd0e1",
  boost: "#ef5350",
  manual: "#ba68c8",
  home: "#ffca28",
  off: "#9aa0a6",
};
const HOUSE_DEFAULTS = {
  preset_entity: "input_select.house_heating_preset",
  preset_temp_prefix: "input_number.heating_preset_",
  previous_entity: "input_text.house_heating_previous_preset",
  boost_timer: "timer.house_heating_boost",
  boost_hours_entity: "input_number.heating_boost_hours",
  pause_entity: "input_boolean.heating_pause_boiler_control",
};
const COMMIT_DELAY = 1000; // wait for more -/+ taps before sending
const PENDING_TIMEOUT = 15000; // give up waiting for the new target to show

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Better Thermostat climate entities, sorted by name (or the configured list). */
function findRooms(hass, cfg) {
  if (!hass) return [];
  let ids;
  if (Array.isArray(cfg.rooms) && cfg.rooms.length) {
    ids = cfg.rooms.map((r) => (typeof r === "string" ? r : r?.entity)).filter(Boolean);
  } else {
    const reg = hass.entities || {};
    ids = Object.keys(hass.states).filter((id) => {
      if (!id.startsWith("climate.")) return false;
      const ent = reg[id];
      if (ent?.hidden) return false;
      if (ent?.platform) return ent.platform === "better_thermostat";
      return "call_for_heat" in (hass.states[id].attributes || {});
    });
    const name = (id) => hass.states[id]?.attributes.friendly_name || id;
    ids.sort((a, b) => name(a).localeCompare(name(b)));
  }
  const ex = new Set(cfg.exclude || []);
  return ids.filter((id) => !ex.has(id));
}

/** A room is calling for heat when its valve is heating or it is clearly below target. */
function isCalling(st) {
  if (!st || ["off", "unavailable", "unknown"].includes(st.state)) return false;
  const a = st.attributes;
  const cur = num(a.current_temperature);
  const tgt = num(a.temperature);
  return a.hvac_action === "heating" || (cur != null && tgt != null && cur < tgt - 0.3);
}

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card { padding: 12px 16px 16px; container-type: inline-size; height: 100%; box-sizing: border-box; }
  .header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 36px; }
  .name { font-size: 22px; font-weight: 400; color: var(--primary-text-color); }
  .more { position: absolute; right: -4px; top: 50%; transform: translateY(-50%); }
  button {
    background: none; border: none; color: var(--primary-text-color);
    cursor: pointer; padding: 8px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font: inherit;
  }
  button:focus-visible { outline: 2px solid var(--dial-color); outline-offset: 2px; }

  /* Dial */
  .dial {
    position: relative; width: min(100%, var(--dial-size)); aspect-ratio: 1; margin: 4px auto 0;
    container-type: inline-size;
  }
  svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .track, .fill { fill: none; stroke-width: 16; stroke-linecap: round; }
  .track { stroke: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .fill { stroke: var(--dial-color); stroke-opacity: 0.45; display: none; transition: stroke-opacity 0.3s; }
  ha-card.heating .fill { stroke-opacity: 1; }
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
  ha-card.heating .label { color: var(--dial-color); }
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

  /* Shared pill background */
  .status, .chip, .rooms, .select-row, .ctl {
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }

  /* Boiler status line */
  .status {
    width: 100%; box-sizing: border-box; justify-content: flex-start; gap: 12px;
    min-height: 56px; margin-top: 12px; padding: 8px 14px 8px 10px; border-radius: 12px; text-align: left;
  }
  .status .text { flex: 1; min-width: 0; }
  .s-main { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-sub { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status.idle .badge { color: var(--secondary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }

  /* Preset buttons: icon + name, with their own -/+ */
  .chips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 12px; }
  @container (max-width: 340px) { .chips { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  /* Title on top; the controls sit centred in the space left below it */
  .chip {
    display: grid; grid-template-rows: auto 1fr; gap: 4px; min-width: 0; box-sizing: border-box;
    padding: 8px 6px 6px 10px; border-radius: 12px; cursor: pointer; transition: background 0.2s;
  }
  .chip:focus-visible { outline: 2px solid var(--pc, var(--dial-color)); outline-offset: 1px; }
  .c-body { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; }
  .c-head { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 22px; }
  .c-head ha-icon { flex: none; --mdc-icon-size: 18px; color: var(--pc, var(--secondary-text-color)); }
  .c-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c-row { display: flex; align-items: center; gap: 2px; }
  .c-row .step {
    flex: none; width: 26px; height: 26px; padding: 0;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
  .c-row .step ha-icon { --mdc-icon-size: 16px; }
  .c-row .step:disabled { opacity: 0.3; cursor: default; }
  .c-val { flex: 1; text-align: center; font-size: 13px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .c-note { display: flex; align-items: center; min-height: 26px; font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip[aria-pressed="true"] { background: color-mix(in srgb, var(--pc, var(--dial-color)) 22%, transparent); }
  .chip[aria-pressed="true"] .c-head ha-icon { color: var(--pc, var(--dial-color)); }
  .chip[aria-pressed="true"] .c-val { color: var(--primary-text-color); }
  .chip[aria-pressed="true"] .step { background: color-mix(in srgb, var(--pc, var(--dial-color)) 22%, transparent); }
  .chip.off-chip[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 16%, transparent); }
  .chip.off-chip[aria-pressed="true"] .c-head ha-icon { color: var(--primary-text-color); }

  /* No title: keep only the menu button, top right */
  ha-card.noname { position: relative; }
  ha-card.noname .header { position: absolute; top: 6px; right: 12px; min-height: 0; z-index: 1; }
  ha-card.noname .name { display: none; }
  ha-card.noname .more { position: static; transform: none; }

  /* Room list */
  .rooms { margin-top: 12px; border-radius: 12px; padding: 4px 0; }
  .room {
    display: grid; grid-template-columns: 22px minmax(0, 1fr) auto auto 52px; align-items: center; gap: 10px;
    width: 100%; box-sizing: border-box; padding: 10px 14px; border-radius: 0; text-align: left;
  }
  .room + .room { border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .room ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .room.calling ha-icon { color: var(--dial-color); }
  .r-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-cur { font-size: 14px; font-variant-numeric: tabular-nums; }
  .r-hum, .r-tgt { font-size: 13px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
  .room.off .r-tgt { font-style: italic; }
  .room.unavailable { opacity: 0.45; }
  .r-empty { padding: 14px; font-size: 13px; color: var(--secondary-text-color); }

  /* Room preset pill */
  .select-row {
    position: relative; display: flex; align-items: center; height: 56px; margin-top: 12px;
    padding-left: 16px; border-radius: 12px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--secondary-text-color); margin-right: 20px; flex: none; }
  .select-row.set .dot { background: var(--dial-color); }
  .select-row select {
    appearance: none; -webkit-appearance: none; flex: 1; height: 100%; padding-right: 44px;
    background: transparent; border: none; outline: none; cursor: pointer;
    color: var(--primary-text-color); font: inherit; font-size: 16px;
  }
  select option { background: var(--card-background-color); color: var(--primary-text-color); }
  .select-row > ha-icon { position: absolute; right: 14px; pointer-events: none; color: var(--primary-text-color); }

  /* Control tiles (same as appliance-dial-card) */
  .controls { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  @container (max-width: 300px) { .controls { grid-template-columns: minmax(0, 1fr); } }
  .ctl {
    position: relative; display: flex; align-items: center; gap: 8px; min-height: 56px;
    padding: 8px; border-radius: 12px; box-sizing: border-box;
  }
  .ctl.wide { grid-column: 1 / -1; }
  .ctl.toggle, .ctl.select, .ctl.info { cursor: pointer; }
  .ctl:focus-visible, .ctl.select:focus-within { outline: 2px solid var(--ctl-color); outline-offset: 1px; }
  .ctl.unavailable { opacity: 0.45; pointer-events: none; }
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
  .vtext { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cval .caret { flex: none; --mdc-icon-size: 18px; }
  .ctl select { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; opacity: 0; cursor: pointer; }
  .mini { flex: none; width: 34px; height: 34px; padding: 0; border: 1px solid var(--outline-color, var(--divider-color)); }
  .mini ha-icon { --mdc-icon-size: 18px; }
  .mini:disabled { opacity: 0.35; cursor: default; }
  .sw { flex: none; position: relative; width: 34px; height: 18px; border-radius: 9px; background: var(--ctl-color); transition: background 0.2s; }
  .sw::after { content: ""; position: absolute; top: 2px; left: 18px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left 0.2s; }
  .ctl.off .sw { background: color-mix(in srgb, var(--primary-text-color) 25%, transparent); }
  .ctl.off .sw::after { left: 2px; }

  @media (prefers-reduced-motion: reduce) { .fill, .chip, .badge, .sw, .sw::after { transition: none; } }
`;

class HeatingDialCard extends HTMLElement {
  static getStubConfig() {
    return { name: "Whole house", boiler_entity: "climate.turnuptheheat" };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    if (config.entity && !String(config.entity).startsWith("climate.")) {
      throw new Error("entity must be a climate entity (leave it out for whole-house mode)");
    }
    this._house = !config.entity;
    this._config = {
      color: HEAT,
      show_rooms: true,
      show_presets: true,
      ...(this._house ? HOUSE_DEFAULTS : {}),
      ...config,
    };
    clearTimeout(this._commitTimer);
    this._pending = null;
    this._pendingCommitted = false;
    this._optsKey = null;
    this._chipsKey = null;
    this._roomsKey = null;
    this._ctl = null;
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
    this._timer = setInterval(() => this._update(), 30000); // keep the boost countdown moving
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearTimeout(this._commitTimer);
  }

  getCardSize() {
    const tiles = Math.ceil((this._config?.controls?.length || 0) / 2);
    if (!this._house) return 8 + tiles;
    return 10 + (this._config?.show_rooms ? (this._roomRows?.length || 4) : 0) + tiles;
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
            <path class="fill" d="${ARC}" pathLength="100" stroke-dasharray="0 100"></path>
            <circle class="cur" r="4" cx="40.6" cy="159.4"></circle>
            <circle class="handle" r="9" cx="40.6" cy="159.4"></circle>
          </svg>
          <div class="center" aria-live="polite">
            <div class="label"></div>
            <div class="big"><span class="value">--</span><span class="unit"></span></div>
            <div class="sub">
              <span class="part p-temp" title="Current temperature"><ha-icon icon="mdi:thermometer"></ha-icon><span class="t-cur"></span></span>
              <span class="part p-hum" title="Humidity"><ha-icon icon="mdi:water-percent"></ha-icon><span class="t-hum"></span></span>
            </div>
          </div>
          <div class="buttons">
            <button class="round minus" title="Lower target"><ha-icon icon="mdi:minus"></ha-icon></button>
            <button class="round power" title="Turn heating on or off"><ha-icon icon="mdi:power"></ha-icon></button>
            <button class="round plus" title="Raise target"><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
        </div>
        <button class="status">
          <div class="badge"><ha-icon class="s-icon" icon="mdi:fire"></ha-icon></div>
          <div class="text"><div class="s-main"></div><div class="s-sub"></div></div>
        </button>
        <div class="chips" role="group" aria-label="House presets"></div>
        <div class="select-row">
          <span class="dot"></span>
          <select aria-label="Room preset"></select>
          <ha-icon icon="mdi:menu-down"></ha-icon>
        </div>
        <div class="rooms"></div>
        <div class="controls"></div>
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
      pTemp: $(".p-temp"),
      tCur: $(".t-cur"),
      pHum: $(".p-hum"),
      tHum: $(".t-hum"),
      minus: $(".minus"),
      plus: $(".plus"),
      power: $(".power"),
      status: $(".status"),
      sIcon: $(".s-icon"),
      sMain: $(".s-main"),
      sSub: $(".s-sub"),
      chips: $(".chips"),
      selectRow: $(".select-row"),
      select: $(".select-row select"),
      rooms: $(".rooms"),
      controls: $(".controls"),
    };
    const e = this._els;
    e.card.style.setProperty("--dial-color", c.color);
    e.status.style.setProperty("--ctl-color", c.color);
    const size = Number(c.dial_size) || (this._house ? 260 : 220);
    e.card.style.setProperty("--dial-size", `${Math.max(160, Math.min(320, size))}px`);
    if (c.controls_columns) e.controls.style.setProperty("--cols", c.controls_columns);

    e.status.style.display = this._house ? "" : "none";
    e.chips.style.display = this._house && c.show_presets ? "" : "none";
    e.rooms.style.display = this._house && c.show_rooms ? "" : "none";
    e.card.classList.toggle("noname", c.show_name === false);
    e.selectRow.style.display = "none";

    $(".more").addEventListener("click", () =>
      this._moreInfo(this._house ? c.preset_entity : c.entity)
    );
    e.minus.addEventListener("click", () => this._nudge(-1));
    e.plus.addEventListener("click", () => this._nudge(1));
    e.power.addEventListener("click", () => (this._house ? this._powerHouse() : this._powerRoom()));
    e.status.addEventListener("click", () => this._moreInfo(c.boiler_entity || c.pause_entity));
    e.select.addEventListener("change", (ev) => {
      if (this._house) return;
      this._hass.callService("climate", "set_preset_mode", {
        entity_id: c.entity,
        preset_mode: ev.target.value,
      });
    });
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

  _n(v, fixed) {
    const lang = this._hass?.locale?.language;
    const opts = fixed != null
      ? { minimumFractionDigits: fixed, maximumFractionDigits: fixed }
      : { minimumFractionDigits: 0, maximumFractionDigits: 1 };
    return new Intl.NumberFormat(lang, opts).format(v);
  }

  _unit() {
    return this._hass?.config?.unit_system?.temperature || "°C";
  }

  _list(names) {
    if (names.length > 3) return `${names.length} rooms`;
    try {
      return new Intl.ListFormat(this._hass?.locale?.language, { type: "conjunction" }).format(names);
    } catch (_) {
      return names.join(", ");
    }
  }

  /* ---------- state ---------- */

  _update() {
    if (!this._hass || !this._els) return;
    if (this._house) this._updateHouse();
    else this._updateRoom();
    if (!this._ctl) this._buildControls();
    this._updateControls();
  }

  _paintDial(d) {
    const e = this._els;
    const span = d.max - d.min || 1;
    const frac = (v) => Math.min(1, Math.max(0, (v - d.min) / span));
    const pos = (f) => {
      const a = ((135 + 270 * f) * Math.PI) / 180;
      return [(100 + 84 * Math.cos(a)).toFixed(2), (100 + 84 * Math.sin(a)).toFixed(2)];
    };

    const hasTarget = d.target != null;
    e.card.classList.toggle("active", hasTarget);
    e.card.classList.toggle("heating", !!d.heating && hasTarget);
    if (hasTarget) {
      const f = frac(d.target);
      e.fill.setAttribute("stroke-dasharray", `${(f * 100).toFixed(2)} 100`);
      const [x, y] = pos(f);
      e.handle.setAttribute("cx", x);
      e.handle.setAttribute("cy", y);
    }

    const hasCur = d.current != null;
    e.card.classList.toggle("has-cur", hasCur);
    if (hasCur) {
      const [x, y] = pos(frac(d.current));
      e.cur.setAttribute("cx", x);
      e.cur.setAttribute("cy", y);
    }

    e.label.textContent = d.label || "";
    e.value.textContent = hasTarget ? this._n(d.target) : d.word || "--";
    e.value.classList.toggle("word", !hasTarget);
    e.unit.textContent = hasTarget ? this._unit() : "";

    e.pTemp.style.display = hasCur ? "" : "none";
    e.tCur.textContent = hasCur ? `${this._n(d.current, 1)} ${this._unit()}` : "";
    e.pHum.style.display = d.humidity != null ? "" : "none";
    e.tHum.textContent = d.humidity != null ? `${Math.round(d.humidity)} %` : "";

    const dead = !!d.unavailable;
    e.minus.disabled = dead || (hasTarget && d.target <= d.min);
    e.plus.disabled = dead || (hasTarget && d.target >= d.max);
    e.power.disabled = dead;
    e.power.classList.toggle("on", !d.off);
    e.power.setAttribute("aria-pressed", String(!d.off));
    e.power.title = d.off ? "Turn heating on" : "Turn heating off";
  }

  /* ----- whole house ----- */

  _presetTemp(preset) {
    if (!preset) return null;
    const st = this._hass.states[this._config.preset_temp_prefix + preset.toLowerCase()];
    return st ? num(st.state) : null;
  }

  _updateHouse() {
    const h = this._hass;
    const c = this._config;
    const e = this._els;
    e.name.textContent = c.name || "Whole house";

    const ids = findRooms(h, c);
    const sts = ids.map((id) => h.states[id]).filter(Boolean);
    const avail = sts.filter((s) => !["unavailable", "unknown"].includes(s.state));
    const on = avail.filter((s) => s.state !== "off");
    const vals = (list, key) => list.map((s) => num(s.attributes[key])).filter((v) => v != null);

    const ps = h.states[c.preset_entity];
    const preset = ps?.state;
    const isOff = ps ? /^off$/i.test(preset) : on.length === 0;
    const presetTemp = isOff ? null : this._presetTemp(preset);
    const targets = vals(on, "temperature");

    // Clear a sent -/+ change once it shows up (or after a timeout)
    if (this._pending != null && this._pendingCommitted) {
      const manual = this._presetTemp("manual");
      const landed = ps
        ? preset === "Manual" && manual === this._pending
        : targets.length && targets.every((t) => t === this._pending);
      if (landed || Date.now() - this._pendingAt > PENDING_TIMEOUT) this._pending = null;
    }

    const manualSt = h.states[c.preset_temp_prefix + "manual"];
    const min = num(manualSt?.attributes.min) ?? num(c.min_temp) ?? 5;
    const max = num(manualSt?.attributes.max) ?? num(c.max_temp) ?? 28;
    const mixed = presetTemp == null && new Set(targets).size > 1;
    const target = this._pending ?? (isOff ? null : presetTemp ?? avg(targets));

    const calling = on.filter(isCalling);
    const boiler = c.boiler_entity && h.states[c.boiler_entity];
    const paused = h.states[c.pause_entity]?.state === "on";
    const firing = boiler ? boiler.attributes.hvac_action === "heating" : calling.length > 0;

    // Label above the number
    let label = "";
    if (this._pending != null) label = "Set all rooms";
    else if (!isOff && /^boost$/i.test(preset || "")) label = this._boostLabel();
    else if (!isOff && ps) label = this._fmt(ps);
    else if (mixed) label = "Mixed";

    this._dialState = { target, min, max, off: isOff, current: avg(vals(avail, "current_temperature")) };
    this._paintDial({
      ...this._dialState,
      label,
      word: sts.length ? "Off" : "--",
      heating: calling.length > 0,
      humidity: avg(vals(avail, "current_humidity")),
      unavailable: !sts.length,
    });

    // Boiler status line
    const adjusted = presetTemp == null ? 0 : on.filter((s) => num(s.attributes.temperature) !== presetTemp).length;
    let main;
    if (!sts.length) main = "No rooms found";
    else if (isOff) main = "Heating off";
    else if (calling.length) main = `Heating ${this._list(calling.map((s) => this._roomName(s)))}`;
    else main = "All rooms up to temperature";
    const subs = [];
    if (paused) subs.push("Boiler control paused");
    else if (boiler) subs.push(firing ? "Boiler on" : "Boiler off");
    if (adjusted && !isOff) subs.push(`${adjusted} ${adjusted === 1 ? "room" : "rooms"} set differently`);
    e.sMain.textContent = main;
    e.sSub.textContent = subs.join(", ");
    e.sSub.style.display = subs.length ? "" : "none";
    e.sIcon.setAttribute("icon", paused ? "mdi:pause-circle-outline" : "mdi:fire");
    e.status.classList.toggle("idle", paused || !firing);

    if (c.show_presets) this._updateChips(ps);
    if (c.show_rooms) this._updateRooms(ids);
  }

  _boostLabel() {
    const t = this._hass.states[this._config.boost_timer];
    const end = t?.state === "active" ? Date.parse(t.attributes.finishes_at) : NaN;
    if (Number.isNaN(end)) return "Boost";
    const mins = Math.max(1, Math.ceil((end - Date.now()) / 60000));
    const left = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    return `Boost, ${left} left`;
  }

  _roomName(st) {
    return st.attributes.friendly_name || st.entity_id;
  }

  _updateChips(ps) {
    const h = this._hass;
    const c = this._config;
    const e = this._els;
    if (!ps) {
      e.chips.style.display = "none";
      return;
    }
    e.chips.style.display = "";
    const options = ps.attributes.options || [];
    const wanted = c.presets || HOUSE_PRESETS;
    const opts = wanted
      .map((w) => options.find((o) => o.toLowerCase() === String(w).toLowerCase()))
      .filter(Boolean);
    const key = opts.join("|");
    if (key !== this._chipsKey) {
      this._chipsKey = key;
      for (const chip of this._chips || []) for (const r of chip.rows) clearTimeout(r.timer);
      this._chips = opts.map((opt) => this._makeChip(ps, opt));
      e.chips.replaceChildren(...this._chips.map((x) => x.el));
    }
    for (const chip of this._chips) {
      chip.el.setAttribute("aria-pressed", String(ps.state === chip.opt));
      for (const r of chip.rows) {
        const st = h.states[r.entity];
        if (!st) {
          r.val.textContent = "–";
          r.dn.disabled = r.up.disabled = true;
          continue;
        }
        if (r.pending != null && r.sent && (Number(st.state) === r.pending || Date.now() - r.pendingAt > 10000)) {
          r.pending = null;
          r.sent = false;
        }
        const v = r.pending ?? Number(st.state);
        r.val.textContent = r.kind === "dur" ? this._dur(v * 3600000) : `${this._n(v)}°`;
        r.dn.disabled = !(v > (st.attributes.min ?? -Infinity));
        r.up.disabled = !(v < (st.attributes.max ?? Infinity));
      }
    }
  }

  _makeChip(ps, opt) {
    const c = this._config;
    const el = document.createElement("div");
    el.className = "chip";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const isOff = /^off$/i.test(opt);
    if (isOff) el.classList.add("off-chip");
    el.innerHTML = `<div class="c-head"><ha-icon></ha-icon><span class="c-name"></span></div><div class="c-body"></div>`;
    el.querySelector("ha-icon").setAttribute("icon", PRESET_ICONS[opt.toLowerCase()] || "mdi:thermostat");
    const color = c.preset_colors?.[opt.toLowerCase()] || c.preset_colors?.[opt] || PRESET_COLORS[opt.toLowerCase()];
    if (color) el.style.setProperty("--pc", color);
    const body = el.querySelector(".c-body");
    const label = this._fmt(ps, opt);
    el.querySelector(".c-name").textContent = label;

    const select = () => {
      clearTimeout(this._commitTimer);
      this._pending = null;
      this._select(opt);
    };
    el.addEventListener("click", select);
    el.addEventListener("keydown", (ev) => {
      if (ev.target === el && (ev.key === "Enter" || ev.key === " ")) {
        ev.preventDefault();
        select();
      }
    });

    const rows = [];
    const addRow = (entity, kind, what) => {
      const row = document.createElement("div");
      row.className = "c-row";
      row.innerHTML = `
        <button class="step dn"><ha-icon icon="mdi:minus"></ha-icon></button>
        <span class="c-val"></span>
        <button class="step up"><ha-icon icon="mdi:plus"></ha-icon></button>`;
      const r = { entity, kind, val: row.querySelector(".c-val"), dn: row.querySelector(".dn"), up: row.querySelector(".up"), pending: null };
      r.dn.setAttribute("aria-label", `Lower ${label} ${what}`);
      r.up.setAttribute("aria-label", `Raise ${label} ${what}`);
      for (const [btn, dir] of [[r.dn, -1], [r.up, 1]]) {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._stepHelper(r, dir);
        });
      }
      body.append(row);
      rows.push(r);
    };

    const tempEntity = c.preset_temp_prefix + opt.toLowerCase();
    if (isOff) {
      const note = document.createElement("div");
      note.className = "c-note";
      note.textContent = "All rooms off";
      body.append(note);
    } else if (this._hass.states[tempEntity]) {
      addRow(tempEntity, "temp", "temperature");
    }
    if (/^boost$/i.test(opt) && this._hass.states[c.boost_hours_entity]) {
      addRow(c.boost_hours_entity, "dur", "length");
    }
    return { opt, el, rows };
  }

  _stepHelper(r, dir) {
    const h = this._hass;
    const st = h.states[r.entity];
    if (!st) return;
    const { min = -Infinity, max = Infinity, step = 1 } = st.attributes;
    const decimals = (String(step).split(".")[1] || "").length;
    const cur = r.pending ?? Number(st.state);
    const next = Number(Math.min(max, Math.max(min, cur + dir * step)).toFixed(decimals));
    if (Number.isNaN(next) || next === cur) return;
    r.pending = next;
    r.sent = false;
    r.pendingAt = Date.now();
    clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      r.sent = true;
      r.pendingAt = Date.now();
      h.callService("input_number", "set_value", { entity_id: r.entity, value: r.pending });
    }, 700);
    this._update();
  }

  _dur(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60);
    return m % 60 ? `${hrs} h ${m % 60} min` : `${hrs} h`;
  }

  _updateRooms(ids) {
    const h = this._hass;
    const e = this._els;
    const key = ids.join("|");
    if (key !== this._roomsKey) {
      this._roomsKey = key;
      if (!ids.length) {
        const empty = document.createElement("div");
        empty.className = "r-empty";
        empty.textContent = "No Better Thermostat rooms found. List them under rooms: in the card config.";
        e.rooms.replaceChildren(empty);
        this._roomRows = [];
        return;
      }
      this._roomRows = ids.map((id) => {
        const b = document.createElement("button");
        b.className = "room";
        b.innerHTML = `<ha-icon icon="mdi:radiator"></ha-icon><span class="r-name"></span>
          <span class="r-cur"></span><span class="r-hum"></span><span class="r-tgt"></span>`;
        b.addEventListener("click", () => this._moreInfo(id));
        const $ = (s) => b.querySelector(s);
        return { id, el: b, name: $(".r-name"), cur: $(".r-cur"), hum: $(".r-hum"), tgt: $(".r-tgt") };
      });
      e.rooms.replaceChildren(...this._roomRows.map((r) => r.el));
    }
    for (const r of this._roomRows) {
      const st = h.states[r.id];
      const a = st?.attributes || {};
      const dead = !st || ["unavailable", "unknown"].includes(st.state);
      const off = st?.state === "off";
      const cur = num(a.current_temperature);
      const hum = num(a.current_humidity);
      const tgt = num(a.temperature);
      r.name.textContent = st ? this._roomName(st) : r.id;
      r.cur.textContent = cur != null ? `${this._n(cur, 1)}°` : "";
      r.hum.textContent = hum != null ? `${Math.round(hum)}%` : "";
      r.tgt.textContent = dead ? "–" : off ? "Off" : tgt != null ? `→ ${this._n(tgt)}°` : "";
      r.el.classList.toggle("calling", isCalling(st));
      r.el.classList.toggle("off", off);
      r.el.classList.toggle("unavailable", dead);
      r.el.title = st ? `${this._roomName(st)}: ${this._fmt(st)}` : r.id;
    }
  }

  /* ----- one room ----- */

  _updateRoom() {
    const h = this._hass;
    const c = this._config;
    const e = this._els;
    const st = h.states[c.entity];
    e.name.textContent = c.name || st?.attributes.friendly_name || c.entity;
    if (!st) {
      this._dialState = null;
      this._paintDial({ target: null, min: 5, max: 30, off: true, label: "Entity not found", unavailable: true });
      return;
    }
    const a = st.attributes;
    const dead = ["unavailable", "unknown"].includes(st.state);
    const off = st.state === "off";
    const min = num(a.min_temp) ?? 5;
    const max = num(a.max_temp) ?? 30;

    if (this._pending != null && this._pendingCommitted) {
      if (num(a.temperature) === this._pending || Date.now() - this._pendingAt > PENDING_TIMEOUT) this._pending = null;
    }
    const target = this._pending ?? (off || dead ? null : num(a.temperature));
    const humidity = c.humidity_entity ? num(h.states[c.humidity_entity]?.state) : num(a.current_humidity);

    let label = "";
    if (dead) label = "Unavailable";
    else if (this._pending != null) label = "Set to";
    else if (a.window_open === true) label = "Window open";
    else if (!off && a.hvac_action) label = this._fmtAttr(st, "hvac_action");

    this._dialState = { target, min, max, off, current: num(a.current_temperature) };
    this._paintDial({
      ...this._dialState,
      label,
      word: dead ? "--" : "Off",
      heating: a.hvac_action === "heating",
      humidity,
      unavailable: dead,
    });

    // Room preset picker
    const modes = Array.isArray(a.preset_modes) ? a.preset_modes : [];
    const showPill = c.show_presets !== false && modes.length > 0 && !dead;
    e.selectRow.style.display = showPill ? "" : "none";
    if (showPill) {
      const key = modes.join("|");
      if (key !== this._optsKey) {
        this._optsKey = key;
        e.select.replaceChildren(...modes.map((m) => this._option(m, this._fmtAttr(st, "preset_mode", m))));
      }
      if (this.shadowRoot.activeElement !== e.select) e.select.value = a.preset_mode ?? "none";
      e.selectRow.classList.toggle("set", !!a.preset_mode && a.preset_mode !== "none");
    }
  }

  /* ---------- actions ---------- */

  _nudge(dir) {
    const d = this._dialState;
    if (!d) return;
    const step = num(this._config.step) ?? num(this._hass.states[this._config.entity]?.attributes.target_temp_step) ?? 0.5;
    const base = this._pending ?? d.target ?? (d.current != null ? Math.round(d.current / step) * step : 20);
    const next = Math.min(d.max, Math.max(d.min, Math.round((base + dir * step) / step) * step));
    this._pending = Number(next.toFixed(2));
    this._pendingCommitted = false;
    this._pendingAt = Date.now();
    clearTimeout(this._commitTimer);
    this._commitTimer = setTimeout(() => this._commit(), COMMIT_DELAY);
    this._update();
  }

  async _commit() {
    const v = this._pending;
    if (v == null) return;
    this._pendingCommitted = true;
    this._pendingAt = Date.now();
    try {
      if (this._house) await this._commitHouse(v);
      else await this._commitRoom(v);
    } catch (err) {
      console.warn("heating-dial-card: could not set temperature", err);
      this._pending = null;
      this._update();
    }
  }

  async _commitHouse(v) {
    const h = this._hass;
    const c = this._config;
    const ps = h.states[c.preset_entity];
    const manual = c.preset_temp_prefix + "manual";
    const manualOpt = ps?.attributes.options?.find((o) => /^manual$/i.test(o));
    if (ps && manualOpt && h.states[manual]) {
      // The preset automation applies it to every room
      await h.callService("input_number", "set_value", { entity_id: manual, value: v });
      if (ps.state !== manualOpt) await this._select(manualOpt);
      return;
    }
    // No helpers: set the rooms directly
    const ids = findRooms(h, c);
    const offIds = ids.filter((id) => h.states[id]?.state === "off");
    if (offIds.length) await h.callService("climate", "set_hvac_mode", { entity_id: offIds, hvac_mode: "heat" });
    if (ids.length) await h.callService("climate", "set_temperature", { entity_id: ids, temperature: v });
  }

  async _commitRoom(v) {
    const h = this._hass;
    const id = this._config.entity;
    if (h.states[id]?.state === "off") {
      await h.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: this._heatMode(h.states[id]) });
    }
    await h.callService("climate", "set_temperature", { entity_id: id, temperature: v });
  }

  _powerHouse() {
    const h = this._hass;
    const c = this._config;
    const ps = h.states[c.preset_entity];
    const isOff = !!this._dialState?.off;
    clearTimeout(this._commitTimer);
    this._pending = null;
    if (ps) {
      const opts = ps.attributes.options || [];
      if (!isOff) {
        const offOpt = opts.find((o) => /^off$/i.test(o));
        if (offOpt) return this._select(offOpt);
      } else {
        const prev = h.states[c.previous_entity]?.state;
        const opt =
          opts.find((o) => o === prev && !/^(off|boost)$/i.test(o)) ||
          opts.find((o) => /^comfort$/i.test(o)) ||
          opts.find((o) => !/^off$/i.test(o));
        if (opt) return this._select(opt);
      }
    }
    const ids = findRooms(h, c);
    if (ids.length) h.callService("climate", "set_hvac_mode", { entity_id: ids, hvac_mode: isOff ? "heat" : "off" });
  }

  _powerRoom() {
    const st = this._hass.states[this._config.entity];
    if (!st) return;
    clearTimeout(this._commitTimer);
    this._pending = null;
    this._hass.callService("climate", "set_hvac_mode", {
      entity_id: st.entity_id,
      hvac_mode: st.state === "off" ? this._heatMode(st) : "off",
    });
  }

  _heatMode(st) {
    const modes = st?.attributes.hvac_modes || [];
    return modes.includes("heat") ? "heat" : modes.find((m) => m !== "off") || "heat";
  }

  _select(option) {
    return this._hass.callService("input_select", "select_option", {
      entity_id: this._config.preset_entity,
      option,
    });
  }

  _option(value, label) {
    const op = document.createElement("option");
    op.value = value;
    op.textContent = label;
    return op;
  }

  /* ---------- control tiles (same behaviour as appliance-dial-card) ---------- */

  _buildControls() {
    const wrap = this._els.controls;
    wrap.replaceChildren();
    this._ctl = [];
    for (const raw of this._config.controls || []) {
      const cfg = typeof raw === "string" ? { entity: raw } : raw;
      if (!cfg || !cfg.entity) continue;
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
      if (cfg.full_width ?? type === "number") tile.classList.add("wide");
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

      const iconEl = document.createElement(cfg.icon ? "ha-icon" : "ha-state-icon");
      if (cfg.icon) iconEl.setAttribute("icon", cfg.icon);
      tile.querySelector(".badge").append(iconEl);

      const item = {
        cfg, domain, type, tile, iconEl,
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

      wrap.append(tile);
      this._ctl.push(item);
    }
    wrap.style.display = this._ctl.length ? "" : "none";
  }

  _updateControls() {
    const h = this._hass;
    for (const it of this._ctl) {
      const st = h.states[it.cfg.entity];
      const name = it.cfg.name || this._shortName(st, it.cfg.entity);
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

      it.vtext.textContent = this._fmt(st);

      if (it.type === "select") {
        const opts = st.attributes.options || [];
        const key = opts.join("|");
        if (key !== it.optsKey) {
          it.optsKey = key;
          it.select.setAttribute("aria-label", name);
          it.select.replaceChildren(...opts.map((o) => this._option(o, this._fmt(st, o))));
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

  // "Library Radiator battery" -> "Radiator battery"
  _shortName(st, fallback) {
    const full = st?.attributes.friendly_name || fallback;
    const device =
      this._config.name || (this._config.entity && this._hass.states[this._config.entity]?.attributes.friendly_name);
    if (device && full.toLowerCase().startsWith(device.toLowerCase()) && full.length > device.length) {
      const rest = full.slice(device.length).trim();
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return full;
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

/* ---------- grid of room dials (optionally with a history panel per room) ---------- */

class HeatingRoomsCard extends HTMLElement {
  static getStubConfig() {
    return { history: true };
  }

  setConfig(config) {
    this._config = { min_width: 260, history: false, ...(config || {}) };
    const c = this._config;
    const minW = c.history ? Number(c.min_width_history) || 620 : Number(c.min_width) || 260;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        .grid {
          display: grid; gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(min(100%, ${minW}px), 1fr));
        }
        .pair { container-type: inline-size; min-width: 0; }
        .pair-in { display: grid; grid-template-columns: minmax(230px, 280px) minmax(0, 1fr); gap: 8px; align-items: stretch; }
        @container (max-width: 580px) { .pair-in { grid-template-columns: minmax(0, 1fr); } }
        .empty { padding: 16px; color: var(--secondary-text-color); }
      </style>
      <div class="grid"></div>`;
    this._grid = this.shadowRoot.querySelector(".grid");
    this._key = null;
    this._cards = [];
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._grid) return;
    const c = this._config;
    const ex = new Set(c.exclude || []);
    const items = (Array.isArray(c.rooms) && c.rooms.length
      ? c.rooms.map((r) => (typeof r === "string" ? { entity: r } : r))
      : findRooms(hass, c).map((id) => ({ entity: id }))
    ).filter((r) => r?.entity && !ex.has(r.entity));

    const key = JSON.stringify(items);
    if (key !== this._key) {
      this._key = key;
      this._cards = [];
      const nodes = items.map((item) => {
        const dial = document.createElement("heating-dial-card");
        try {
          dial.setConfig({ ...(c.card || {}), ...item });
        } catch (err) {
          const msg = document.createElement("div");
          msg.className = "empty";
          msg.textContent = `${item.entity}: ${err.message}`;
          return msg;
        }
        this._cards.push(dial);
        if (!c.history) return dial;

        const hist = document.createElement("heating-stats-card");
        hist.setConfig({
          hours: c.history_hours || 24,
          ...(c.outdoor_entity ? { outdoor_entity: c.outdoor_entity } : {}),
          ...(c.history_card || {}),
          entity: item.entity,
        });
        this._cards.push(hist);
        const pair = document.createElement("div");
        pair.className = "pair";
        const inner = document.createElement("div");
        inner.className = "pair-in";
        inner.append(dial, hist);
        pair.append(inner);
        return pair;
      });
      if (!nodes.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No Better Thermostat rooms found. List them under rooms: in the card config.";
        this._grid.replaceChildren(empty);
      } else {
        this._grid.replaceChildren(...nodes);
      }
    }
    for (const el of this._cards) el.hass = hass;
  }

  getCardSize() {
    const n = this._cards?.length || 1;
    return this._config?.history ? n * 4 : Math.max(1, Math.ceil(n / 2)) * 8;
  }

  getGridOptions() {
    return { columns: "full" };
  }
}

/* ---------- history graph + stats (whole house, or one room with `entity`) ---------- */

const STATS_REFRESH_MS = 5 * 60 * 1000;
const STATS_POINTS = 144;
const MIN = 60000;
const HOUR = 3600000;

const STATS_STYLE = `
  :host { display: block; height: 100%; }
  ha-card { padding: 12px 16px 14px; container-type: inline-size; height: 100%; box-sizing: border-box; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 13px; color: var(--secondary-text-color); min-width: 0; }
  .lg { display: flex; align-items: center; gap: 5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lg b { font-weight: 500; color: var(--primary-text-color); }
  .sw { width: 10px; height: 3px; border-radius: 2px; flex: none; }
  .sw.t { background: var(--temp-color); }
  .sw.g { background: color-mix(in srgb, var(--primary-text-color) 50%, transparent); }
  .sw.h { background: var(--hum-color); }
  .sw.b { height: 10px; border-radius: 2px; background: color-mix(in srgb, var(--temp-color) 30%, transparent); }
  .when { color: var(--primary-text-color); font-weight: 500; }
  .ranges { display: flex; flex: none; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .ranges button {
    background: none; border: none; color: var(--secondary-text-color); font: inherit; font-size: 12px;
    padding: 4px 9px; border-radius: 8px; cursor: pointer;
  }
  .ranges button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); color: var(--primary-text-color); }
  .ranges button:focus-visible { outline: 2px solid var(--temp-color); outline-offset: 1px; }

  .plot { position: relative; height: 128px; margin: 10px 0 0; padding: 0 30px; touch-action: pan-y; cursor: crosshair; }
  .plot svg { display: block; width: 100%; height: 112px; overflow: visible; }
  .band { fill: color-mix(in srgb, var(--temp-color) 18%, transparent); }
  .grid line { stroke: color-mix(in srgb, var(--primary-text-color) 8%, transparent); vector-effect: non-scaling-stroke; }
  .tline, .hline, .gline { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
  .tline { stroke: var(--temp-color); stroke-width: 2; }
  .gline { stroke: var(--primary-text-color); stroke-opacity: 0.45; stroke-width: 1.5; stroke-dasharray: 1 4; }
  .hline { stroke: var(--hum-color); stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.9; }
  .cursor { position: absolute; top: 0; height: 112px; width: 1px; background: var(--primary-text-color); opacity: 0.5; pointer-events: none; display: none; }
  .plot.scrub .cursor { display: block; }
  .ax { position: absolute; font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1; pointer-events: none; }
  .ax.tl, .ax.bl { left: 0; color: var(--temp-color); }
  .ax.tr, .ax.br { right: 0; color: var(--hum-color); text-align: right; }
  .ax.tl, .ax.tr { top: 0; }
  .ax.bl, .ax.br { top: 102px; }
  .times { position: absolute; left: 30px; right: 30px; bottom: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); pointer-events: none; }

  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
  @container (max-width: 420px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .st { padding: 8px 10px; border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); min-width: 0; }
  .st-l { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-v { font-size: 17px; margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-s { font-size: 12px; color: var(--secondary-text-color); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .st.live .st-s { color: var(--temp-color); }
  .msg { padding: 28px 0; text-align: center; font-size: 13px; color: var(--secondary-text-color); }
`;

class HeatingStatsCard extends HTMLElement {
  static getStubConfig() {
    return { boiler_entity: "climate.turnuptheheat" };
  }

  setConfig(config) {
    this._config = {
      temp_color: HEAT,
      humidity_color: "var(--blue-color, #2196f3)",
      demand_entity: "binary_sensor.heat_demand",
      ranges: [6, 24, 72],
      hours: 24,
      ...(config || {}),
    };
    this._room = !!this._config.entity;
    this._hours = Number(this._config.hours) || 24;
    this._data = null;
    this._fetchedAt = 0;
    this._fetchId = 0;
    this._scrubIdx = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._els) return;
    if (!this._loading && Date.now() - this._fetchedAt > STATS_REFRESH_MS) this._fetch();
    else if (this._scrubIdx == null) this._paintLegend(null);
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>${STATS_STYLE}</style>
      <ha-card>
        <div class="top">
          <div class="legend">
            <span class="lg when"></span>
            <span class="lg" title="Temperature"><span class="sw t"></span><b class="v-t">–</b></span>
            <span class="lg lg-g" title="Target"><span class="sw g"></span><b class="v-g">–</b></span>
            <span class="lg" title="Humidity"><span class="sw h"></span><b class="v-h">–</b></span>
            <span class="lg"><span class="sw b"></span><span class="v-b">Heating</span></span>
            <span class="lg v-o"></span>
          </div>
          <div class="ranges" role="group" aria-label="Time range"></div>
        </div>
        <div class="body"><div class="msg">Loading history…</div></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      card: $("ha-card"), when: $(".when"), vt: $(".v-t"), vg: $(".v-g"), lgG: $(".lg-g"),
      vh: $(".v-h"), vb: $(".v-b"), vo: $(".v-o"), ranges: $(".ranges"), body: $(".body"),
    };
    this._els.card.style.setProperty("--temp-color", c.temp_color);
    this._els.card.style.setProperty("--hum-color", c.humidity_color);
    this._els.lgG.style.display = this._room ? "" : "none";
    for (const hrs of c.ranges) {
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

  /* ----- data ----- */

  async _fetch() {
    const h = this._hass;
    const c = this._config;
    const id = ++this._fetchId;
    this._loading = true;
    const end = Date.now();
    const start = end - this._hours * HOUR;
    const rooms = this._room ? [] : findRooms(h, c);
    const heatId = c.boiler_entity && h.states[c.boiler_entity] ? c.boiler_entity : c.demand_entity;
    const ids = (this._room ? [c.entity, c.outdoor_entity] : [...rooms, heatId]).filter((x) => x && h.states[x]);
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
      this._data = this._room
        ? this._processRoom(res || {}, start, end)
        : this._processHouse(res || {}, rooms, heatId, start, end);
    } catch (err) {
      console.warn("heating-stats-card: could not load history", err);
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
    return (raw || []).map((e) => {
      attrs = e.a ?? e.attributes ?? attrs;
      const t = e.lu != null ? e.lu * 1000 : Date.parse(e.last_updated || e.last_changed);
      return { t, s: e.s ?? e.state, a: attrs };
    }).filter((x) => Number.isFinite(x.t)).sort((x, y) => x.t - y.t);
  }

  _at(series, t) {
    let lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best >= 0 ? series[best] : null;
  }

  _live(e) {
    return e && !["unavailable", "unknown"].includes(e.s) ? e : null;
  }

  _avgAt(roomSeries, t, key) {
    const vals = [];
    for (const s of roomSeries) {
      const e = this._live(this._at(s, t));
      const v = e ? num(e.a[key]) : null;
      if (v != null) vals.push(v);
    }
    return avg(vals);
  }

  _runs(series, on, start, end) {
    let runs = [];
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

  _sampleTimes(start, end) {
    const out = [];
    for (let i = 0; i < STATS_POINTS; i++) out.push(start + ((end - start) * i) / (STATS_POINTS - 1));
    return out;
  }

  _range(vals) {
    const v = vals.filter((x) => x != null);
    return v.length ? [Math.min(...v), Math.max(...v), avg(v)] : [null, null, null];
  }

  _processHouse(res, rooms, heatId, start, end) {
    const roomSeries = rooms.map((id) => this._series(res[id])).filter((s) => s.length);
    const times = this._sampleTimes(start, end);
    const temp = times.map((t) => this._avgAt(roomSeries, t, "current_temperature"));
    const hum = times.map((t) => this._avgAt(roomSeries, t, "current_humidity"));
    const hs = this._series(res[heatId]);
    const isBoiler = heatId && heatId.startsWith("climate.");
    const runs = this._runs(hs, (e) => (isBoiler ? e.a?.hvac_action === "heating" : e.s === "on"), start, end);
    const total = runs.reduce((a, r) => a + (r.end - r.start), 0);
    const last = runs[runs.length - 1] || null;
    const gain = last
      ? { from: this._avgAt(roomSeries, last.start, "current_temperature"), to: this._avgAt(roomSeries, last.end, "current_temperature") }
      : null;
    const [tMin, tMax] = this._range(temp);
    const [hMin, hMax] = this._range(hum);
    return { start, end, times, temp, hum, target: null, runs, total, last, gain, tMin, tMax, hMin, hMax, hasHeat: hs.length > 0 };
  }

  _processRoom(res, start, end) {
    const c = this._config;
    const rs = this._series(res[c.entity]);
    const os = c.outdoor_entity ? this._series(res[c.outdoor_entity]) : [];
    const times = this._sampleTimes(start, end);
    const temp = [], hum = [], target = [], out = [];
    for (const t of times) {
      const e = this._live(this._at(rs, t));
      temp.push(e ? num(e.a.current_temperature) : null);
      hum.push(e ? num(e.a.current_humidity) : null);
      target.push(e && e.s !== "off" ? num(e.a.temperature) : null);
      const o = this._live(this._at(os, t));
      out.push(o ? num(o.s) : null);
    }
    const tAt = (t) => {
      const e = this._live(this._at(rs, t));
      return e ? num(e.a.current_temperature) : null;
    };

    // Valve (room) heating periods
    const runs = this._runs(rs, (e) => e.a?.hvac_action === "heating", start, end);
    const total = runs.reduce((a, r) => a + (r.end - r.start), 0);

    // On target: share of time within ±0.5 °C, and average deviation
    let nT = 0, inT = 0, dev = 0;
    temp.forEach((v, i) => {
      if (v == null || target[i] == null) return;
      nT++;
      dev += v - target[i];
      if (Math.abs(v - target[i]) <= 0.5) inT++;
    });

    // Warm-up rate while the valve is open (runs of 15 min or more)
    let up = 0, upH = 0;
    for (const r of runs) {
      if (r.end - r.start < 15 * MIN) continue;
      const a = tAt(r.start), b = tAt(r.end);
      if (a == null || b == null) continue;
      up += b - a;
      upH += (r.end - r.start) / HOUR;
    }

    // Cool-down while idle (skip 20 min of residual radiator heat), and heat-loss coefficient
    const idle = [];
    let cursor = start;
    for (const r of runs) {
      if (r.start > cursor) idle.push({ start: cursor, end: r.start, afterHeat: cursor !== start });
      cursor = r.end;
    }
    if (cursor < end) idle.push({ start: cursor, end, afterHeat: cursor !== start });
    let down = 0, downH = 0, lossNum = 0, lossDen = 0, lossH = 0;
    for (const seg of idle) {
      const s0 = seg.afterHeat ? seg.start + 20 * MIN : seg.start;
      if (seg.end - s0 < 45 * MIN) continue;
      const a = tAt(s0), b = tAt(seg.end);
      if (a == null || b == null) continue;
      const hrs = (seg.end - s0) / HOUR;
      down += b - a;
      downH += hrs;
      if (os.length) {
        const diffs = [];
        times.forEach((t, i) => {
          if (t >= s0 && t <= seg.end && temp[i] != null && out[i] != null) diffs.push(temp[i] - out[i]);
        });
        const d = avg(diffs);
        if (d != null && d > 3) {
          lossNum += a - b; // temperature lost
          lossDen += hrs * d; // hours × indoor-outdoor difference
          lossH += hrs;
        }
      }
    }
    const k = lossH >= 2 && lossDen > 0 ? lossNum / lossDen : null;

    const [tMin, tMax, tAvg] = this._range(temp);
    const [hMin, hMax, hAvg] = this._range(hum);
    const [gMin, gMax] = this._range(target);
    return {
      start, end, times, temp, hum, target, runs, total,
      tMin, tMax, tAvg, hMin, hMax, hAvg, gMin, gMax,
      onTarget: nT ? inT / nT : null,
      dev: nT ? dev / nT : null,
      warm: upH >= 0.25 ? up / upH : null,
      cool: downH >= 1 ? down / downH : null,
      k,
      hasOutdoor: os.length > 0,
      hasHeat: rs.length > 0,
    };
  }

  /* ----- drawing ----- */

  _n(v, d = 1) {
    return new Intl.NumberFormat(this._hass?.locale?.language, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }

  _time(t, withDay) {
    const lang = this._hass?.locale?.language;
    const opts = { hour: "2-digit", minute: "2-digit" };
    if (withDay) opts.weekday = "short";
    return new Date(t).toLocaleString(lang, opts);
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

  _paint() {
    const d = this._data;
    const body = this._els.body;
    if (!d || d.error) {
      body.innerHTML = `<div class="msg">Couldn't load history. Check that the recorder is running.</div>`;
      return;
    }
    if (d.tMin == null) {
      body.innerHTML = `<div class="msg">No temperature history yet for this period.</div>`;
      this._paintLegend(null);
      return;
    }

    const W = 1000;
    const span = d.end - d.start;
    const x = (t) => (((t - d.start) / span) * W).toFixed(1);
    const lo = Math.min(d.tMin, d.gMin ?? Infinity);
    const hi = Math.max(d.tMax, d.gMax ?? -Infinity);
    const tLo = Math.floor((lo - 0.3) * 2) / 2;
    const tHi = Math.ceil((hi + 0.3) * 2) / 2;
    const hLo = d.hMin != null ? Math.floor(d.hMin - 2) : 0;
    const hHi = d.hMax != null ? Math.ceil(d.hMax + 2) : 100;
    const yT = (v) => (96 - ((v - tLo) / (tHi - tLo || 1)) * 92).toFixed(2);
    const yH = (v) => (96 - ((v - hLo) / (hHi - hLo || 1)) * 92).toFixed(2);
    const lines = (vals, y, cls) => {
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

    const bands = d.runs.map((r) => `<rect class="band" x="${x(r.start)}" y="0" width="${Math.max(1.5, x(r.end) - x(r.start))}" height="100"></rect>`).join("");
    const gl = d.target ? lines(d.target, yT, "gline") : "";
    const hl = d.hMin != null ? lines(d.hum, yH, "hline") : "";
    const tl = lines(d.temp, yT, "tline");
    const multiDay = span > 26 * HOUR;

    body.innerHTML = `
      <div class="plot">
        <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="grid"><line x1="0" x2="${W}" y1="4" y2="4"></line><line x1="0" x2="${W}" y1="50" y2="50"></line><line x1="0" x2="${W}" y1="96" y2="96"></line></g>
          ${bands}${hl}${gl}${tl}
        </svg>
        <div class="cursor"></div>
        <span class="ax tl">${this._n(tHi)}°</span><span class="ax bl">${this._n(tLo)}°</span>
        ${d.hMin != null ? `<span class="ax tr">${hHi}%</span><span class="ax br">${hLo}%</span>` : ""}
        <div class="times"><span>${this._time(d.start, multiDay)}</span><span>${this._time(d.start + span / 2, multiDay)}</span><span>Now</span></div>
      </div>
      <div class="stats"></div>`;

    if (this._room) this._paintRoomStats();
    else this._paintHouseStats();
    this._paintLegend(null);

    const plot = body.querySelector(".plot");
    const cursor = body.querySelector(".cursor");
    const svg = body.querySelector("svg");
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const pbox = plot.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      this._scrubIdx = Math.round(f * (STATS_POINTS - 1));
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
    const c = this._config;
    const d = this._data;
    let t, hum, tgt, heating, when;
    if (idx != null && d?.times) {
      const at = d.times[idx];
      t = d.temp[idx];
      hum = d.hum[idx];
      tgt = d.target ? d.target[idx] : null;
      heating = d.runs.some((r) => at >= r.start && at <= r.end);
      when = this._time(at, d.end - d.start > 26 * HOUR);
    } else if (this._room) {
      const st = h.states[c.entity];
      const a = st?.attributes || {};
      t = num(a.current_temperature);
      hum = num(a.current_humidity);
      tgt = st && st.state !== "off" ? num(a.temperature) : null;
      heating = a.hvac_action === "heating";
      when = "Now";
    } else {
      const sts = findRooms(h, c).map((id) => h.states[id]).filter((s) => s && !["unavailable", "unknown"].includes(s.state));
      t = avg(sts.map((s) => num(s.attributes.current_temperature)).filter((v) => v != null));
      hum = avg(sts.map((s) => num(s.attributes.current_humidity)).filter((v) => v != null));
      const b = c.boiler_entity && h.states[c.boiler_entity];
      heating = b ? b.attributes.hvac_action === "heating" : h.states[c.demand_entity]?.state === "on";
      when = "Now";
    }
    e.when.textContent = when;
    e.vt.textContent = t != null ? `${this._n(t)} °C` : "–";
    e.vg.textContent = tgt != null ? `→ ${this._n(tgt, tgt % 1 ? 1 : 0)}°` : "Off";
    e.vh.textContent = hum != null ? `${Math.round(hum)} %` : "–";
    e.vb.textContent = heating ? "Heating" : this._room ? "Idle" : "Not heating";
    e.vb.style.color = heating ? "var(--temp-color)" : "";
    const o = c.outdoor_entity && h.states[c.outdoor_entity];
    const ov = o ? num(o.state) : null;
    e.vo.textContent = ov != null ? `Outside ${this._n(ov)}°` : "";
    e.vo.style.display = ov != null ? "" : "none";
  }

  _cell(label, value, sub, live, title) {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
    return `<div class="st${live ? " live" : ""}"${title ? ` title="${esc(title)}"` : ""}><div class="st-l">${esc(label)}</div><div class="st-v">${esc(value)}</div><div class="st-s">${esc(sub)}</div></div>`;
  }

  _signed(v, unit = "°") {
    const r = Math.round(v * 10) / 10;
    return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${this._n(Math.abs(r))}${unit}`;
  }

  _paintHouseStats() {
    const d = this._data;
    const box = this._els.body.querySelector(".stats");
    const pct = Math.round((d.total / (d.end - d.start)) * 100);
    const cycles = d.runs.length;
    const last = d.last;
    const g = d.gain;
    const gainVal = g && g.from != null && g.to != null ? g.to - g.from : null;
    box.innerHTML = [
      this._cell(
        "Last heating cycle",
        last ? this._dur(last.end - last.start) : "–",
        last ? (last.running ? "Running now" : `Ended ${this._time(last.end, d.end - last.end > 20 * HOUR)}`) : d.hasHeat ? "None in this period" : "No boiler history",
        last?.running
      ),
      this._cell("Cycle temp change", gainVal != null ? this._signed(gainVal) : "–", gainVal != null ? `${this._n(g.from)}° to ${this._n(g.to)}°` : ""),
      this._cell("Boiler on", this._dur(d.total), `${pct}% of ${this._rangeText()}`),
      this._cell("Heating cycles", String(cycles), cycles ? `Average ${this._dur(d.total / cycles)}` : ""),
      this._cell("Temperature", `${this._n(d.tMin)}–${this._n(d.tMax)}°`, "Lowest to highest"),
      this._cell("Humidity", d.hMin != null ? `${Math.round(d.hMin)}–${Math.round(d.hMax)}%` : "–", "Lowest to highest"),
    ].join("");
  }

  _dewPoint(t, rh) {
    if (t == null || rh == null || rh <= 0) return null;
    const a = 17.62, b = 243.12;
    const g = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * g) / (a - g);
  }

  _paintRoomStats() {
    const d = this._data;
    const h = this._hass;
    const box = this._els.body.querySelector(".stats");
    const st = h.states[this._config.entity];
    const live = st?.attributes || {};
    const heatingNow = live.hvac_action === "heating";
    const pct = Math.round((d.total / (d.end - d.start)) * 100);

    const onT = d.onTarget != null ? `${Math.round(d.onTarget * 100)}%` : "–";
    let devText = d.onTarget == null ? "Heating was off" : "";
    if (d.dev != null) {
      const r = Math.round(d.dev * 10) / 10;
      devText = r === 0 ? "Average spot on" : `Average ${this._n(Math.abs(r))}° ${r > 0 ? "above" : "below"}`;
    }

    const cells = [
      this._cell("Valve open", this._dur(d.total), heatingNow ? "Heating now" : `${pct}% of ${this._rangeText()}`, heatingNow,
        "Time this radiator's valve was heating"),
      this._cell("On target", onT, devText, false, "Share of time within ±0.5 °C of the target"),
      this._cell("Warm-up rate", d.warm != null ? `${this._signed(d.warm)}/h` : "–", d.warm != null ? "While heating" : "Not enough heating yet",
        false, "Average temperature rise per hour while the valve was open"),
      this._cell("Cool-down rate", d.cool != null ? `${this._signed(d.cool)}/h` : "–", d.cool != null ? "While idle" : "Not enough idle time",
        false, "Average temperature change per hour with the valve closed, ignoring 20 min of leftover radiator heat"),
    ];
    if (this._config.outdoor_entity) {
      const k = d.k;
      cells.push(
        this._cell(
          "Heat loss",
          k != null && k > 0 ? `${this._n(k, 3)} /h` : "–",
          k != null && k > 0 ? `Time constant ${Math.round(1 / k)} h` : k != null ? "Gained heat while idle" : "Needs more idle hours",
          false,
          "Cooling rate divided by the indoor–outdoor difference. Lower means a better insulated room. Time constant is how many hours the room takes to lose about 63% of its warmth above outside."
        )
      );
    } else {
      cells.push(this._cell("Temperature", `${this._n(d.tMin)}–${this._n(d.tMax)}°`, `Average ${this._n(d.tAvg)}°`));
    }
    const dp = this._dewPoint(num(live.current_temperature), num(live.current_humidity));
    cells.push(
      this._cell(
        "Humidity",
        d.hMin != null ? `${Math.round(d.hMin)}–${Math.round(d.hMax)}%` : "–",
        dp != null ? `Dew point now ${this._n(dp)}°` : d.hAvg != null ? `Average ${Math.round(d.hAvg)}%` : "",
        false,
        "Cold surfaces below the dew point get condensation"
      )
    );
    box.innerHTML = cells.join("");
  }
}

if (!customElements.get("heating-dial-card")) customElements.define("heating-dial-card", HeatingDialCard);
if (!customElements.get("heating-rooms-card")) customElements.define("heating-rooms-card", HeatingRoomsCard);
if (!customElements.get("heating-stats-card")) customElements.define("heating-stats-card", HeatingStatsCard);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: "heating-dial-card",
    name: "Heating Dial Card",
    description: "Thermostat dial for the whole house (all rooms at once) or a single room",
  },
  {
    type: "heating-stats-card",
    name: "Heating Stats Card",
    description: "Room temperature and humidity graph with heating cycle stats",
  },
  {
    type: "heating-rooms-card",
    name: "Heating Rooms Card",
    description: "Grid of room heating dials for every Better Thermostat room",
  }
);
