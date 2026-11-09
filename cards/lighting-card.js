/**
 * lighting-card  (v1)
 * A Home Assistant Lovelace card for every light in the house, in the same
 * style as appliance-dial-card.
 *
 * - Summary strip: lights on, rooms lit, unavailable count, All off.
 * - One section per floor (in floor registry order), then Outside, then
 *   Other areas / Other lights. Each floor has its own "Off" button.
 * - One panel per area. Its header tile is the room control: a Hue room or
 *   HA light group in the area if there is one, otherwise all the area's lights.
 *   Below it: today's on-time strip, quick presets and scenes, and a tile for
 *   each light.
 * - Tiles show the bulb's real colour and brightness. Tap the icon to toggle,
 *   drag sideways to dim, tap anywhere else for the control sheet
 *   (brightness, white temperature over the bulb's own Kelvin range, colour
 *   wheel and swatches, effects, today's history, and member lights).
 * - Unavailable lights are dimmed with a warning dot and sorted last.
 *
 * Everything is found from the entity, device, area and floor registries, so
 * no options are required. See README.md for the options.
 *
 * Install: copy to /config/www/lighting-card.js and add the resource
 * /local/lighting-card.js?v=1 (type: JavaScript module).
 */

const AMBER = "var(--amber-color, #ffc107)";
const THROTTLE = 300; // ms between service calls while dragging
const PENDING_TIMEOUT = 15000; // give up waiting for the new state to show
const REFRESH_MS = 5 * 60 * 1000;
const HOUR = 3600000;
const MIN = 60000;
const COLOR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
const DEFAULT_PRESETS = [
  { name: "Relax", icon: "mdi:sofa-outline", brightness: 40, kelvin: 2200 },
  { name: "Read", icon: "mdi:book-open-variant", brightness: 80, kelvin: 4000 },
  { name: "Bright", icon: "mdi:white-balance-sunny", brightness: 100, kelvin: 4500 },
  { name: "Night", icon: "mdi:weather-night", brightness: 5, kelvin: 2000 },
];
const SWATCHES = [
  [0, 100], [25, 100], [45, 100], [110, 90],
  [180, 90], [220, 100], [270, 85], [320, 75],
];
const HUE_NAMES = [
  [15, "Red"], [40, "Orange"], [70, "Yellow"], [160, "Green"], [200, "Cyan"],
  [255, "Blue"], [290, "Purple"], [340, "Pink"], [361, "Red"],
];

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isDead = (st) => !st || ["unavailable", "unknown"].includes(st.state);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const dom = (id) => id.split(".")[0];
const rgbCss = (rgb) => `rgb(${rgb.map((x) => Math.round(x)).join(", ")})`;

