# MEMORY.md — Home Assistant dashboards and heating control

Context for anyone (or any AI session) picking this repo up. Read this first.

Last updated: 9 November 2026

---

## 1. The setup

| Part | What it is | Entity / notes |
|---|---|---|
| Home Assistant | HA OS with add-ons (File editor) | `http://homeassistant.local:8123`, config in `/config` (shown as `/homeassistant` in File editor) |
| Boiler | Hive heating, cloud-polled HA integration | `climate.turnuptheheat` (the Hive heating zone). The Hive wall thermostat device is "Thermostat 1", in the Library |
| Radiator valves | Sonoff TRVZB on Zigbee | Wrapped by **Better Thermostat** (HACS), one BT climate entity per room |
| Rooms | Arthurs Bedroom, Kitchen, Library, Living Room, Master Bedroom, Spare Room | BT entities are found automatically by platform `better_thermostat`, so IDs are not hard-coded |
| Cameras / sensors | UniFi Protect via Cloud Key | Protect UI: `https://cloud-key.mothership.sm4rt.io/protect/` |
| Bins | Waste Collection Schedule (HACS) | States look like `on Thu, 05.11.2026` |
| Outdoor sensor | Annex parking sensor (UniFi) | `sensor.annex_parking_sensor_temperature`, `sensor.annex_parking_sensor_illuminance` |
| House averages | Existing template/average sensors | `sensor.house_average_temperature`, `sensor.house_average_humidity` |

---

## 2. Files in this repo

The repo mirrors where each file goes in Home Assistant:

```text
cards/        custom card JavaScript      -> /config/www/
dashboards/   dashboard and card YAML     -> pasted into the dashboard editors
packages/     YAML packages               -> /config/packages/
MEMORY.md     this file
README.md     what each card / dashboard / package is, with install steps and example YAML
```

Keep README.md's tables (versions, resource URLs) in step with the table below.

