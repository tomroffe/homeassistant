/**
 * waste-collection-card  (v3)
 * Same look as appliance-dial-card and heating-dial-card.
 *
 * - Top: the next collection day ("Tomorrow", "Thursday 5 November") with every
 *   bin going out that day, a countdown, and a "Put out tonight" reminder.
 * - Below: each other bin with its next date and how many days away.
 *
 * Finds Waste Collection Schedule (and UK Bin Collection Data) sensors by itself.
 * Dates are read from the sensor state ("on Thu, 05.11.2026", "2026-11-05",
 * "Tomorrow", "in 8 days") or from attributes (daysTo, days, next_collection).
 * Or use `calendar: calendar.<waste calendar>` to read collections from a calendar.
 *
 * Config (all optional):
 *   entities:            # list of sensors, or objects with name / icon / color
 *     - sensor.food_waste
 *     - entity: sensor.glass
 *       color: "#42a5f5"
 *   calendar: calendar.waste_collection_schedule
 *   days: 45             # how far ahead to read the calendar
 *   types:               # colour / icon by name, for calendar events or overrides
 *     Glass: { color: "#42a5f5", icon: mdi:bottle-wine }
 *   reminder_text: Put out tonight
 *
 * Install: copy to /config/www/waste-collection-card.js and add the resource
 * /local/waste-collection-card.js?v=3 (type: JavaScript module).
 */

const WASTE_PLATFORMS = ["waste_collection_schedule", "uk_bin_collection"];
const DAY = 86400000;
const CAL_REFRESH_MS = 60 * 60 * 1000;

// Checked in order: "non-recyclable" must win over "recycl"
const WASTE_TYPES = [
  [/non.?recycl|rubbish|general|refuse|landfill|residual|black bin/i, "#9aa0a6", "mdi:trash-can"],
  [/food|caddy|kitchen/i, "#5cb85c", "mdi:food-apple"],
  [/garden|green waste|compost|organic|bio/i, "#b08968", "mdi:flower"],
  [/glass|bottle/i, "#42a5f5", "mdi:bottle-wine"],
  [/paper|card/i, "#7e8cf0", "mdi:package-variant-closed"],
  [/plastic|tin|can|metal|packag/i, "#ffb300", "mdi:bottle-soda-classic"],
  [/recycl|mixed/i, "#26a69a", "mdi:recycle"],
];

const WASTE_STYLE = `
  ha-card { padding: 14px 16px 16px; container-type: inline-size; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  /* Next collection */
  /* Narrow: pill under the title. Wide: title | pill | countdown on one row. */
  .hero {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: start;
    grid-template-areas: "title count" "pill pill" "bins bins";
    padding: 14px 16px 16px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  @container (min-width: 380px) {
    .hero { grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto; grid-template-areas: "title pill count" "bins bins bins"; }
    .hero .pill { justify-self: center; align-self: center; margin-top: 0; }
  }
  .hero.soon { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .title { grid-area: title; min-width: 0; }
  .when { font-size: 24px; font-weight: 400; line-height: 1.15; }
  .date { font-size: 14px; color: var(--secondary-text-color); margin-top: 2px; }
  .count { grid-area: count; text-align: center; line-height: 1; }
  .count .n { font-size: 34px; font-weight: 400; font-variant-numeric: tabular-nums; }
  .count .u { display: block; font-size: 12px; color: var(--secondary-text-color); margin-top: 3px; }
  .pill {
    grid-area: pill; justify-self: start; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    margin-top: 8px; padding: 4px 10px 4px 8px; border-radius: 999px; font-size: 13px; font-weight: 500;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .pill { max-width: 100%; box-sizing: border-box; }
  .pill span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .pill ha-icon { --mdc-icon-size: 16px; flex: none; }
  /* One centred row that never wraps: bins shrink from 76 px, discs from 48 px */
  .bins { grid-area: bins; display: flex; flex-wrap: nowrap; justify-content: center; gap: 6px; margin-top: 14px; min-width: 0; }
  .bin { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 0 1 76px; min-width: 0; }
  .bin .disc { width: min(48px, 100%); height: auto; aspect-ratio: 1; }
  .bin .disc ha-icon, .bin .disc ha-state-icon { --mdc-icon-size: 26px; }
  .bin .lbl { font-size: 12px; line-height: 1.25; text-align: center; color: var(--primary-text-color); overflow-wrap: anywhere; }

  .disc {
    flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent);
  }

  /* Later collections */
  .later { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .row {
    display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 12px;
    width: 100%; box-sizing: border-box; min-height: 56px; padding: 8px 14px 8px 10px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .row .disc { width: 36px; height: 36px; }
  .row .disc ha-icon, .row .disc ha-state-icon { --mdc-icon-size: 20px; }
  .r-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-date { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-in { font-size: 13px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .row.week .r-in { color: var(--primary-text-color); }
  .row.unknown { opacity: 0.6; }
  .msg { padding: 18px 4px; font-size: 13px; color: var(--secondary-text-color); }
`;

class WasteCollectionCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = { days: 45, reminder_text: "Put out tonight", ...(config || {}) };
    this._events = null;
    this._calAt = 0;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${WASTE_STYLE}</style><ha-card><div class="body"></div></ha-card>`;
    this._body = this.shadowRoot.querySelector(".body");
    this._key = null;
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config.calendar && !this._calLoading && Date.now() - this._calAt > CAL_REFRESH_MS) this._loadCalendar();
    this._update();
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this._key = null; // the day may have changed
      this._update();
    }, 15 * 60 * 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 4 + (this._laterCount || 0);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  /* ---------- data ---------- */

  _today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  _days(date) {
    return Math.round((date - this._today()) / DAY);
  }

  _parse(text) {
    if (text == null) return null;
    const s = String(text).trim();
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/); // day first (UK / EU)
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const add = (n) => new Date(this._today().getTime() + n * DAY);
    if (/\btoday\b/i.test(s)) return add(0);
    if (/\btomorrow\b/i.test(s)) return add(1);
    m = s.match(/(?:in\s+)?(\d+)\s*days?\b/i);
    if (m) return add(+m[1]);
    return null;
  }

  _dateFor(st) {
    const a = st.attributes || {};
    const n = [a.daysTo, a.days_to, a.days, a.days_until].map(Number).find((v) => Number.isFinite(v));
    if (n != null) return new Date(this._today().getTime() + n * DAY);
    const fromState = this._parse(st.state);
    if (fromState) return fromState;
    for (const key of ["next_collection", "next_date", "date"]) {
      const d = this._parse(a[key]);
      if (d) return d;
    }
    return null;
  }

  _style(name, cfg = {}) {
    const typeCfg = Object.entries(this._config.types || {}).find(([k]) => k.toLowerCase() === String(name).toLowerCase())?.[1] || {};
    const match = WASTE_TYPES.find(([re]) => re.test(name));
    return {
      color: cfg.color || typeCfg.color || match?.[1] || "var(--primary-color)",
      icon: cfg.icon || typeCfg.icon || null,
      fallbackIcon: match?.[2] || "mdi:trash-can-outline",
    };
  }

  _items() {
    const h = this._hass;
    const c = this._config;
    if (c.calendar) return this._calendarItems();

    let list = c.entities;
    if (!Array.isArray(list) || !list.length) {
      const reg = h.entities || {};
      list = Object.keys(h.states)
        .filter((id) => id.startsWith("sensor.") && WASTE_PLATFORMS.includes(reg[id]?.platform) && !reg[id]?.hidden)
        .sort();
    }
    return list
      .map((x) => (typeof x === "string" ? { entity: x } : x))
      .filter((x) => x?.entity)
      .map((cfg) => {
        const st = h.states[cfg.entity];
        const name = cfg.name || (st?.attributes.friendly_name || cfg.entity).replace(/^waste collection schedule\s+/i, "");
        const date = st ? this._dateFor(st) : null;
        return { key: cfg.entity, entity: cfg.entity, stateObj: st, name, date, ...this._style(name, cfg) };
      });
  }

  async _loadCalendar() {
    const c = this._config;
    this._calLoading = true;
    const start = this._today();
    const end = new Date(start.getTime() + (Number(c.days) || 45) * DAY);
    try {
      const evs = await this._hass.callApi(
        "GET",
        `calendars/${c.calendar}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
      );
      this._events = Array.isArray(evs) ? evs : [];
    } catch (err) {
      console.warn("waste-collection-card: could not read calendar", err);
      this._events = [];
    } finally {
      this._calLoading = false;
      this._calAt = Date.now();
      this._key = null;
      this._update();
    }
  }

  _calendarItems() {
    if (!this._events) return null;
    const next = new Map();
    for (const ev of this._events) {
      const name = String(ev.summary || "Collection").trim();
      const date = this._parse(ev.start?.date || ev.start?.dateTime || ev.start);
      if (!date || this._days(date) < 0) continue;
      // One calendar event can list several bins: "Food Waste, Glass"
      for (const part of name.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean)) {
        if (!next.has(part) || date < next.get(part)) next.set(part, date);
      }
    }
    return [...next].map(([name, date]) => ({ key: name, entity: this._config.calendar, name, date, ...this._style(name) }));
  }

  /* ---------- drawing ---------- */

  _fmtDate(date, opts) {
    return date.toLocaleDateString(this._hass?.locale?.language, opts);
  }

  _whenText(days, date) {
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 7) return this._fmtDate(date, { weekday: "long" });
    return this._fmtDate(date, { weekday: "short", day: "numeric", month: "short" });
  }

  _icon(item, wrap) {
    if (item.icon || !item.stateObj) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", item.icon || item.fallbackIcon);
      wrap.append(el);
      return;
    }
    // Use the sensor's own icon when it has one, otherwise a type icon
    const own = this._hass.entities?.[item.entity]?.icon || item.stateObj.attributes.icon;
    if (own) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", own);
      wrap.append(el);
    } else {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", item.fallbackIcon);
      wrap.append(el);
    }
  }

  _update() {
    if (!this._hass || !this._body) return;
    const items = this._items();
    if (items === null) {
      this._body.innerHTML = `<div class="msg">Reading the collection calendar…</div>`;
      return;
    }
    const key = JSON.stringify(items.map((i) => [i.key, i.name, i.date?.getTime(), i.color, i.icon])) + this._today().getTime();
    if (key === this._key) return;
    this._key = key;

    if (!items.length) {
      this._body.innerHTML = `<div class="msg">No waste collection sensors found. Add them under entities: in the card config.</div>`;
      this._laterCount = 0;
      return;
    }

    const dated = items.filter((i) => i.date && this._days(i.date) >= 0).sort((a, b) => a.date - b.date || a.name.localeCompare(b.name));
    const undated = items.filter((i) => !i.date || this._days(i.date) < 0);
    const frag = document.createDocumentFragment();

    if (dated.length) {
      const first = dated[0].date.getTime();
      const now = dated.filter((i) => i.date.getTime() === first);
      const later = dated.filter((i) => i.date.getTime() !== first);
      frag.append(this._hero(now));
      if (later.length || undated.length) {
        const box = document.createElement("div");
        box.className = "later";
        for (const i of later) box.append(this._row(i));
        for (const i of undated) box.append(this._row(i));
        frag.append(box);
      }
      this._laterCount = later.length + undated.length;
    } else {
      const box = document.createElement("div");
      box.className = "later";
      for (const i of undated) box.append(this._row(i));
      frag.append(box);
      this._laterCount = undated.length;
    }
    this._body.replaceChildren(frag);
  }

  _hero(group) {
    const date = group[0].date;
    const days = this._days(date);
    const hero = document.createElement("div");
    hero.className = "hero";
    const soon = days <= 1;
    hero.classList.toggle("soon", soon);
    hero.style.setProperty("--accent", days === 0 ? "var(--success-color, #43a047)" : "var(--warning-color, #ffa600)");

    const left = document.createElement("div");
    left.className = "title";
    left.innerHTML = `<div class="when"></div><div class="date"></div>`;
    left.querySelector(".when").textContent = days === 0 ? "Today" : days === 1 ? "Tomorrow" : this._fmtDate(date, { weekday: "long" });
    left.querySelector(".date").textContent = this._fmtDate(date, { weekday: days > 1 ? undefined : "long", day: "numeric", month: "long" });

    const count = document.createElement("div");
    count.className = "count";
    count.innerHTML = `<span class="n"></span><span class="u"></span>`;
    count.querySelector(".n").textContent = String(days);
    count.querySelector(".u").textContent = days === 1 ? "day" : "days";
    count.setAttribute("aria-label", days === 0 ? "Collection today" : `${days} ${days === 1 ? "day" : "days"} to go`);

    hero.append(left, count);

    if (soon) {
      const pill = document.createElement("div");
      pill.className = "pill";
      pill.innerHTML = `<ha-icon></ha-icon><span></span>`;
      pill.querySelector("ha-icon").setAttribute("icon", days === 0 ? "mdi:truck-outline" : "mdi:bell-ring-outline");
      pill.querySelector("span").textContent = days === 0 ? "Collection day" : this._config.reminder_text;
      hero.append(pill);
    }

    const bins = document.createElement("div");
    bins.className = "bins";
    for (const i of group) {
      const b = document.createElement("button");
      b.className = "bin";
      b.title = i.name;
      b.style.setProperty("--c", i.color);
      b.innerHTML = `<span class="disc"></span><span class="lbl"></span>`;
      this._icon(i, b.querySelector(".disc"));
      b.querySelector(".lbl").textContent = i.name;
      b.addEventListener("click", () => this._moreInfo(i.entity));
      bins.append(b);
    }
    hero.append(bins);
    return hero;
  }

  _row(i) {
    const r = document.createElement("button");
    r.className = "row";
    r.style.setProperty("--c", i.color);
    r.innerHTML = `<span class="disc"></span><span><div class="r-name"></div><div class="r-date"></div></span><span class="r-in"></span>`;
    this._icon(i, r.querySelector(".disc"));
    r.querySelector(".r-name").textContent = i.name;
    if (i.date && this._days(i.date) >= 0) {
      const days = this._days(i.date);
      r.querySelector(".r-date").textContent = this._fmtDate(i.date, { weekday: "long", day: "numeric", month: "long" });
      r.querySelector(".r-in").textContent = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`;
      r.classList.toggle("week", days < 7);
    } else {
      r.classList.add("unknown");
      r.querySelector(".r-date").textContent = i.stateObj ? `Date not recognised: ${i.stateObj.state}` : "Entity not found";
      r.querySelector(".r-in").textContent = "";
    }
    r.addEventListener("click", () => this._moreInfo(i.entity));
    return r;
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("waste-collection-card")) customElements.define("waste-collection-card", WasteCollectionCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "waste-collection-card",
  name: "Waste Collection Card",
  description: "Next bin day with a put-out reminder, then every other bin's next collection",
});
