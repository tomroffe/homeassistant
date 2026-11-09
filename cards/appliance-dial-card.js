/**
 * appliance-dial-card  (v6)
 * A Home Assistant Lovelace card styled like the built-in thermostat card,
 * for washing machines and tumble dryers.
 *
 * - Arc shows cycle progress; centre shows phase and time left.
 * - Round buttons stop / start / pause (via the operating-state select).
 * - Optional bottom pill: any select entity (select_entity).
 * - Optional `controls:` tiles with coloured icons: switches toggle, selects
 *   open a picker, numbers get -/+, sensors show their value.
 * - Optional `graph:` energy (or power) chart from long-term statistics.
 *
 * Install: copy to /config/www/appliance-dial-card.js and add the resource
 * /local/appliance-dial-card.js (type: JavaScript module).
 */

const ARC = "M 40.6 159.4 A 84 84 0 1 1 159.4 159.4"; // 270° arc, r=84, centre 100,100
const GRAPH_DEFAULT_COUNT = { hour: 24, day: 7, week: 8, month: 12 };
const GRAPH_REFRESH_MS = 10 * 60 * 1000;

const STYLE = `
  ha-card { padding: 12px 16px 16px; container-type: inline-size; }
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
    position: relative; width: min(100%, var(--dial-size)); aspect-ratio: 200 / 184; margin: 4px auto 0;
    container-type: inline-size; /* text below scales with the dial */
  }
  svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .track, .fill { fill: none; stroke-width: 16; stroke-linecap: round; }
  .track { stroke: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .fill { stroke: var(--dial-color); stroke-opacity: 0.55; display: none; }
  .handle { fill: #fff; stroke: var(--dial-color); stroke-width: 4; display: none; }
  ha-card.active .fill, ha-card.active .handle { display: inline; }
  .center {
    position: absolute; top: 0; left: 0; right: 0; height: 108.7%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; pointer-events: none;
    color: var(--primary-text-color);
  }
  .label { font-size: max(13px, 6.7cqw); font-weight: 500; margin-bottom: 2cqw; text-align: center; max-width: 70%; }
  .big { display: flex; align-items: flex-start; line-height: 1; }
  .value { font-size: 18.7cqw; font-weight: 400; font-variant-numeric: tabular-nums; }
  .unit { font-size: max(12px, 6.7cqw); margin: 1.3cqw 0 0 1.3cqw; }
  .sub { display: flex; align-items: center; gap: 4px; font-size: max(12px, 5.3cqw); margin-top: 4.5cqw; min-height: 1.2em; }
  .sub ha-icon { --mdc-icon-size: max(14px, 6cqw); }
  .buttons {
    position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
    display: flex; justify-content: center; gap: 7cqw;
  }
  .round {
    width: max(36px, 16cqw); height: max(36px, 16cqw);
    padding: 0; border: 1px solid var(--outline-color, var(--divider-color));
  }
  .round:disabled { opacity: 0.35; cursor: default; }

  /* Bottom select pill */
  .select-row {
    position: relative; display: flex; align-items: center; height: 56px; margin-top: 12px;
    padding-left: 16px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-text-color); margin-right: 20px; flex: none; }
  .select-row select {
    appearance: none; -webkit-appearance: none; flex: 1; height: 100%; padding-right: 44px;
    background: transparent; border: none; outline: none; cursor: pointer;
    color: var(--primary-text-color); font: inherit; font-size: 16px;
  }
  select option { background: var(--card-background-color); color: var(--primary-text-color); }
  .select-row > ha-icon { position: absolute; right: 14px; pointer-events: none; color: var(--primary-text-color); }

  /* Control tiles */
  .controls { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  @container (max-width: 300px) { .controls { grid-template-columns: minmax(0, 1fr); } }
  .ctl {
    position: relative; display: flex; align-items: center; gap: 8px; min-height: 56px;
    padding: 8px; border-radius: 12px; box-sizing: border-box;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
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

  /* Energy graph */
  .graph {
    margin-top: 12px; padding: 12px 14px 10px; border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
  }
  .g-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .g-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: var(--primary-text-color); }
  .g-title ha-icon { --mdc-icon-size: 18px; color: var(--graph-color); }
  .g-caption { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; }
  .g-value { font-size: 18px; color: var(--primary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .g-value small { font-size: 13px; color: var(--secondary-text-color); margin-left: 2px; }
  .g-bars { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 4px; align-items: end; height: 90px; margin-top: 12px; }
  .bar {
    padding: 0; width: 100%; min-height: 3px; border-radius: 4px 4px 2px 2px;
    background: var(--graph-color); opacity: 0.5; transition: opacity 0.15s;
  }
  .bar.empty { background: color-mix(in srgb, var(--primary-text-color) 15%, transparent); opacity: 1; }
  .bar.sel, .bar:hover { opacity: 1; }
  .g-line { height: 90px; margin-top: 12px; }
  .g-line polyline { fill: none; stroke: var(--graph-color); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .g-line polygon { fill: var(--graph-color); opacity: 0.15; }
  .g-labels { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 4px; margin-top: 4px; font-size: 11px; color: var(--secondary-text-color); text-align: center; }
  .g-labels span { white-space: nowrap; overflow: visible; }
  .g-empty { font-size: 13px; color: var(--secondary-text-color); padding: 24px 0 14px; text-align: center; }

  @media (prefers-reduced-motion: reduce) { .badge, .sw, .sw::after, .bar { transition: none; } }
`;