/** Approximate sRGB of a black body at k kelvin (Tanner Helland). */
function kelvinToRgb(k) {
  const t = clamp(k, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return [r, g, b].map((x) => clamp(x, 0, 255));
}

/** Hue (0–360) and saturation (0–100) at full value to RGB. */
function hsToRgb(h, s) {
  const sat = clamp(s, 0, 100) / 100;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 255 * (1 - sat * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

const hueName = (h) => HUE_NAMES.find(([lim]) => h < lim)[1];

function fmtDur(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
}

/** Merges [start, end] pairs (end null = still on) into a sorted, non-overlapping list. */
function mergeRuns(runs, now) {
  const list = runs.map(([s, e]) => [s, e ?? now]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

const STYLE = `
  :host {
    display: block;
    --amber: ${AMBER};
    --warn: var(--warning-color, #ffa600);
    --panel: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    --panel2: color-mix(in srgb, var(--primary-text-color) 3%, transparent);
  }
  ha-card { padding: 12px 16px 16px; container-type: inline-size; box-sizing: border-box; }
  .title { font-size: 22px; font-weight: 400; color: var(--primary-text-color); margin: 0 4px 10px; }
  button {
    background: none; border: none; color: var(--primary-text-color);
    cursor: pointer; padding: 8px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font: inherit;
  }
  button:focus-visible { outline: 2px solid var(--c, var(--amber)); outline-offset: 2px; }
  button:disabled { opacity: 0.35; cursor: default; }

  /* Summary strip */
  .summary {
    display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 12px;
    border-radius: 12px; background: var(--panel); margin-bottom: 4px;
  }
  .summary .disc {
    flex: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--secondary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
  .summary.lit .disc { color: var(--amber); background: color-mix(in srgb, var(--amber) 22%, transparent); }
  .summary .disc ha-icon { --mdc-icon-size: 22px; }
  .s-text { flex: 1; min-width: 0; }
  .s-main { font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-sub { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-sub .bad { color: var(--warn); }
  .pill {
    flex: none; gap: 6px; padding: 8px 14px 8px 10px; border-radius: 18px; font-size: 14px; font-weight: 500;
    border: 1px solid var(--outline-color, var(--divider-color));
  }
  .pill ha-icon { --mdc-icon-size: 18px; }

  /* Floor sections */
  .sec { margin-top: 18px; }
  .summary + .sec, .title + .sec { margin-top: 14px; }
  .sec:first-child { margin-top: 0; }
  .sec-head[hidden] { display: none; }
  .sec-head { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 4px; }
  .sec-head > ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
  .sec-name { font-size: 16px; font-weight: 500; white-space: nowrap; }
  .sec-sub { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; display: flex; align-items: center; gap: 4px; }
  .sec-sub ha-icon { --mdc-icon-size: 16px; }
  .sec-off { margin-left: auto; flex: none; font-size: 13px; padding: 4px 12px; border-radius: 14px; color: var(--secondary-text-color); background: var(--panel); }
  .sec-off[hidden] { display: none; }
  .rooms {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 10px; margin-top: 4px; align-items: start;
  }
  .room { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 16px; background: var(--panel2); min-width: 0; }

  /* Tiles */
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); gap: 8px; }
  .tile {
    --c: var(--secondary-text-color); --b: 0%;
    position: relative; display: flex; align-items: center; gap: 10px; min-height: 56px; min-width: 0;
    padding: 8px 10px 8px 8px; border-radius: 12px; box-sizing: border-box; overflow: hidden;
    background: var(--panel); cursor: pointer; outline: none;
    touch-action: pan-y; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .tile:focus-visible { box-shadow: inset 0 0 0 2px var(--c); }
  .fill {
    position: absolute; top: 0; bottom: 0; left: 0; width: var(--b); pointer-events: none;
    background: color-mix(in srgb, var(--c) 18%, transparent); transition: width 0.25s, background 0.25s;
  }
  .tile.dragging .fill { transition: none; }
  .tile.dragging { cursor: ew-resize; }
  .badge {
    position: relative; flex: none; width: 36px; height: 36px; padding: 0; border-radius: 50%;
    color: var(--secondary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    transition: color 0.2s, background 0.2s;
  }
  .on .badge { color: var(--c); background: color-mix(in srgb, var(--c) 22%, transparent); }
  .badge ha-icon { --mdc-icon-size: 20px; }
  .text { position: relative; flex: 1; min-width: 0; }
  .tname { font-size: 14px; font-weight: 500; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tsub { font-size: 12.5px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .tile.big { min-height: 64px; }
  .tile.big .badge { width: 40px; height: 40px; }
  .tile.big .badge ha-icon { --mdc-icon-size: 22px; }
  .tile.big .tname { font-size: 16px; }
  .chev { position: relative; flex: none; --mdc-icon-size: 20px; color: var(--secondary-text-color); }
  .warn {
    position: absolute; top: 5px; left: 31px; width: 15px; height: 15px; border-radius: 50%;
    display: none; align-items: center; justify-content: center; background: var(--warn); color: #000;
  }
  .tile.big .warn { left: 35px; }
  .warn ha-icon { --mdc-icon-size: 13px; }
  .tile.dead { cursor: default; }
  .tile.dead .badge, .tile.dead .text, .tile.dead .chev { opacity: 0.5; }
  .tile.dead .warn { display: flex; }

  /* On-time strip */
  .hrow { display: flex; align-items: center; gap: 10px; padding: 0 4px; }
  .strip {
    position: relative; flex: 1; height: 6px; border-radius: 3px; overflow: hidden;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
  .strip i { position: absolute; top: 0; bottom: 0; min-width: 2px; border-radius: 3px; background: var(--amber); }
  .strip b { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--primary-text-color); opacity: 0.45; }
  .htot { flex: none; min-width: 52px; text-align: right; font-size: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Preset and scene chips */
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 -2px; padding: 0 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .chips.wrap { flex-wrap: wrap; overflow: visible; }
  .chip {
    flex: none; gap: 6px; padding: 6px 12px 6px 9px; border-radius: 16px; font-size: 13px; white-space: nowrap;
    background: var(--panel); transition: background 0.2s;
  }
  .chip ha-icon { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .chip.scene ha-icon { color: var(--amber); }
  .chip.active { background: color-mix(in srgb, var(--amber) 22%, transparent); }
  .chip.active ha-icon { color: var(--amber); }

  /* Control sheet */
  dialog.sheet {
    border: none; padding: 16px; border-radius: 20px; box-sizing: border-box;
    width: min(440px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); overflow-y: auto;
    background: var(--ha-card-background, var(--card-background-color, #1c1c1c)); color: var(--primary-text-color);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45); font-family: var(--ha-font-family-body, inherit);
    overscroll-behavior: contain;
  }
  dialog.sheet::backdrop { background: rgba(0, 0, 0, 0.55); }
  @media (max-width: 520px) {
    dialog.sheet {
      width: 100vw; margin: auto 0 0; border-radius: 20px 20px 0 0; max-height: 88dvh;
      padding-bottom: calc(20px + env(safe-area-inset-bottom));
    }
  }
  .sh-head { --c: var(--secondary-text-color); display: flex; align-items: center; gap: 12px; }
  .sh-head .badge { width: 48px; height: 48px; }
  .sh-head .badge ha-icon { --mdc-icon-size: 26px; }
  .sh-name { font-size: 20px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sh-sub { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ib { flex: none; color: var(--secondary-text-color); }
  .ib ha-icon { --mdc-icon-size: 22px; }
  .sh-label { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--secondary-text-color); margin: 18px 2px 8px; }
  .sh-label span { color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .sl {
    --f: 0; position: relative; height: 48px; border-radius: 14px; overflow: hidden; cursor: pointer;
    background: var(--panel); touch-action: none; outline: none;
  }
  .sl:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-text-color); }
  .sl-fill {
    position: absolute; top: 0; bottom: 0; left: 0; width: calc(8px + (100% - 16px) * var(--f));
    background: color-mix(in srgb, var(--c, var(--amber)) 45%, transparent);
  }
  .sl.ct { background: var(--grad); }
  .sl.ct .sl-fill { display: none; }
  .sl.idle .sl-thumb { opacity: 0.35; }
  .sl-thumb {
    position: absolute; top: 9px; bottom: 9px; width: 4px; border-radius: 2px; left: calc(6px + (100% - 16px) * var(--f));
    background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }
  .sl-label {
    position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;
    font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums;
  }
  .sl.ct .sl-label { color: rgba(0, 0, 0, 0.75); }
  .sl.low .sl-label { left: auto; right: 14px; }
  .colour { display: flex; align-items: center; justify-content: space-around; gap: 16px; flex-wrap: wrap; }
  .wheel {
    position: relative; flex: none; width: 176px; aspect-ratio: 1; border-radius: 50%; cursor: crosshair; touch-action: none;
    background: radial-gradient(closest-side, #fff, rgba(255, 255, 255, 0)),
      conic-gradient(from 90deg, red, yellow, lime, cyan, blue, magenta, red);
  }
  .wheel .dot {
    position: absolute; left: var(--x, 50%); top: var(--y, 50%); width: 22px; height: 22px; margin: -11px 0 0 -11px;
    border-radius: 50%; border: 3px solid #fff; box-sizing: border-box; background: var(--dc, #fff);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.4); display: none; pointer-events: none;
  }
  .wheel.has .dot { display: block; }
  .swatches { display: grid; grid-template-columns: repeat(4, 34px); gap: 10px; }
  .swatch { width: 34px; height: 34px; padding: 0; background: var(--s); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18); }
  .hours { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .sheet .strip { height: 10px; border-radius: 5px; }
  .sheet .hrow { padding: 0; }

  @media (prefers-reduced-motion: reduce) { .fill, .badge, .chip { transition: none; } }
`;

class LightingCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    const c = { history: true, scenes: true, ...(config || {}) };
    for (const key of ["areas", "floors", "outside_areas", "include", "exclude"]) {
      if (c[key] != null && !Array.isArray(c[key])) throw new Error(`${key} must be a list`);
    }
    if (c.entities != null && (typeof c.entities !== "object" || Array.isArray(c.entities))) {
      throw new Error("entities must be a map of entity_id: { name, icon, area, hide }");
    }
    c.presets = c.presets === false ? [] : Array.isArray(c.presets) ? c.presets : DEFAULT_PRESETS;
    this._config = c;
    this._key = null;
    this._model = null;
    this._pend = {};
    this._thr = {};
    this._hist = null;
    this._fetchedAt = 0;
    this._fetchId = 0;
    this._sheetKey = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this._listen();
    }
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this._paintHistory();
      this._maybeFetch();
    }, MIN);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    for (const t of Object.values(this._thr || {})) clearTimeout(t.timer);
    const dlg = this.shadowRoot?.querySelector("dialog");
    if (dlg?.open) dlg.close();
  }

  getCardSize() {
    return Math.max(4, (this._model?.roomCount || 4) * 3);
  }

  getGridOptions() {
    return { columns: "full", min_columns: 6 };
  }

  /* ---------- model: lights, rooms and floors from the registries ---------- */

  _buildModel() {
    const h = this._hass;
    const c = this._config;
    const reg = h.entities || {};
    const devs = h.devices || {};
    const areas = h.areas || {};
    const floors = h.floors || {};
    const over = c.entities || {};
    const excl = new Set(c.exclude || []);

    let ids = Object.keys(h.states).filter((id) => dom(id) === "light");
    for (const id of c.include || []) if (h.states[id] && !ids.includes(id)) ids.push(id);
    ids = ids.filter((id) => !excl.has(id) && !reg[id]?.hidden && !over[id]?.hide);

    const areaOf = (id) => {
      const a = over[id]?.area ?? reg[id]?.area_id ?? devs[reg[id]?.device_id]?.area_id ?? null;
      return a && areas[a] ? a : null;
    };
    const floorOf = (aid) => (aid ? areas[aid]?.floor_id || null : null);
    const fname = (id) => h.states[id]?.attributes.friendly_name || id;
    const isGroup = (id) => {
      const a = h.states[id].attributes;
      return dom(id) === "light" && (a.is_hue_group === true || Array.isArray(a.entity_id));
    };
    const plain = ids.filter((id) => !isGroup(id));
    const groups = ids.filter(isGroup);
    const byName = new Map(plain.map((id) => [fname(id), id]));
    const membersOf = (gid) => {
      const a = h.states[gid].attributes;
      if (Array.isArray(a.entity_id)) return a.entity_id.filter((x) => h.states[x]);
      if (Array.isArray(a.lights)) return a.lights.map((n) => byName.get(n)).filter(Boolean);
      return [];
    };

    // Rooms: one per area that has lights
    const rooms = new Map();
    const room = (aid) => {
      if (!rooms.has(aid)) rooms.set(aid, { aid, group: null, tiles: [] });
      return rooms.get(aid);
    };
    const other = [];
    for (const id of plain) {
      const aid = areaOf(id);
      if (aid) room(aid).tiles.push(id);
      else other.push(id);
    }
    const floorGroups = {};
    const lc = (s) => String(s || "").trim().toLowerCase();
    for (const gid of groups) {
      const mem = membersOf(gid);
      let aid = areaOf(gid);
      if (!aid && mem.length) {
        const as = new Set(mem.map(areaOf));
        if (as.size === 1 && [...as][0]) aid = [...as][0];
      }
      if (aid) {
        const r = room(aid);
        if (!r.group) {
          r.group = gid;
        } else {
          // Two groups in one area: the Hue room, or the one named after the area, is the room control
          const score = (g) =>
            (h.states[g].attributes.hue_type === "room" ? 2 : 0) + (lc(fname(g)) === lc(areas[aid].name) ? 1 : 0);
          if (score(gid) > score(r.group)) {
            r.tiles.push(r.group);
            r.group = gid;
          } else {
            r.tiles.push(gid);
          }
        }
        continue;
      }
      // A zone spanning one floor (or named after a floor) belongs to that floor's header
      const fl = new Set(mem.map((x) => floorOf(areaOf(x))));
      let fid = fl.size === 1 ? [...fl][0] : null;
      if (!fid) fid = Object.keys(floors).find((f) => lc(floors[f].name) === lc(fname(gid))) || null;
      if (fid && !floorGroups[fid]) floorGroups[fid] = gid;
      else other.push(gid);
    }

    // Scenes by area or by Hue group name
    const scenes = c.scenes === false ? [] : Object.keys(h.states).filter((id) => dom(id) === "scene" && !reg[id]?.hidden && !excl.has(id));

    const units = new Map();
    const unavailableLast = (list) =>
      list.slice().sort((a, b) => (isDead(h.states[a]) ? 1 : 0) - (isDead(h.states[b]) ? 1 : 0));
    const iconOf = (id) => over[id]?.icon || reg[id]?.icon || h.states[id]?.attributes.icon || null;
    const shortName = (id, prefix) => {
      const n = over[id]?.name || fname(id);
      if (over[id]?.name || !prefix) return n;
      const p = `${prefix} `;
      return n.length > p.length && n.toLowerCase().startsWith(p.toLowerCase()) ? n.slice(p.length) : n;
    };
    const lightUnit = (id, prefix) => {
      const u = { key: id, entity: id, ids: [id], name: shortName(id, prefix), icon: iconOf(id), kind: isGroup(id) ? "group" : dom(id) };
      units.set(u.key, u);
      return u;
    };

    const buildRoom = (r) => {
      const area = areas[r.aid];
      const tiles = unavailableLast(r.tiles).map((id) => lightUnit(id, area.name));
      const key = `room:${r.aid}`;
      let u;
      if (!r.group && tiles.length === 1) {
        // One light and no group: the header tile controls it directly
        const t = tiles[0];
        u = { key, entity: t.entity, ids: [t.entity], name: area.name, icon: t.icon, kind: "room", lightName: t.name };
        tiles.length = 0;
      } else {
        u = { key, entity: r.group, ids: r.tiles.slice(), name: area.name, icon: area.icon || null, kind: "room" };
      }
      units.set(key, u);
      const gname = r.group ? lc(fname(r.group)) : null;
      const roomScenes = scenes
        .filter((s) => {
          if (areaOf(s) === r.aid) return true;
          const g = lc(h.states[s].attributes.group_name);
          return g && (g === lc(area.name) || g === gname);
        })
        .map((s) => ({ id: s, name: shortName(s, h.states[s].attributes.group_name || area.name), icon: iconOf(s) }));
      const dimmable = [...(u.entity ? [u.entity] : []), ...u.ids].some((id) => this._capsOf(id).bri);
      return {
        aid: r.aid,
        unit: u,
        tiles,
        scenes: roomScenes,
        presets: dimmable ? c.presets : [],
        floor: floorOf(r.aid),
      };
    };

    // Areas in registry order, or in the order given by `areas:`
    let order = Object.keys(areas).filter((a) => rooms.has(a));
    if (c.areas) order = c.areas.filter((a) => rooms.has(a));
    const built = order.map((a) => buildRoom(rooms.get(a)));

    const hasFloors = Object.keys(floors).length > 0;
    const outsideSet = new Set(c.outside_areas || (hasFloors ? built.filter((r) => !r.floor).map((r) => r.aid) : []));
    const sections = [];
    const used = new Set();
    const addSection = (key, name, icon, list, group) => {
      list.forEach((r) => used.add(r.aid));
      if (!list.length && !group) return;
      const ids = new Set();
      for (const r of list) {
        if (r.unit.entity) ids.add(r.unit.entity);
        r.unit.ids.forEach((x) => ids.add(x));
      }
      if (group) ids.add(group);
      sections.push({ key, name, icon, rooms: list, group, ids: [...ids] });
    };
    const want = (key) => !c.floors || c.floors.includes(key);
    const floorOrder = c.floors ? c.floors.filter((f) => floors[f]) : Object.keys(floors);
    for (const fid of floorOrder) {
      const f = floors[fid];
      const icon = f.icon || (f.level == null ? "mdi:home" : f.level < 0 ? "mdi:home-floor-negative-1" : f.level === 0 ? "mdi:home-floor-g" : `mdi:home-floor-${Math.min(f.level, 3)}`);
      const list = built.filter((r) => r.floor === fid && !outsideSet.has(r.aid));
      const g = floorGroups[fid] && !c.areas ? floorGroups[fid] : null;
      if (g) units.set(`floor:${fid}`, lightUnit(g));
      addSection(fid, f.name, icon, list, g);
    }
    if (want("outside")) {
      addSection("outside", c.outside_name || "Outside", "mdi:tree-outline", built.filter((r) => outsideSet.has(r.aid) && !used.has(r.aid)));
    }
    const rest = built.filter((r) => !used.has(r.aid) && (!c.floors || (!r.floor && want("other"))));
    if (rest.length) addSection("other", hasFloors ? "Other areas" : "Rooms", "mdi:home-outline", rest);
    if (other.length && !c.areas && want("other")) {
      const tiles = unavailableLast(other).map((id) => lightUnit(id));
      const u = { key: "room:_other", entity: null, ids: other.slice(), name: "Other lights", icon: "mdi:lightbulb-multiple-outline", kind: "room" };
      units.set(u.key, u);
      const r = { aid: "_other", unit: u, tiles, scenes: [], presets: [], floor: null };
      if (sections.length && sections[sections.length - 1].key === "other") {
        const s = sections[sections.length - 1];
        s.rooms.push(r);
        s.ids.push(...other);
      } else {
        sections.push({ key: "other", name: "Other", icon: "mdi:home-outline", rooms: [r], group: null, ids: other.slice() });
      }
    }

    const allRooms = sections.flatMap((s) => s.rooms);
    // What counts as "a light": every tile, plus room groups that have no tiles of their own
    const countIds = [];
    for (const r of allRooms) {
      if (r.unit.ids.length) countIds.push(...r.unit.ids);
      else if (r.unit.entity) countIds.push(r.unit.entity);
    }
    const allIds = [...new Set(sections.flatMap((s) => s.ids))];

    const key = JSON.stringify([
      sections.map((s) => [s.key, s.name, s.icon, s.group, s.rooms.map((r) => [
        r.aid, r.unit.name, r.unit.entity, r.unit.ids, r.unit.icon,
        r.tiles.map((t) => [t.key, t.name, t.icon, isDead(h.states[t.entity])]),
        r.scenes.map((x) => [x.id, x.name]), r.presets.length,
      ])]),
      c.title,
    ]);
    return {
      key, sections, units, countIds, allIds, roomCount: allRooms.length, rooms: allRooms,
      showSummary: c.show_summary ?? !(c.areas && c.areas.length === 1),
      singleRoom: allRooms.length === 1 && !!c.areas,
    };
  }

  /* ---------- state helpers ---------- */

  _capsOf(id) {
    const st = this._hass.states[id];
    const caps = { bri: false, ct: false, color: false, minK: 2000, maxK: 6500, effects: [] };
    if (!st || dom(id) !== "light") return caps;
    const a = st.attributes;
    const modes = a.supported_color_modes || [];
    caps.bri = modes.some((m) => m !== "onoff");
    caps.ct = modes.includes("color_temp");
    caps.color = modes.some((m) => COLOR_MODES.includes(m));
    caps.minK = num(a.min_color_temp_kelvin) ?? 2000;
    caps.maxK = num(a.max_color_temp_kelvin) ?? 6500;
    caps.effects = Array.isArray(a.effect_list) ? a.effect_list : [];
    return caps;
  }

  _caps(u) {
    const ids = this._targets(u, true);
    const out = { bri: false, ct: false, color: false, minK: Infinity, maxK: -Infinity, effects: [] };
    for (const id of ids) {
      const c = this._capsOf(id);
      out.bri ||= c.bri;
      out.color ||= c.color;
      if (c.ct) {
        out.ct = true;
        out.minK = Math.min(out.minK, c.minK);
        out.maxK = Math.max(out.maxK, c.maxK);
      }
    }
    if (!out.ct) [out.minK, out.maxK] = [2000, 6500];
    if (ids.length === 1) out.effects = this._capsOf(ids[0]).effects;
    return out;
  }

  /** Entities a unit's controls act on: its group or light, else its live members. */
  _targets(u, includeDead = false) {
    const st = this._hass.states;
    if (u.entity && (includeDead || !isDead(st[u.entity]))) return [u.entity];
    const live = u.ids.filter((id) => includeDead || !isDead(st[id]));
    return live.length || !u.entity ? live : [u.entity];
  }

  _ent(id) {
    const st = this._hass.states[id];
    if (isDead(st)) {
      delete this._pend[id];
      return { dead: true, on: false, bri: null, k: null, hs: null, rgb: null, mode: null, effect: null };
    }
    const a = st.attributes;
    const on = st.state === "on";
    const v = {
      dead: false,
      on,
      bri: on && a.brightness != null ? Math.max(1, Math.round(a.brightness / 2.55)) : null,
      k: on && a.color_mode === "color_temp" ? num(a.color_temp_kelvin) : null,
      hs: on && Array.isArray(a.hs_color) && COLOR_MODES.includes(a.color_mode) ? a.hs_color.map(Number) : null,
      rgb: on && Array.isArray(a.rgb_color) ? a.rgb_color : null,
      mode: a.color_mode || null,
      effect: on && a.effect && !["none", "off"].includes(String(a.effect).toLowerCase()) ? a.effect : null,
    };
    const p = this._pend[id];
    if (p) {
      if (Date.now() - p.t > PENDING_TIMEOUT || this._matches(v, p)) {
        delete this._pend[id];
      } else {
        v.on = p.on;
        if (!p.on) Object.assign(v, { bri: null, k: null, hs: null, rgb: null, effect: null });
        if (p.bri != null) v.bri = p.bri;
        if (p.k != null) Object.assign(v, { k: p.k, hs: null, rgb: kelvinToRgb(p.k), mode: "color_temp" });
        if (p.hs) Object.assign(v, { hs: p.hs, k: null, rgb: hsToRgb(p.hs[0], p.hs[1]), mode: "hs" });
      }
    }
    return v;
  }

  _matches(v, p) {
    if (v.on !== p.on) return false;
    if (!p.on) return true;
    if (p.bri != null && v.bri != null && Math.abs(v.bri - p.bri) > 2) return false;
    if (p.k != null && (v.k == null || Math.abs(v.k - p.k) > Math.max(60, p.k * 0.03))) return false;
    if (p.hs) {
      if (!v.hs) return false;
      const dh = Math.abs(v.hs[0] - p.hs[0]) % 360;
      if (Math.min(dh, 360 - dh) > 8 || Math.abs(v.hs[1] - p.hs[1]) > 8) return false;
    }
    return true;
  }

  /** Display state of a tile, room or floor control. */
  _val(u) {
    const members = u.ids.map((id) => this._ent(id));
    const live = members.filter((m) => !m.dead);
    const lit = live.filter((m) => m.on);
    let v;
    if (u.entity && !(isDead(this._hass.states[u.entity]) && live.length)) {
      v = { ...this._ent(u.entity) };
    } else {
      const avg = lit.filter((m) => m.bri != null);
      v = {
        dead: !live.length,
        on: lit.length > 0,
        bri: avg.length ? Math.round(avg.reduce((s, m) => s + m.bri, 0) / avg.length) : null,
        k: lit.length === 1 ? lit[0].k : null,
        hs: lit.length === 1 ? lit[0].hs : null,
        rgb: lit.find((m) => m.rgb)?.rgb || null,
        mode: lit[0]?.mode || null,
        effect: null,
      };
    }
    v.n = live.length;
    v.nOn = lit.length;
    return v;
  }

  _color(v) {
    if (!v.on) return "var(--secondary-text-color)";
    if (v.rgb) {
      // Keep near-white colours readable on a dark card by leaning them warm
      const [r, g, b] = v.rgb;
      return Math.min(r, g, b) > 225 ? "rgb(255, 236, 200)" : rgbCss(v.rgb);
    }
    return AMBER;
  }

  _icon(u, on) {
    if (u.icon) return u.icon;
    if (u.kind === "room") return on ? "mdi:lightbulb-group" : "mdi:lightbulb-group-outline";
    if (u.kind === "group") return on ? "mdi:lightbulb-group" : "mdi:lightbulb-group-outline";
    if (u.kind === "switch") return on ? "mdi:power-socket-uk" : "mdi:power-socket-uk";
    return on ? "mdi:lightbulb" : "mdi:lightbulb-outline";
  }

  _lightText(v) {
    if (v.dead) return "Unavailable";
    if (!v.on) return "Off";
    const parts = [];
    if (v.bri != null) parts.push(`${v.bri} %`);
    if (v.effect) parts.push(v.effect);
    else if (v.k != null) parts.push(`${Math.round(v.k / 50) * 50} K`);
    else if (v.hs && v.hs[1] > 12) parts.push(hueName(v.hs[0]));
    return parts.length ? parts.join(" · ") : "On";
  }

  _subText(u, v) {
    if (u.lightName) {
      const t = this._lightText(v);
      return u.lightName.toLowerCase() === u.name.toLowerCase() ? t : `${u.lightName} · ${t}`;
    }
    if (v.dead) return "Unavailable";
    // With two or more working lights, count them; otherwise describe the group or light itself
    let s;
    if (v.n >= 2) {
      s = v.nOn === 0 ? "All off" : v.nOn === v.n ? "All on" : `${v.nOn} of ${v.n} on`;
      if (v.on && v.bri != null) s += ` · ${v.bri} %`;
    } else {
      s = this._lightText(v);
    }
    const dead = u.ids.length - v.n;
    if (dead) s += ` · ${dead} unavailable`;
    return s;
  }

  /* ---------- rendering ---------- */

  _update() {
    if (!this._hass || !this._config || !this.shadowRoot) return;
    const m = this._buildModel();
    this._model = m;
    if (m.key !== this._key) {
      this._key = m.key;
      this._render();
    }
    this._paint();
    this._maybeFetch();
  }

  _tileHtml(u, big) {
    return `
      <div class="tile${big ? " big" : ""}" data-key="${esc(u.key)}" tabindex="0" role="button" aria-label="${esc(u.name)}">
        <div class="fill"></div>
        <button class="badge" data-act="toggle" aria-label="Turn ${esc(u.name)} on or off"><ha-icon></ha-icon></button>
        <span class="warn" title="Unavailable"><ha-icon icon="mdi:exclamation-thick"></ha-icon></span>
        <div class="text"><div class="tname">${esc(u.name)}</div><div class="tsub"></div></div>
        ${big ? `<ha-icon class="chev" icon="mdi:tune-variant"></ha-icon>` : ""}
      </div>`;
  }

  _roomHtml(r) {
    const c = this._config;
    const chips = this._chips(r);
    return `
      <div class="room">
        ${this._tileHtml(r.unit, true)}
        ${c.history ? `<div class="hrow"><div class="strip" data-strip="${esc(r.unit.key)}"></div><span class="htot" data-tot="${esc(r.unit.key)}"></span></div>` : ""}
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        ${r.tiles.length ? `<div class="tiles">${r.tiles.map((t) => this._tileHtml(t)).join("")}</div>` : ""}
      </div>`;
  }

  /** Scenes first (they're the room's own), then the quick presets. */
  _chips(r) {
    return [
      ...r.scenes.map((s) => `<button class="chip scene" data-act="scene" data-id="${esc(s.id)}"><ha-icon icon="${esc(s.icon || "mdi:palette-outline")}"></ha-icon>${esc(s.name)}</button>`),
      ...r.presets.map((p, i) => `<button class="chip" data-act="preset" data-room="${esc(r.aid)}" data-i="${i}"><ha-icon icon="${esc(p.icon || "mdi:lightbulb-on-outline")}"></ha-icon>${esc(p.name)}</button>`),
    ];
  }

  _render() {
    const m = this._model;
    const c = this._config;
    const sections = m.sections
      .map((s) => `
        <section class="sec">
          <div class="sec-head" data-sec="${esc(s.key)}"${m.singleRoom ? " hidden" : ""}>
            <ha-icon icon="${esc(s.icon)}"></ha-icon>
            <span class="sec-name">${esc(s.name)}</span>
            <span class="sec-sub"></span>
            ${s.group ? `<button class="ib" data-act="sheet" data-for="floor:${esc(s.key)}" title="${esc(s.name)} lights"><ha-icon icon="mdi:tune-variant"></ha-icon></button>` : ""}
            <button class="sec-off" data-act="secoff" data-sec="${esc(s.key)}" hidden>Off</button>
          </div>
          <div class="rooms">${s.rooms.map((r) => this._roomHtml(r)).join("")}</div>
        </section>`)
      .join("");
    const keepSheet = this._sheetKey;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        ${c.title ? `<div class="title">${esc(c.title)}</div>` : ""}
        ${m.showSummary ? `
          <div class="summary">
            <div class="disc"><ha-icon icon="mdi:lightbulb-group"></ha-icon></div>
            <div class="s-text"><div class="s-main"></div><div class="s-sub"></div></div>
            <button class="pill" data-act="alloff"><ha-icon icon="mdi:power"></ha-icon>All off</button>
          </div>` : ""}
        ${sections || `<div class="s-sub">No lights found.</div>`}
      </ha-card>
      <dialog class="sheet" aria-label="Light controls"></dialog>`;
    this._sheetKey = null;
    if (keepSheet && m.units.has(keepSheet)) this._openSheet(keepSheet);
  }

  _setText(el, s) {
    if (el && el.textContent !== s) el.textContent = s;
  }

  _paint() {
    const m = this._model;
    const sr = this.shadowRoot;
    if (!m || !sr) return;
    for (const el of sr.querySelectorAll(".tile[data-key], .sh-head[data-key]")) this._paintTile(el);

    // Summary
    const sum = sr.querySelector(".summary");
    if (sum) {
      const dead = m.countIds.filter((id) => this._ent(id).dead).length;
      const on = m.rooms.reduce((n, r) => n + this._litCount(r.unit), 0);
      const roomsLit = m.rooms.filter((r) => this._val(r.unit).on).length;
      sum.classList.toggle("lit", on > 0);
      this._setText(
        sum.querySelector(".s-main"),
        on ? `${on} light${on === 1 ? "" : "s"} on${roomsLit ? ` in ${roomsLit} room${roomsLit === 1 ? "" : "s"}` : ""}` : "All lights off",
      );
      const sub = `${m.countIds.length} lights${dead ? ` · <span class="bad">${dead} unavailable</span>` : ""}`;
      const subEl = sum.querySelector(".s-sub");
      if (subEl.innerHTML !== sub) subEl.innerHTML = sub;
      sum.querySelector("[data-act=alloff]").disabled = !this._onIds(m.allIds).length;
    }

    // Floor headers
    for (const head of sr.querySelectorAll(".sec-head")) {
      const s = m.sections.find((x) => x.key === head.dataset.sec);
      if (!s) continue;
      const on = s.rooms.reduce((n, r) => n + this._litCount(r.unit), 0);
      let html = on ? `${on} on` : "";
      if (s.key === "outside") {
        const sun = this._sun();
        if (sun) html += `${html ? " · " : ""}<ha-icon icon="${sun.icon}"></ha-icon>${esc(sun.text)}`;
      }
      const sub = head.querySelector(".sec-sub");
      if (sub.innerHTML !== html) sub.innerHTML = html;
      head.querySelector(".sec-off").hidden = !this._onIds(s.ids).length;
    }

    // Preset chips: highlight the one the room is already showing
    for (const chip of sr.querySelectorAll("[data-act=preset]")) {
      const r = m.rooms.find((x) => x.aid === chip.dataset.room);
      const p = r?.presets[Number(chip.dataset.i)];
      chip.classList.toggle("active", !!p && this._presetActive(r, p));
    }

    this._paintHistory();
    if (this._sheetKey) this._paintSheet();
  }

  _paintTile(el) {
    const u = this._model.units.get(el.dataset.key);
    if (!u) return;
    const v = this._val(u);
    el.classList.toggle("on", v.on && !v.dead);
    el.classList.toggle("dead", v.dead);
    el.style.setProperty("--c", this._color(v));
    if (el.classList.contains("tile")) {
      const caps = v.on ? this._caps(u) : null;
      el.style.setProperty("--b", v.on ? `${caps?.bri ? v.bri ?? 100 : 100}%` : "0%");
    }
    const icon = el.querySelector(".badge ha-icon");
    const want = this._icon(u, v.on);
    if (icon && icon.getAttribute("icon") !== want) icon.setAttribute("icon", want);
    this._setText(el.querySelector(".tsub, .sh-sub"), this._subText(u, v));
  }

  _sun() {
    const s = this._hass.states["sun.sun"];
    if (!s) return null;
    const set = Date.parse(s.attributes.next_setting);
    const rise = Date.parse(s.attributes.next_rising);
    if (!Number.isFinite(set) && !Number.isFinite(rise)) return null;
    const isSet = Number.isFinite(set) && (!Number.isFinite(rise) || set < rise);
    return {
      icon: isSet ? "mdi:weather-sunset-down" : "mdi:weather-sunset-up",
      text: `${isSet ? "Sunset" : "Sunrise"} ${this._time(isSet ? set : rise)}`,
    };
  }

  _time(t) {
    const lang = this._hass?.locale?.language || undefined;
    return new Date(t).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  }

  /** Lights on in a room: its working lights, or 1 for a group whose bulbs aren't in HA (or are all unavailable). */
  _litCount(u) {
    const v = this._val(u);
    return v.n ? v.nOn : v.on ? 1 : 0;
  }

  _onIds(ids) {
    return ids.filter((id) => this._ent(id).on);
  }

  _presetTargets(r) {
    const live = r.unit.ids.filter((id) => !isDead(this._hass.states[id]));
    return live.length ? live : this._targets(r.unit);
  }

  _presetActive(r, p) {
    const ids = this._presetTargets(r);
    if (!ids.length) return false;
    return ids.every((id) => {
      const v = this._ent(id);
      if (!v.on) return false;
      const c = this._capsOf(id);
      if (c.bri && p.brightness != null && v.bri != null && Math.abs(v.bri - p.brightness) > 3) return false;
      if (c.ct && p.kelvin != null) {
        const k = clamp(p.kelvin, c.minK, c.maxK);
        if (v.k == null || Math.abs(v.k - k) > Math.max(80, k * 0.04)) return false;
      }
      return true;
    });
  }

  /* ---------- control sheet ---------- */

  _openSheet(key) {
    const u = this._model.units.get(key);
    const dlg = this.shadowRoot.querySelector("dialog");
    if (!u || !dlg) return;
    if (this._val(u).dead) {
      this._moreInfo(u.entity || u.ids[0]);
      return;
    }
    this._sheetKey = key;
    this._buildSheet();
    if (!dlg.open) dlg.showModal();
    this._paintSheet();
    this._paintHistory();
  }

  _closeSheet() {
    const dlg = this.shadowRoot.querySelector("dialog");
    if (dlg?.open) dlg.close();
    this._sheetKey = null;
  }

  _sheetCapsKey(u) {
    const c = this._caps(u);
    return JSON.stringify([u.key, c.bri, c.ct, c.color, c.minK, c.maxK, c.effects]);
  }

  _buildSheet() {
    const u = this._model.units.get(this._sheetKey);
    const dlg = this.shadowRoot.querySelector("dialog");
    const caps = this._caps(u);
    this._sheetCaps = this._sheetCapsKey(u);
    const c = this._config;
    const room = this._model.rooms.find((r) => r.unit.key === u.key);
    const members = room ? room.tiles : [];
    const grad = [0, 0.25, 0.5, 0.75, 1].map((f) => `${rgbCss(kelvinToRgb(caps.minK + f * (caps.maxK - caps.minK)))} ${f * 100}%`).join(", ");
    const today = !c.history_hours;
    const hours = today ? ["00", "06", "12", "18", "24"] : [`−${c.history_hours} h`, "", "", "", "now"];
    dlg.innerHTML = `
      <div class="sh-head" data-key="${esc(u.key)}">
        <button class="badge" data-act="toggle" aria-label="Turn on or off"><ha-icon></ha-icon></button>
        <div class="text"><div class="sh-name">${esc(u.lightName && !u.ids.length ? u.lightName : u.name)}</div><div class="sh-sub"></div></div>
        <button class="ib" data-act="moreinfo" title="More info"><ha-icon icon="mdi:information-outline"></ha-icon></button>
        <button class="ib" data-act="close" title="Close"><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
      ${caps.bri ? `
        <div class="sh-label">Brightness</div>
        <div class="sl bri" data-sl="bri" role="slider" tabindex="0" aria-label="Brightness" aria-valuemin="1" aria-valuemax="100">
          <div class="sl-fill"></div><div class="sl-thumb"></div><span class="sl-label"></span>
        </div>` : ""}
      ${caps.ct ? `
        <div class="sh-label">White <span class="ct-range">${caps.minK}–${caps.maxK} K</span></div>
        <div class="sl ct" data-sl="ct" role="slider" tabindex="0" aria-label="Colour temperature" aria-valuemin="${caps.minK}" aria-valuemax="${caps.maxK}" style="--grad: linear-gradient(to right, ${grad})">
          <div class="sl-thumb"></div><span class="sl-label"></span>
        </div>` : ""}
      ${caps.color ? `
        <div class="sh-label">Colour</div>
        <div class="colour">
          <div class="wheel" role="slider" tabindex="0" aria-label="Colour"><div class="dot"></div></div>
          <div class="swatches">${SWATCHES.map(([hh, ss]) => `<button class="swatch" data-act="hs" data-h="${hh}" data-s="${ss}" style="--s: ${rgbCss(hsToRgb(hh, ss))}" aria-label="${hueName(hh)}"></button>`).join("")}</div>
        </div>` : ""}
      ${caps.effects.length ? `
        <div class="sh-label">Effects</div>
        <div class="chips wrap">${caps.effects.map((e) => `<button class="chip fx" data-act="effect" data-fx="${esc(e)}">${esc(e)}</button>`).join("")}</div>` : ""}
      ${room && (room.presets.length || room.scenes.length) ? `
        <div class="sh-label">${room.scenes.length ? "Scenes and presets" : "Presets"}</div>
        <div class="chips wrap">${this._chips(room).join("")}</div>` : ""}
      ${c.history ? `
        <div class="sh-label">${today ? "Today" : `Last ${c.history_hours} h`} <span data-tot="${esc(u.key)}"></span></div>
        <div class="hrow"><div class="strip" data-strip="${esc(u.key)}"></div></div>
        <div class="hours">${hours.map((x) => `<span>${x}</span>`).join("")}</div>` : ""}
      ${members.length ? `
        <div class="sh-label">Lights</div>
        <div class="tiles">${members.map((t) => this._tileHtml(t)).join("")}</div>` : ""}
    `;
  }

  _paintSheet() {
    const dlg = this.shadowRoot.querySelector("dialog");
    const u = this._model.units.get(this._sheetKey);
    if (!dlg?.open || !u) {
      if (dlg?.open) this._closeSheet();
      return;
    }
    if (this._sheetCapsKey(u) !== this._sheetCaps) {
      this._buildSheet();
      this._paintHistory();
    }
    for (const el of dlg.querySelectorAll(".tile[data-key], .sh-head[data-key]")) this._paintTile(el);
    const v = this._val(u);
    const caps = this._caps(u);
    dlg.style.setProperty("--c", this._color(v));

    const bri = dlg.querySelector("[data-sl=bri]");
    if (bri) {
      const b = v.on ? v.bri ?? 100 : 0;
      bri.style.setProperty("--f", String(clamp((b - 1) / 99, 0, 1)));
      bri.classList.toggle("low", v.on && b < 25);
      bri.classList.toggle("idle", !v.on);
      bri.setAttribute("aria-valuenow", String(b));
      this._setText(bri.querySelector(".sl-label"), v.on ? `${b} %` : "Off");
    }
    const ct = dlg.querySelector("[data-sl=ct]");
    if (ct) {
      const active = v.on && v.k != null;
      const k = active ? v.k : (caps.minK + caps.maxK) / 2;
      const f = clamp((k - caps.minK) / (caps.maxK - caps.minK || 1), 0, 1);
      ct.style.setProperty("--f", String(f));
      ct.classList.toggle("low", active && f < 0.25);
      ct.classList.toggle("idle", !active);
      if (active) ct.setAttribute("aria-valuenow", String(Math.round(k)));
      this._setText(ct.querySelector(".sl-label"), active ? `${Math.round(k / 50) * 50} K` : v.on ? "Using colour" : "Off");
    }
    const wheel = dlg.querySelector(".wheel");
    if (wheel) {
      const has = v.on && !!v.hs;
      wheel.classList.toggle("has", has);
      if (has) {
        const [hh, ss] = v.hs;
        const a = (hh * Math.PI) / 180;
        const r = clamp(ss, 0, 100) / 2;
        wheel.style.setProperty("--x", `${50 + Math.cos(a) * r}%`);
        wheel.style.setProperty("--y", `${50 + Math.sin(a) * r}%`);
        wheel.style.setProperty("--dc", rgbCss(hsToRgb(hh, ss)));
      }
    }
    for (const fx of dlg.querySelectorAll(".fx")) fx.classList.toggle("active", v.effect === fx.dataset.fx);
    for (const chip of dlg.querySelectorAll("[data-act=preset]")) {
      const r = this._model.rooms.find((x) => x.aid === chip.dataset.room);
      const p = r?.presets[Number(chip.dataset.i)];
      chip.classList.toggle("active", !!p && this._presetActive(r, p));
    }
  }

  /* ---------- actions ---------- */

  /** Service data for one entity, trimmed to what it supports. */
  _call(id, p) {
    const st = this._hass.states[id];
    if (!st || isDead(st)) return null;
    const off = p.on === false || p.bri === 0;
    if (dom(id) !== "light") {
      return { domain: "homeassistant", service: off ? "turn_off" : "turn_on", data: {}, pend: { on: !off } };
    }
    if (off) return { domain: "light", service: "turn_off", data: {}, pend: { on: false } };
    const c = this._capsOf(id);
    const data = {};
    const pend = { on: true };
    if (p.bri != null && c.bri) data.brightness_pct = pend.bri = clamp(Math.round(p.bri), 1, 100);
    if (p.k != null && (c.ct || c.color)) data.color_temp_kelvin = pend.k = c.ct ? clamp(Math.round(p.k), c.minK, c.maxK) : Math.round(p.k);
    if (p.hs && c.color) data.hs_color = pend.hs = [Math.round(p.hs[0]) % 360, clamp(Math.round(p.hs[1]), 0, 100)];
    if (p.effect && c.effects.includes(p.effect)) data.effect = p.effect;
    return { domain: "light", service: "turn_on", data, pend };
  }

  /** Shows the change at once, and sends it now (final) or at most every THROTTLE ms. */
  _control(ids, p, tag, final = true) {
    const now = Date.now();
    const calls = ids.map((id) => [id, this._call(id, p)]).filter(([, x]) => x);
    for (const [id, x] of calls) this._pend[id] = { ...x.pend, t: now };
    this._paint();
    const send = () => {
      const groups = new Map();
      for (const [id, x] of calls) {
        const k = `${x.domain}|${x.service}|${JSON.stringify(x.data)}`;
        if (!groups.has(k)) groups.set(k, { ...x, ids: [] });
        groups.get(k).ids.push(id);
      }
      for (const g of groups.values()) {
        Promise.resolve(this._hass.callService(g.domain, g.service, { entity_id: g.ids.length === 1 ? g.ids[0] : g.ids, ...g.data })).catch((err) => {
          console.warn("lighting-card: service call failed", err);
          g.ids.forEach((id) => delete this._pend[id]);
          this._paint();
        });
      }
    };
    const t = (this._thr[tag] ||= { last: 0, timer: null, sent: null });
    const sig = JSON.stringify(calls.map(([id, x]) => [id, x.service, x.data]));
    const fire = () => {
      t.last = Date.now();
      t.sent = sig;
      send();
    };
    clearTimeout(t.timer);
    // The release of a drag often repeats the value just sent
    if (final && t.sent === sig && now - t.last < 1000) return;
    const wait = THROTTLE - (now - t.last);
    if (final || wait <= 0) fire();
    else t.timer = setTimeout(fire, wait);
  }

  _toggle(u) {
    const v = this._val(u);
    if (v.dead) return;
    this._control(this._targets(u), { on: !v.on }, u.key);
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _listen() {
    const sr = this.shadowRoot;
    sr.addEventListener("click", (ev) => this._onClick(ev));
    sr.addEventListener("pointerdown", (ev) => this._onDown(ev));
    sr.addEventListener("pointermove", (ev) => this._onMove(ev));
    sr.addEventListener("pointerup", (ev) => this._onUp(ev));
    sr.addEventListener("pointercancel", (ev) => this._onUp(ev, true));
    sr.addEventListener("keydown", (ev) => this._onKey(ev));
    sr.addEventListener("close", (ev) => {
      if (ev.target.tagName === "DIALOG") this._sheetKey = null;
    }, true);
  }

  _onClick(ev) {
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    const dlg = ev.target.tagName === "DIALOG" ? ev.target : null;
    if (dlg) {
      // Clicks on the backdrop land on the dialog itself, outside its box
      const r = dlg.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) this._closeSheet();
      return;
    }
    const btn = ev.target.closest("[data-act]");
    const holder = ev.target.closest("[data-key]");
    const u = holder ? this._model.units.get(holder.dataset.key) : null;
    const act = btn?.dataset.act;
    const m = this._model;
    if (act === "toggle" && u) return this._toggle(u);
    if (act === "alloff") return this._control(this._onIds(m.allIds), { on: false }, "alloff");
    if (act === "secoff") {
      const s = m.sections.find((x) => x.key === btn.dataset.sec);
      if (s) this._control(this._onIds(s.ids), { on: false }, `sec:${s.key}`);
      return;
    }
    if (act === "sheet") return this._openSheet(btn.dataset.for);
    if (act === "close") return this._closeSheet();
    if (act === "moreinfo") {
      const su = m.units.get(this._sheetKey);
      this._closeSheet();
      return this._moreInfo(su?.entity || su?.ids[0]);
    }
    if (act === "scene") {
      this._hass.callService("scene", "turn_on", { entity_id: btn.dataset.id });
      btn.classList.add("active");
      setTimeout(() => btn.classList.remove("active"), 1200);
      return;
    }
    if (act === "preset") {
      const r = m.rooms.find((x) => x.aid === btn.dataset.room);
      const p = r?.presets[Number(btn.dataset.i)];
      if (p) this._control(this._presetTargets(r), { bri: p.brightness, k: p.kelvin, hs: p.hs_color || null }, `preset:${r.aid}`);
      return;
    }
    const su = this._model.units.get(this._sheetKey);
    if (act === "hs" && su) return this._control(this._targets(su), { hs: [Number(btn.dataset.h), Number(btn.dataset.s)] }, su.key);
    if (act === "effect" && su) return this._control(this._targets(su), { effect: btn.dataset.fx }, su.key);
    if (!btn && u && holder.classList.contains("tile")) this._openSheet(u.key);
  }

  _onKey(ev) {
    const tile = ev.target.classList?.contains("tile") ? ev.target : null;
    if (tile) {
      const u = this._model.units.get(tile.dataset.key);
      if (!u) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        this._openSheet(u.key);
      } else if (ev.key === " ") {
        ev.preventDefault();
        this._toggle(u);
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        const v = this._val(u);
        if (v.dead || !this._caps(u).bri) return;
        ev.preventDefault();
        const b = clamp((v.on ? v.bri ?? 100 : 0) + (ev.key === "ArrowRight" ? 10 : -10), 0, 100);
        this._control(this._targets(u), { bri: b }, u.key);
      }
      return;
    }
    const sl = ev.target.closest?.("[data-sl]");
    if (sl && (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      const u = this._model.units.get(this._sheetKey);
      if (!u) return;
      const v = this._val(u);
      const up = ev.key === "ArrowRight" || ev.key === "ArrowUp";
      if (sl.dataset.sl === "bri") {
        this._control(this._targets(u), { bri: clamp((v.on ? v.bri ?? 100 : 0) + (up ? 5 : -5), 1, 100) }, u.key);
      } else {
        const caps = this._caps(u);
        const k = v.k ?? (caps.minK + caps.maxK) / 2;
        this._control(this._targets(u), { k: clamp(k + (up ? 100 : -100), caps.minK, caps.maxK) }, u.key);
      }
    }
  }

  _onDown(ev) {
    if (ev.button > 0) return;
    const sl = ev.target.closest("[data-sl], .wheel");
    if (sl) {
      const u = this._model.units.get(this._sheetKey);
      if (!u) return;
      sl.setPointerCapture(ev.pointerId);
      this._drag = { kind: sl.dataset.sl || "wheel", el: sl, u, id: ev.pointerId, mode: "slide" };
      this._slide(ev, false);
      ev.preventDefault();
      return;
    }
    const tile = ev.target.closest(".tile");
    if (!tile) return;
    const u = this._model.units.get(tile.dataset.key);
    if (!u) return;
    const v = this._val(u);
    this._drag = {
      kind: "tile", el: tile, u, id: ev.pointerId, mode: null, x0: ev.clientX, y0: ev.clientY,
      start: v.on ? v.bri ?? 100 : 0, w: tile.getBoundingClientRect().width || 1,
      dimmable: !v.dead && this._caps(u).bri,
    };
  }

  _onMove(ev) {
    const d = this._drag;
    if (!d || ev.pointerId !== d.id) return;
    if (d.mode === "slide") {
      this._slide(ev, false);
      return;
    }
    const dx = ev.clientX - d.x0;
    const dy = ev.clientY - d.y0;
    if (!d.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) && d.dimmable) {
        d.mode = "drag";
        d.el.setPointerCapture(d.id);
        d.el.classList.add("dragging");
      } else if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        d.mode = "cancel";
      }
    }
    if (d.mode === "drag") {
      ev.preventDefault();
      d.val = clamp(Math.round(d.start + (dx / d.w) * 100), 0, 100);
      this._control(this._targets(d.u), { bri: d.val }, d.u.key, false);
    }
  }

  _onUp(ev, cancelled = false) {
    const d = this._drag;
    if (!d || ev.pointerId !== d.id) return;
    this._drag = null;
    if (d.mode === "slide") {
      if (!cancelled) this._slide(ev, true);
      else if (d.last) this._control(this._targets(d.u), d.last, d.u.key, true);
      this._suppressClick = true;
      setTimeout(() => (this._suppressClick = false), 0);
      return;
    }
    if (d.mode === "drag") {
      d.el.classList.remove("dragging");
      if (d.val != null) this._control(this._targets(d.u), { bri: d.val }, d.u.key, true);
      this._suppressClick = true;
      setTimeout(() => (this._suppressClick = false), 0);
    }
  }

  _slide(ev, final) {
    const d = this._drag || { final: true };
    const el = d.el || ev.target.closest("[data-sl], .wheel");
    const u = d.u || this._model.units.get(this._sheetKey);
    if (!el || !u) return;
    const r = el.getBoundingClientRect();
    let p;
    if (d.kind === "wheel" || el.classList.contains("wheel")) {
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const sat = clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1) * 100;
      p = { hs: [hue, sat] };
    } else {
      const f = clamp((ev.clientX - r.left - 8) / (r.width - 16), 0, 1);
      if (el.dataset.sl === "bri") {
        p = { bri: Math.max(1, Math.round(f * 100)) };
      } else {
        const caps = this._caps(u);
        p = { k: Math.round((caps.minK + f * (caps.maxK - caps.minK)) / 50) * 50 };
      }
    }
    if (this._drag) this._drag.last = p;
    else d.last = p;
    this._control(this._targets(u), p, u.key, final);
  }

  /* ---------- on-time history ---------- */

  _range() {
    const hrs = num(this._config.history_hours);
    const now = Date.now();
    if (hrs) return { start: now - hrs * HOUR, end: now, today: false };
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { start: d.getTime(), end: d.getTime() + 24 * HOUR, today: true };
  }

  _maybeFetch() {
    if (!this._config?.history || !this._hass || !this._model || this._loading) return;
    const { start } = this._range();
    const ids = this._model.allIds.join(",");
    const stale = Date.now() - this._fetchedAt > REFRESH_MS;
    const changed = !this._hist || this._hist.ids !== ids || (this._range().today && this._hist.start !== start);
    if (stale || changed) this._fetch();
  }

  async _fetch() {
    const h = this._hass;
    const ids = this._model.allIds;
    const fid = ++this._fetchId;
    const { start } = this._range();
    const now = Date.now();
    this._loading = true;
    this._fetchedAt = now;
    try {
      const res = ids.length
        ? await h.callWS({
            type: "history/history_during_period",
            start_time: new Date(start).toISOString(),
            end_time: new Date(now).toISOString(),
            entity_ids: ids,
            minimal_response: true,
            no_attributes: true,
            significant_changes_only: false,
          })
        : {};
      if (fid !== this._fetchId) return;
      const runs = {};
      for (const id of ids) runs[id] = this._runs(res?.[id], start);
      this._hist = { ids: ids.join(","), start, fetched: now, runs };
    } catch (err) {
      console.warn("lighting-card: could not load history", err);
    } finally {
      if (fid === this._fetchId) {
        this._loading = false;
        this._paintHistory();
      }
    }
  }

  /** On periods from a history list (compressed {s, lu} or full format); end null = still on. */
  _runs(raw, start) {
    const out = [];
    let open = null;
    const pts = (raw || [])
      .map((e) => ({ t: e.lu != null ? e.lu * 1000 : Date.parse(e.last_updated || e.last_changed), s: e.s ?? e.state }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t);
    for (const { t, s } of pts) {
      const tt = Math.max(t, start);
      if (s === "on" && open == null) open = tt;
      else if (s !== "on" && open != null) {
        out.push([open, tt]);
        open = null;
      }
    }
    if (open != null) out.push([open, null]);
    return out;
  }

  /** Fetched runs, brought up to date with any state change since the fetch. */
  _liveRuns(id) {
    const hist = this._hist;
    const runs = (hist?.runs[id] || []).map((r) => [...r]);
    const st = this._hass.states[id];
    if (!st || !hist) return runs;
    const lc = Date.parse(st.last_changed);
    const last = runs[runs.length - 1];
    const isOpen = last && last[1] == null;
    if (lc > hist.fetched) {
      if (st.state === "on" && !isOpen) runs.push([Math.max(lc, hist.start), null]);
      if (st.state !== "on" && isOpen) last[1] = lc;
    }
    return runs;
  }

  _paintHistory() {
    const sr = this.shadowRoot;
    if (!sr || !this._model || !this._config.history) return;
    const { start, end, today } = this._range();
    const now = Date.now();
    const span = end - start;
    const cache = new Map();
    const runsFor = (key) => {
      if (cache.has(key)) return cache.get(key);
      const u = this._model.units.get(key);
      if (!u || !this._hist) return null;
      // A group is on whenever any member is, so the union also covers bulbs HA can't see
      const ids = [...new Set([...u.ids, ...(u.entity ? [u.entity] : [])])];
      const merged = mergeRuns(ids.flatMap((id) => this._liveRuns(id)), now);
      const total = merged.reduce((s, [a, b]) => s + (b - a), 0);
      const out = { merged, total };
      cache.set(key, out);
      return out;
    };
    for (const el of sr.querySelectorAll("[data-strip]")) {
      const d = runsFor(el.dataset.strip);
      if (!d) continue;
      const segs = d.merged
        .map(([a, b]) => `<i style="left:${(((a - start) / span) * 100).toFixed(2)}%;width:${(((b - a) / span) * 100).toFixed(2)}%"></i>`)
        .join("");
      const html = segs + (today ? `<b style="left:${(((now - start) / span) * 100).toFixed(2)}%"></b>` : "");
      if (el.innerHTML !== html) el.innerHTML = html;
      el.title = d.merged.length
        ? d.merged.map(([a, b]) => `${this._time(a)}–${b >= now - MIN ? "now" : this._time(b)}`).join(", ")
        : "Not on";
    }
    for (const el of sr.querySelectorAll("[data-tot]")) {
      const d = runsFor(el.dataset.tot);
      if (!d) continue;
      const s = d.total ? fmtDur(d.total) : "0 m";
      this._setText(el, s);
      el.title = `On for ${s} ${today ? "today" : `in the last ${this._config.history_hours} h`}`;
    }
  }
}

if (!customElements.get("lighting-card")) customElements.define("lighting-card", LightingCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "lighting-card",
  name: "Lighting",
  description: "Every light by floor and room: colour and brightness tiles, drag to dim, colour and white controls, presets, scenes and today's on-time.",
  preview: false,
});