| File | Goes to | Resource URL (bump `?v=` on every change) | Version |
|---|---|---|---|
| `cards/appliance-dial-card.js` | `/config/www/` | `/local/appliance-dial-card.js?v=6` | v6 (Tom's original card; the visual template every other card copies) |
| `cards/heating-dial-card.js` | `/config/www/` | `/local/heating-dial-card.js?v=4` | v4 |
| `cards/waste-collection-card.js` | `/config/www/` | `/local/waste-collection-card.js?v=3` | v3 |
| `cards/motion-activity-card.js` | `/config/www/` | `/local/motion-activity-card.js?v=2` | v2 |
| `cards/climate-overview-card.js` | `/config/www/` | `/local/climate-overview-card.js?v=1` | v1 |
| `cards/weather-forecast-card.js` | `/config/www/` | `/local/weather-forecast-card.js?v=1` | v1 |
| `cards/air-quality-card.js` | `/config/www/` | `/local/air-quality-card.js?v=1` | v1 |
| `cards/travel-time-card.js` | `/config/www/` | `/local/travel-time-card.js?v=1` | v1 |
| `cards/energy-usage-card.js` | `/config/www/` | `/local/energy-usage-card.js?v=1` | v1 |
| `cards/dehumidifier-card.js` | `/config/www/` | `/local/dehumidifier-card.js?v=2` | v2 |
| `cards/lighting-card.js` | `/config/www/` | `/local/lighting-card.js?v=1` | v1 |
| `dashboards/lighting-dashboard.yaml` | Lighting dashboard → Raw configuration editor | n/a | current |
| `dashboards/dehumidifier-card.yaml` | Card YAML for the landing dehumidifier | n/a | current |
| `dashboards/heating-dashboard.yaml` | Heating dashboard → Raw configuration editor | n/a | current |
| `dashboards/outdoor-cards.yaml` | Card YAML for the weather, air quality and travel cards | n/a | current |
| `dashboards/energy-card.yaml` | Card YAML for the energy usage card | n/a | current |
| `dashboards/waste-section.yaml` | Section YAML on the House view | n/a | superseded by the House view YAML, kept for reference |
| `dashboards/camera-cards.yaml` | Card YAML for the Property view | n/a | superseded by the Property view YAML, kept for reference |
| `packages/hive_call_for_heat.yaml` | `/config/packages/` | n/a (package) | v2.1 |
| `packages/travel_time_refresh.yaml` | `/config/packages/` | n/a (package) | v1 |

Resources are added in **Settings → Dashboards → ⋮ → Resources**, type **JavaScript module**. Always change the `?v=` number after replacing a file, or browsers and the phone app keep the old cached copy.

`configuration.yaml` must contain (once, under a single `homeassistant:` key):

```yaml
homeassistant:
  packages: !include_dir_named packages
```

---

## 3. Heating: how it works

### The core idea
Better Thermostat controls each room's valve. It never talks to the boiler. The package adds the missing link: **if any room needs heat, set Hive high so the boiler fires; otherwise set Hive low.** Home Assistant is the only scheduler, so the Hive app schedule must stay **off**.

### Package `hive_call_for_heat.yaml` (v2.1)

**Helpers**
- `input_select.house_heating_preset`: Comfort, Eco, Sleep, Away, Boost, Manual, `"Off"` (quoted, or YAML reads it as `false`)
- `input_number.heating_preset_{comfort,eco,sleep,away,boost,manual}`: 5–28 °C, step 0.5
- `input_number.heating_boost_hours`: 0.25–4 h, step 0.25
- `input_text.house_heating_previous_preset`: last normal preset, used by Boost restore and the power button
- `timer.house_heating_boost` (`restore: true`)
- `input_boolean.heating_pause_boiler_control`: when on, the automation leaves Hive alone (named "pause" so the default off state means control is active)

**Template sensor**
- `binary_sensor.heat_demand`: on when any BT room is not off and either `hvac_action == heating` or current < target − 0.3. `delay_on` 2 min, `delay_off` 5 min (stops short cycling). Attribute `rooms_calling` lists the room names.

**Automations**
1. `hive_call_for_heat`: on demand change, HA start, pause turned off, and every 30 min. It sets Hive to `heat` mode, then 25 °C (demand) or 12 °C (setback and frost protection if HA dies). It skips calls when Hive already matches, to spare the cloud API.
2. `house_heating_apply_preset`: when the preset changes, or the active preset's temperature changes, it sets every available BT room. `Off` turns rooms off. Otherwise it clears each room's own BT preset (`continue_on_error`), turns off rooms on, waits 2 s, then sets the temperature. Manual is a preset with its own temperature, which is what the dial's −/+ uses.
3. `house_heating_boost_timer`: remembers the previous preset (Comfort/Eco/Sleep/Away/Manual), starts the timer on Boost, cancels it on leaving Boost, and restores the previous preset (default Comfort) when it finishes.
4. `house_heating_seed_defaults`: on start, any preset still at 5 °C (fresh helper) is set to its default: Comfort 21, Eco 19, Sleep 17, Away 15, Boost 23, Manual 20. **First install therefore sets every room to 21 °C.**

### Better Thermostat settings in use
Calibration type: Target Temperature Based. Mode: AI Time Based. Overheating protection: on. Tolerance 0.5. Room temperature and humidity sensor per room, outdoor sensor set. Advice given: window open delay 30–60 s, outdoor cut-off 16–18 °C (24 °C never triggers).

---

## 4. Custom cards

All cards share the look of `appliance-dial-card`: `ha-card` with 12–16 px padding, inner panels `border-radius: 12px` on `color-mix(in srgb, var(--primary-text-color) 6%, transparent)`, 32–40 px round icon badges at 20% colour, theme CSS variables only, tabular numbers, `container-type: inline-size` with container queries for narrow layouts. History comes from the WebSocket `history/history_during_period` (refetch every 5 min), sampled to fixed points; graphs are SVG with `preserveAspectRatio="none"` and `vector-effect: non-scaling-stroke`, with a hover/drag cursor.

### `heating-dial-card.js` (v4): three cards in one file

v4: each preset tile has its own colour (Comfort amber, Eco green, Sleep indigo, Away teal, Boost red, Manual purple, Off grey; override with `preset_colors: { eco: "#..." }`), used for the icon and the selected tile. The -/+ rows sit centred in the space under the title, so tiles beside the taller Boost tile line up halfway.

**`custom:heating-dial-card`**
- **Whole-house mode** (no `entity`): 270° dial whose big number is the house target, with a dot for the average room temperature. −/+ set all rooms via `input_number.heating_preset_manual` plus selecting Manual (1 s debounce). The power button selects Off, or restores the previous preset. Under the dial: a boiler status line, preset tiles (icon beside name, each with −/+ for its temperature, Boost with a second −/+ for its length, 0.7 s debounce), and the room list. `show_name: false` hides the title. Main option: `boiler_entity: climate.turnuptheheat`.
- **Room mode** (`entity: climate.<room>`): target dial, current temperature and humidity, −/+ (`climate.set_temperature`), power (heat/off), the room's own BT preset picker, optional `controls:` tiles.
- **Dial geometry (v3 fix)**: viewBox `0 0 200 200`, square aspect. Buttons sit in the strip below the arc ends so they never overlap. Do not go back to the 184-high viewBox.

**`custom:heating-rooms-card`**: grid of room dials, auto-discovering BT rooms (or `rooms:`, `exclude:`). With `history: true`, each dial is paired with a room history panel (`history_hours`, `outdoor_entity`, `min_width_history: 620`); the pair stacks below 580 px.

**`custom:heating-stats-card`**
- **House mode**: average room temperature and humidity, boiler-on periods shaded (Hive `hvac_action == heating`, gaps under 2 min merged). Stats: last cycle, cycle temperature change, boiler on time and %, cycles and average length, temperature range, humidity range.
- **Room mode** (`entity:`): temperature, target (dotted) and humidity, valve-open periods shaded. Stats: valve open; on target (% of time within ±0.5 °C, average deviation); warm-up rate (°C/h over runs ≥ 15 min); cool-down rate (°C/h while idle, skipping 20 min after heating, segments ≥ 45 min); **heat-loss coefficient** k = temperature lost ÷ (hours × mean indoor−outdoor difference), shown with time constant 1/k (needs `outdoor_entity`, ≥ 2 idle hours, difference > 3 °C); humidity range plus current dew point (Magnus formula).

### `waste-collection-card.js` (v3)
v2: the pill sits between the title and the countdown when the card is ≥ 380 px inside (container query), otherwise it drops under the title; v3: bins are one centred row that never wraps; each bin shrinks from 76 px and its disc from 48 px.

Groups the next collection day into a hero panel (Today/Tomorrow, date, countdown, "Put out tonight" or "Collection day" pill, coloured bin icons), then one row per remaining bin. Dates are parsed from: attributes `daysTo`/`days`/`days_until`, state `dd.mm.yyyy`, `yyyy-mm-dd`, Today/Tomorrow/"in N days", or attribute `next_collection`. Optional `calendar:` mode. Auto-discovers `waste_collection_schedule` / `uk_bin_collection` sensors and strips the "Waste Collection Schedule " name prefix. Non-recyclable is grey `#9aa0a6`, because black was invisible on the dark theme.

### `motion-activity-card.js` (v2)
For UniFi Protect detections, which are too short to read on a timeline. Options: `entity:` or `entities:`, `camera_entity`, `camera_refresh` (s), `hours`, `bucket_minutes`, `recent`, `url`, `url_label`.
- Camera snapshot from `entity_picture`, refreshed and preloaded so it never flashes blank; tap opens the live stream.
- Status line; "Person detected now" suppresses "motion" when a higher-priority type is active.
- One sensor: three stats plus a bars-per-hour chart. Several sensors: a stat and an hourly heat strip per type.
- Type detection by name: Doorbell/Alarm > Person > Vehicle > Animal > Package > Speaking > Motion, each with its own colour and icon. `event.*` entities count each press.

### `climate-overview-card.js` (v1)
Replaces four tiles and the gauge. Config keys: `inside`, `outside`, `humidity`, `light`, optional `sun`, `hours`, `ranges`, `names`, `colors`.
- Tiles (2×2, or 4 across from 600 px): temperature with 1-hour trend and period low/high; outside compared with inside; humidity comfort word plus dew point; lux level word plus next sunset/sunrise.
- One graph: both temperatures on a shared scale, humidity on the right scale, light as a log-scale band along the bottom.
- Showed "Configuration error" on the phone app only (4 Nov 2026). The code has nothing phone-specific: first suspect is the app's cached frontend (Companion app → Debugging → Reset frontend cache) or a resource URL that is absolute (`http://homeassistant.local…`) instead of `/local/…`.

### `weather-forecast-card.js` (v1)
For the Google Weather integration (`weather.bergholt_road` + `sensor.bergholt_road_*`). Config: `entity`, optional `prefix` (default `sensor.<weather object id>`), `sensors:` overrides, `hours`, `ranges`, `view: hourly|daily`.
- Forecasts come from the WebSocket subscription `weather/subscribe_forecast` (hourly if `supported_features & 2`, daily if `& 1`), unsubscribed on disconnect.
- Hero: condition, temperature, feels like, cloud, today's high/low, and a sentence about rain in the next 12 h plus frost risk (≤ 1 °C) in the next 24 h.
- Six stats: wind (arrow points downwind), rain (thunder ≥ 20 % wins, then current intensity, then 24-h total), UV (level colour, today's peak), humidity + dew point, pressure + 3-h trend (history of the pressure sensor, every 10 min), visibility word.
- Hourly graph: temperature line coloured by warmth, feels-like dashed, rain-chance bars, icons and wind arrows every few hours. Daily list: shared-scale range bars with today's current dot.

### `air-quality-card.js` (v1)
For Google Air Quality (`sensor.bergholt_road_*`). Config: `prefix`, `sensors:` overrides, `hours`, `ranges: [24, 72, 168]`.
- Hero: 10-segment DAQI gauge, category (from `daqi_uk_category`), DEFRA-style advice, Universal AQI chip, main pollutant chip.
- Pollutant tiles use the UK DAQI bands in µg/m³ (ppb/ppm converted at 25 °C). CO is not in DAQI, so its scale puts the WHO 4 mg/m³ guideline at band 4. These are applied to the current reading, not the official running means, so they are a guide only.
- Graph: DAQI columns (worst value per hour, 2-hourly for 7 d) and the UAQI line. Scrubbing the graph rewinds the pollutant tiles to that time.

### `travel-time-card.js` (v1)
For Google Maps / Waze travel time sensors (state in minutes). Config: `entities` (entity, name, icon, color), `days` (default 14), `view: today|week`.
- "Usual" = 25th–75th percentile and median per 15-min slot from previous days of the same kind (weekday or weekend; all days if fewer than 2 match). Readings older than 2 h count as missing.
- Tiles: time now, difference from usual, arrival time, distance. Tap to graph that route; tap again for more-info.
- Today graph: usual band + dashed median across the whole day, today's line up to now, and a "best time to leave in the next 3 h" hint. Week graph: every route over the last 7 days.
- API budget: Google Maps Travel Time polls every 10 min per sensor (~4,400 calls/month each) and the Routes API gives 5,000 free calls/month. `packages/travel_time_refresh.yaml` refreshes both sensors every 15 min from 06:00 to 20:00 instead (~1,700/month each); the integration's own polling must be turned off in its System options. For reference: Google Weather polls current conditions every 15 min and both forecasts hourly; Google Air Quality polls hourly.

### `energy-usage-card.js` (v1)
Replaces the statistics-graph bar chart for `sensor.washing_machine_energy` and `sensor.tumble_dryer_energy`. Config: `entities` (entity, name, icon, color, power, threshold), `price` (number per kWh or a sensor; p/kWh sensors are divided by 100), `currency`, `off_peak: [start, end]`, `range` (24h|7d|30d|12m), `ranges`, `title`.
- Data from `recorder/statistics_during_period`, type `change`. Each fetch gets twice the range so the previous period can be compared, plus 30 days of hourly rows for runs and habits. Wh/MWh are converted to kWh.
- Total panel: kWh, cost, change vs previous period (≥ 200% is shown as a multiple, e.g. 19×), daily average, share bar.
- Tiles: kWh, cost, change, runs (consecutive hours ≥ 0.05 kWh) and kWh/cost per run, last run. With a power sensor (`power:` or `<name>_power` if it exists) a pulsing "x kW" badge shows while above `threshold` (default 5 W).
- Stacked bar graph with a dashed average (full buckets only); the current bucket is drawn faded.
- "When they run": stacked by hour of day (off-peak window shaded) and by weekday over 30 days, with busiest 3-hour window, busiest day, off-peak share and 30-day cost.

### `dehumidifier-card.js` (v2)
v2: `show_controls: false` hides the header, dial, banners and tiles, leaving the history graph and stats (used for the Dehumidifier view's right column).

For the landing dehumidifier: Arete® Two 12L Dehumidifier/Air Purifier on Tuya (cloud), category `cs`, entity `humidifier.landing_arete_r_two_12l_dehumidifier_air_purifier`. Range 35–70 %, **step 5** (DP 2), no modes (`supported_features: 0`) and no `action` attribute.
- Config: `entity` (required), `name`, `step` (5), `history`, `hours`, `ranges`, `tolerance` (2 %), `color`, `dial_size`, `show_name`. Overrides: `humidity_entity`, `temperature_entity`, `timer_entity`, `tank_entity`, `problem_entities`, `controls` (`false` switches a feature off).
- Related entities are found through the humidifier's `device_id` in `hass.entities`, or by object-id prefix if there is no registry entry. Tiles: tank (`/tank/` binary sensor), the timer (`/countdown|timer/` select) first, then other switches, selects and numbers on the device. Banners: every `device_class: problem` binary sensor that is on (tank and faults red, defrost amber).
- Dial: the fill runs from the target to max (the band it dries out). The label is "Drying" when humidity > target, or uses the `action` attribute if a newer integration provides it. −/+ are debounced 1 s and turn the unit on first if it is off.
- Tuya's countdown select (`cancel`/`1h`/`2h`/`3h`) has no time-left entity (DP 18 `countdown_left` isn't exposed), so the end is `last_changed` + hours. After an HA restart this is wrong.
- The device's `fan.*` entity only turns on and off (features 48), the same as the humidifier, so the card doesn't use it. The fault bitmap labels are tankfull, defrost, E1, E2, L2, L3, L4 and wet. HA exposes tank full, defrost, wet and temperature error; what "wet" means isn't documented, so its banner just shows the entity name.
- History: one `history_during_period` call for the humidifier (state, `humidity`, `current_humidity` attributes), the humidity sensor and the tank sensor. Stats: running time, humidity range (dew point if `temperature_entity`), on target (share of running time ≤ target + tolerance) and tank-full count.

### `lighting-card.js` (v1)
Replaces the auto-generated Lights dashboard. It needs no config, because everything comes from `hass.entities` / `hass.devices` / `hass.areas` / `hass.floors`.

Options:
- Filters: `areas`, `floors` (floor IDs plus `outside` / `other`), `outside_areas`, `outside_name`, `include` (e.g. `switch.*` plugs), `exclude`.
- Per entity: `entities: {id: {name, icon, area, hide}}`.
- Features: `presets` (list or `false`), `scenes`, `history`, `history_hours`, `show_summary`, `title`.

How it works:
- **Rooms and groups.** One room per area with lights, in registry order. A group light is a Hue group (`is_hue_group`) or an HA group (`entity_id` list).
  - A group in an area becomes the room's header tile. If an area has two groups, the Hue `hue_type: room` one, or the one named like the area, wins; the other becomes a tile.
  - Members come from `entity_id`, else from Hue's `lights` (friendly names).
  - A group with no area takes its members' area. A group spanning one floor, or named like a floor, becomes that floor's group (tune button on the floor header). Otherwise it goes under Other.
  - A room with no group and one light makes the header control that light directly, with no tile grid.
- **Sections.** Floors in `hass.floors` order, then Outside (`outside_areas`, default: areas with no floor), then Other areas / Other lights.
- **Tiles.** The colour is `rgb_color`, leaned to warm white when near white. Tap the icon to toggle; tap elsewhere for the `<dialog>` control sheet. Unavailable tiles open more-info instead.
  - Dragging sideways sets brightness (0 turns the light off). It starts after 8 px horizontal, with `touch-action: pan-y`.
  - Arrow keys change brightness by 10, Space toggles, Enter opens the sheet.
- **Sheet.** Shows only supported controls (from `supported_color_modes`): brightness, a colour-temperature slider over that bulb's (or the group's union) Kelvin range, a hue/saturation wheel (conic gradient from 90deg, so hue = atan2 angle) plus 8 swatches, effects, presets/scenes and today's strip, with member tiles for rooms. On phones it is a bottom sheet.
- **Service calls** (`_call` / `_control`). Params are trimmed per entity to its capabilities, Kelvin is clamped to each bulb's range, and calls with the same data are grouped into one call.
  - `switch.*` uses `homeassistant.turn_on/off`.
  - While dragging, calls are throttled to one per 300 ms. A final call on release is skipped if it repeats the last one within 1 s.
  - Values show at once and stay until the state matches (brightness ±2 %, Kelvin ±max(60, 3 %), hue/sat ±8) or 15 s pass.
- **Presets.** They target the room's live members (not the group), so each bulb is clamped separately. A chip is "active" when every live member matches.
- **Scenes.** A scene belongs to a room if it is in the area, or if its Hue `group_name` matches the area or group name.
- **History.** One `history_during_period` call (`minimal_response`, `no_attributes`) for every shown entity, since midnight, refetched every 5 min. Runs are brought up to date from `last_changed` between fetches. A room's on-time is the union of its members and its group, so Hue rooms whose bulbs aren't in HA still count.
- **Tested.** Harness with a mock of the 9 Nov screenshot. **Not yet checked against the real entity dump**, so the template output still needs to be compared: Hue group attributes, area IDs for `outside_areas`, and where `light.annex` and `Hue smart plug 1` land.

---

## 5. Dashboards

**House view** (`House`, sections, 4 columns): Appliances (two appliance dials) | Heating (`heating-dial-card`, `show_name: false`) | Household (waste card, climate overview, energy stats graph, wifi users history) | Weather, media, gateway.

**Lighting dashboard** (from `lighting-dashboard.yaml`, suggested URL `dashboard-lighting`): one panel view with `custom:lighting-card` at full width. Replaces the auto-generated Lights dashboard.

**Heating dashboard** (URL `dashboard-heating`, from `heating-dashboard.yaml`):
- *Whole house* (2 columns): house dial | History stats card, then Boiler tiles (Hive, Rooms calling, Pause boiler control), then the Dehumidifier heading and `dehumidifier-card` (name "Landing").
- *Rooms*: `heating-rooms-card` with `history: true`. **TODO:** set `outdoor_entity: sensor.annex_parking_sensor_temperature` (confirmed to exist) to enable the heat-loss figures.
- *Dehumidifier* (path `dehumidifier`, 2 columns): `dehumidifier-card` with `history: false`, `dial_size: 280` | the same card with `show_controls: false` (72 h, ranges 24/72/168 h), then Diagnostics tiles for the four fault binary sensors.

**Property view** (`property`): motion activity cards for
- Front door: `camera.front_door_high_resolution_channel`, `binary_sensor.front_door_motion`, `binary_sensor.front_door_person_detected`
- Car park: `camera.parking_high_resolution_channel`, `binary_sensor.parking_motion`, `_person_detected`, `_vehicle_detected`, plus the floodlight tile
- Back gate: `camera.back_gate_high_resolution_channel`, `binary_sensor.back_gate_person_detected`

---

## 6. Decisions and why

- **HA is the single scheduler.** Hive and HA schedules together made rooms fight each other.
- **Hive gets 25 °C / 12 °C, not on/off.** 25 always fires the boiler wherever the Hive thermostat sits (it is in the Library); 12 keeps frost protection if HA fails.
- **Demand uses `hvac_action` OR "below target − 0.3".** It still works if BT's action attribute lags.
- **House presets set temperatures directly** rather than BT presets, which are per room and inconsistent. Room-level BT presets stay available on the Rooms view.
- **Manual is a real preset with its own temperature,** so Boost can restore it and −/+ is just "set Manual".
- **No `initial:` on helpers,** because it would reset them every restart; the seed automation handles first install instead.
- **Debounced −/+** (1 s dial, 0.7 s tiles) so rapid taps send one change.
- **Dew point from the inside temperature** on the overview, and the room's own temperature in room panels.

## 7. Gotchas already hit

- Card editor YAML must not start with `- ` (that is section list syntax). Error: `can't access property "startsWith"`.
- "Entity not found" on helpers means the package was not loaded: wrong folder, duplicate `homeassistant:` key, or no full restart.
- Dashboard URLs need a hyphen (`dashboard-heating`).
- New helpers need a full restart the first time, not just a YAML reload.

## 8. Testing approach

Cards are tested outside HA with a plain HTML page, stub `ha-card`/`ha-icon` elements and a mock `hass` object (`states`, `entities`, `locale`, `callWS` returning compressed history `{s, a, lu}`, `callService` logging), rendered with Playwright at desktop and phone widths. Run `node --check` on every JS change and validate YAML with `yaml.safe_load` (no custom tags in these files).

## 9. Open items / ideas

- Set `outdoor_entity` on the Rooms view (see section 5).
- Check whether the front door doorbell is `event.front_door_doorbell` and add it to the front door card.
- Offered but not built: evening bin reminder notification listing the bins due tomorrow.
- Possible: per-room schedules (weekday/weekend) driving the house preset; presence-based Away.