class ApplianceDialCard extends HTMLElement {
  static getStubConfig() {
    return {
      name: "Washing Machine",
      state_entity: "select.washing_machine",
      completion_entity: "sensor.washing_machine_completion_time",
    };
  }

  setConfig(config) {
    if (!config || !config.state_entity) throw new Error("You need to define state_entity");
    this._config = {
      color: "var(--state-climate-cool-color, #2196f3)",
      confirm_stop: true,
      ...config,
    };
    this._optsKey = null;
    this._ctl = null;
    this._graph = null;
    this._graphFetched = 0;
    this._gSel = null;
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
    this._timer = setInterval(() => this._update(), 30000); // keep the countdown moving
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 7 + Math.ceil((this._config?.controls?.length || 0) / 2) + (this._config?.graph ? 3 : 0);
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
          <svg viewBox="0 0 200 184" aria-hidden="true">
            <path class="track" d="${ARC}" pathLength="100"></path>
            <path class="fill" d="${ARC}" pathLength="100" stroke-dasharray="0 100"></path>
            <circle class="handle" r="9" cx="40.6" cy="159.4"></circle>
          </svg>
          <div class="center">
            <div class="label"></div>
            <div class="big"><span class="value">--</span><span class="unit"></span></div>
            <div class="sub"><ha-icon class="sub-icon"></ha-icon><span class="sub-text"></span></div>
          </div>
          <div class="buttons">
            <button class="round stop" title="Stop"><ha-icon icon="mdi:stop"></ha-icon></button>
            <button class="round play" title="Start or pause"><ha-icon class="play-icon" icon="mdi:play"></ha-icon></button>
          </div>
        </div>
        <div class="select-row">
          <span class="dot"></span>
          <select></select>
          <ha-icon icon="mdi:menu-down"></ha-icon>
        </div>
        <div class="controls"></div>
        <div class="graph"></div>
      </ha-card>`;

    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      card: $("ha-card"),
      name: $(".name"),
      fill: $(".fill"),
      handle: $(".handle"),
      label: $(".label"),
      value: $(".value"),
      unit: $(".unit"),
      subIcon: $(".sub-icon"),
      subText: $(".sub-text"),
      buttons: $(".buttons"),
      stop: $(".stop"),
      play: $(".play"),
      playIcon: $(".play-icon"),
      selectRow: $(".select-row"),
      select: $(".select-row select"),
      controls: $(".controls"),
      graph: $(".graph"),
    };
    this._els.card.style.setProperty("--dial-color", c.color);
    const size = Number(c.dial_size) || 240;
    this._els.card.style.setProperty("--dial-size", `${Math.max(160, Math.min(320, size))}px`);
    this._els.card.style.setProperty("--graph-color", c.graph?.color || c.color);
    if (c.controls_columns) this._els.controls.style.setProperty("--cols", c.controls_columns);
    this._els.graph.style.display = c.graph?.entity ? "" : "none";

    $(".more").addEventListener("click", () => this._moreInfo(c.state_entity));

    this._els.stop.addEventListener("click", () => {
      if (c.confirm_stop && !window.confirm(`Stop the ${this._els.name.textContent}?`)) return;
      this._selectMatching(/stop/i);
    });

    this._els.play.addEventListener("click", () => {
      if (this._running) this._selectMatching(/pause/i);
      else this._selectMatching(/run|start|resume/i);
    });

    this._els.select.addEventListener("change", (ev) => {
      if (!c.select_entity) return;
      this._hass.callService("select", "select_option", {
        entity_id: c.select_entity,
        option: ev.target.value,
      });
    });
  }

  _fmt(stateObj, value) {
    const h = this._hass;
    return h.formatEntityState ? h.formatEntityState(stateObj, value) : value ?? stateObj.state;
  }

  /* ---------- state ---------- */

  _update() {
    if (!this._hass || !this._els) return;
    const h = this._hass;
    const c = this._config;
    const e = this._els;
    const fmt = (s, v) => this._fmt(s, v);

    const st = h.states[c.state_entity];
    e.name.textContent = c.name || st?.attributes.friendly_name || c.state_entity;
    if (!st) {
      e.label.textContent = "Entity not found";
      return;
    }

    // What is the machine doing?
    const raw = String(st.state).toLowerCase();
    const paused = raw.includes("pause");
    const running = !paused && /run|start|wash|rinse|spin|dry|cool/.test(raw);
    const active = running || paused;
    this._running = running;

    const job = c.job_entity && h.states[c.job_entity];
    const jobOk = job && !["unknown", "unavailable", "none"].includes(String(job.state).toLowerCase());
    e.label.textContent = active && jobOk ? fmt(job) : fmt(st);

    // Countdown + progress
    const comp = c.completion_entity && h.states[c.completion_entity];
    const end = comp ? Date.parse(comp.state) : NaN;
    const hasEnd = !Number.isNaN(end);
    const now = Date.now();

    let progress = 0;
    if (active && hasEnd) {
      const start = Date.parse(st.last_changed);
      if (running && end > start) progress = Math.min(1, Math.max(0, (now - start) / (end - start)));
      else if (paused) progress = this._lastProgress ?? 0;
    }
    if (running) this._lastProgress = progress;

    if (active && hasEnd) {
      const mins = Math.max(0, Math.round((end - now) / 60000));
      if (mins >= 60) {
        e.value.textContent = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
        e.unit.textContent = "h";
      } else {
        e.value.textContent = String(mins);
        e.unit.textContent = "min";
      }
      e.subIcon.setAttribute("icon", "mdi:flag-checkered");
      e.subText.textContent = `Done at ${new Date(end).toLocaleTimeString(h.locale?.language, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } else {
      e.value.textContent = "--";
      e.unit.textContent = "";
      const finished = hasEnd && end <= now;
      e.subIcon.setAttribute("icon", finished ? "mdi:check-circle-outline" : "mdi:clock-outline");
      e.subText.textContent = finished ? `Finished ${this._ago(now - end)}` : "";
    }

    // Arc
    e.card.classList.toggle("active", active);
    e.fill.setAttribute("stroke-dasharray", `${(progress * 100).toFixed(2)} 100`);
    const a = ((135 + 270 * progress) * Math.PI) / 180;
    e.handle.setAttribute("cx", (100 + 84 * Math.cos(a)).toFixed(2));
    e.handle.setAttribute("cy", (100 + 84 * Math.sin(a)).toFixed(2));

    // Buttons
    e.buttons.style.display = this._controlEntity() ? "" : "none";
    e.playIcon.setAttribute("icon", running ? "mdi:pause" : "mdi:play");
    e.stop.disabled = !active;

    // Bottom select pill
    const sel = c.select_entity && h.states[c.select_entity];
    e.selectRow.style.display = sel ? "" : "none";
    if (sel) {
      const opts = sel.attributes.options || [];
      const key = opts.join("|");
      if (key !== this._optsKey) {
        this._optsKey = key;
        e.select.replaceChildren(...opts.map((o) => this._option(o, fmt(sel, o))));
      }
      if (this.shadowRoot.activeElement !== e.select) e.select.value = sel.state;
    }

    // Control tiles
    if (!this._ctl) this._buildControls();
    this._updateControls();

    // Energy graph (refreshes every 10 minutes)
    if (c.graph?.entity && !this._graphLoading && now - this._graphFetched > GRAPH_REFRESH_MS) {
      this._fetchGraph();
    }
  }

  _option(value, label) {
    const op = document.createElement("option");
    op.value = value;
    op.textContent = label;
    return op;
  }

  /* ---------- control tiles ---------- */

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

  // "Washing Machine Spin level" -> "Spin level"
  _shortName(st, fallback) {
    const full = st?.attributes.friendly_name || fallback;
    const device = this._config.name || this._hass.states[this._config.state_entity]?.attributes.friendly_name;
    if (device && full.toLowerCase().startsWith(device.toLowerCase()) && full.length > device.length) {
      const rest = full.slice(device.length).trim();
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return full;
  }

  /* ---------- energy graph ---------- */

  _buckets(period, count) {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    if (period !== "hour") d.setHours(0);
    if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    if (period === "month") d.setDate(1);
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const b = new Date(d);
      if (period === "hour") b.setHours(b.getHours() - i);
      else if (period === "day") b.setDate(b.getDate() - i);
      else if (period === "week") b.setDate(b.getDate() - 7 * i);
      else b.setMonth(b.getMonth() - i);
      out.push(b.getTime());
    }
    return out;
  }

  async _fetchGraph() {
    const g = this._config.graph;
    this._graphLoading = true;
    try {
      const period = ["hour", "day", "week", "month"].includes(g.period) ? g.period : "day";
      const count = Math.max(2, Math.min(60, Number(g.count) || GRAPH_DEFAULT_COUNT[period]));
      const st = this._hass.states[g.entity];
      const kind = g.type || (st?.attributes.state_class === "measurement" ? "mean" : "change");
      const buckets = this._buckets(period, count);

      const res = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(buckets[0]).toISOString(),
        end_time: new Date().toISOString(),
        statistic_ids: [g.entity],
        period,
        types: [kind],
      });

      const values = buckets.map(() => null);
      for (const r of res?.[g.entity] || []) {
        const t = typeof r.start === "number" ? r.start : Date.parse(r.start);
        const v = r[kind];
        if (v == null) continue;
        for (let k = buckets.length - 1; k >= 0; k--) {
          if (t >= buckets[k] - 60000) {
            values[k] = kind === "change" ? (values[k] ?? 0) + v : v;
            break;
          }
        }
      }
      this._graph = { period, kind, buckets, values, unit: st?.attributes.unit_of_measurement || "" };
    } catch (err) {
      console.warn("appliance-dial-card: could not load statistics", err);
      this._graph = { error: true };
    } finally {
      this._graphLoading = false;
      this._graphFetched = Date.now();
      this._renderGraph();
    }
  }

  _num(v) {
    const lang = this._hass?.locale?.language;
    return new Intl.NumberFormat(lang, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 }).format(v);
  }

  _gLabel(t, period, long) {
    const lang = this._hass?.locale?.language;
    const d = new Date(t);
    if (period === "hour") return d.toLocaleTimeString(lang, long ? { hour: "2-digit", minute: "2-digit" } : { hour: "2-digit" });
    if (period === "day")
      return d.toLocaleDateString(lang, long ? { weekday: "long", day: "numeric", month: "short" } : { weekday: "short" });
    if (period === "week") return (long ? "Week of " : "") + d.toLocaleDateString(lang, { day: "numeric", month: "short" });
    return d.toLocaleDateString(lang, long ? { month: "long", year: "numeric" } : { month: "short" });
  }

  _renderGraph() {
    const box = this._els.graph;
    const g = this._config.graph;
    const data = this._graph;
    const words = { hour: "hours", day: "days", week: "weeks", month: "months" };
    const title = g.name || (data?.kind === "mean" ? "Power" : "Energy");
    const icon = g.icon || (data?.kind === "mean" ? "mdi:flash" : "mdi:lightning-bolt");

    box.innerHTML = `
      <div class="g-head">
        <div>
          <div class="g-title"><ha-icon icon="${icon}"></ha-icon><span class="g-name"></span></div>
          <div class="g-caption"></div>
        </div>
        <div class="g-value"></div>
      </div>
      <div class="g-body"></div>`;
    box.querySelector(".g-name").textContent = title;
    const caption = box.querySelector(".g-caption");
    const valueEl = box.querySelector(".g-value");
    const body = box.querySelector(".g-body");

    if (!data || data.error || data.values.every((v) => v == null)) {
      caption.textContent = "";
      body.innerHTML = `<div class="g-empty"></div>`;
      body.firstChild.textContent = data?.error
        ? "Couldn't load history for this sensor."
        : "No history yet. The sensor needs a state class to keep statistics.";
      return;
    }

    const { period, kind, buckets, values, unit } = data;
    const n = buckets.length;
    const rangeText = `Last ${n} ${words[period]}`;
    const showValue = (v, prefix) => {
      valueEl.innerHTML = "";
      valueEl.append(v == null ? "–" : this._num(v));
      const small = document.createElement("small");
      small.textContent = unit;
      valueEl.append(small);
      caption.textContent = prefix;
    };

    const nums = values.filter((v) => v != null);
    const step = Math.ceil(n / 8);
    const labels = document.createElement("div");
    labels.className = "g-labels";
    labels.style.setProperty("--n", n);
    buckets.forEach((t, i) => {
      const s = document.createElement("span");
      if ((n - 1 - i) % step === 0) s.textContent = this._gLabel(t, period, false);
      labels.append(s);
    });

    if (kind === "change") {
      const total = nums.reduce((a, b) => a + b, 0);
      const max = Math.max(...nums, 0) || 1;
      const showTotal = () => showValue(total, rangeText);
      const bars = document.createElement("div");
      bars.className = "g-bars";
      bars.style.setProperty("--n", n);
      values.forEach((v, i) => {
        const b = document.createElement("button");
        b.className = "bar" + (v ? "" : " empty");
        b.style.height = `${v ? Math.max(3, (v / max) * 100) : 3}%`;
        const lbl = this._gLabel(buckets[i], period, true);
        b.setAttribute("aria-label", `${lbl}: ${v == null ? "no data" : this._num(v) + " " + unit}`);
        if (i === this._gSel) b.classList.add("sel");
        b.addEventListener("click", () => {
          this._gSel = this._gSel === i ? null : i;
          bars.querySelectorAll(".bar").forEach((x, j) => x.classList.toggle("sel", j === this._gSel));
          if (this._gSel == null) showTotal();
          else showValue(v, lbl);
        });
        bars.append(b);
      });
      body.append(bars, labels);
      if (this._gSel != null && this._gSel < n) showValue(values[this._gSel], this._gLabel(buckets[this._gSel], period, true));
      else showTotal();
    } else {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const span = max - min || 1;
      const pts = values
        .map((v, i) => (v == null ? null : `${i},${(100 - ((v - min) / span) * 90 - 5).toFixed(2)}`))
        .filter(Boolean);
      const first = pts[0].split(",")[0];
      const last = pts[pts.length - 1].split(",")[0];
      body.innerHTML = `
        <div class="g-line">
          <svg viewBox="0 0 ${Math.max(1, n - 1)} 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="${first},100 ${pts.join(" ")} ${last},100"></polygon>
            <polyline points="${pts.join(" ")}"></polyline>
          </svg>
        </div>`;
      body.append(labels);
      showValue(nums.reduce((a, b) => a + b, 0) / nums.length, `Average, ${rangeText.toLowerCase()}`);
    }
  }

  /* ---------- helpers ---------- */

  _controlEntity() {
    const c = this._config;
    return c.control_entity || (c.state_entity.startsWith("select.") ? c.state_entity : null);
  }

  _selectMatching(re) {
    const id = this._controlEntity();
    const st = id && this._hass.states[id];
    const option = st?.attributes.options?.find((o) => re.test(o));
    if (!option) {
      console.warn(`appliance-dial-card: no option matching ${re} on ${id}`, st?.attributes.options);
      return;
    }
    this._hass.callService("select", "select_option", { entity_id: id, option });
  }

  _ago(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr} h ago`;
    const d = Math.round(hr / 24);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }
}

if (!customElements.get("appliance-dial-card")) {
  customElements.define("appliance-dial-card", ApplianceDialCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "appliance-dial-card",
  name: "Appliance Dial Card",
  description: "Thermostat-style dial for washing machines and tumble dryers",
});
