# Home Assistant dashboards and heating control

Custom Lovelace cards, dashboard YAML and packages for this house: Hive heating with
Better Thermostat radiator valves, appliances, bins, cameras, weather, air quality,
travel times and energy.

All the cards share one look: dark rounded panels, coloured icon discs, tabular
numbers, and graphs you can hover over or drag across. They adapt to the card width,
so they work on the phone app as well as on desktop.

`MEMORY.md` has the full background: how the heating logic works, design decisions,
and problems already solved. Read it before changing anything substantial.

## Contents

- [Repo layout](#repo-layout)
- [Requirements](#requirements)
- [Installing a card](#installing-a-card)
- [Installing a package](#installing-a-package)
- [Cards](#cards)
- [Dashboards](#dashboards)
- [Packages and automations](#packages-and-automations)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Repo layout

The folders mirror where each file goes in Home Assistant.

```text
cards/        custom card JavaScript      → /config/www/
dashboards/   dashboard and card YAML     → pasted into the dashboard editors
packages/     YAML packages               → /config/packages/
MEMORY.md     background, decisions and gotchas
```

| Card | File | Resource URL | Dashboard YAML | Needs |
|---|---|---|---|---|
| Appliance dial | `cards/appliance-dial-card.js` | `/local/appliance-dial-card.js?v=6` | (House view) | Washing machine / dryer integration |
| Heating dial, rooms and stats | `cards/heating-dial-card.js` | `/local/heating-dial-card.js?v=4` | `dashboards/heating-dashboard.yaml` | `packages/hive_call_for_heat.yaml`, Better Thermostat, Hive |
| Waste collection | `cards/waste-collection-card.js` | `/local/waste-collection-card.js?v=3` | `dashboards/waste-section.yaml` | Waste Collection Schedule |
| Motion activity | `cards/motion-activity-card.js` | `/local/motion-activity-card.js?v=2` | `dashboards/camera-cards.yaml` | UniFi Protect |
| Climate overview | `cards/climate-overview-card.js` | `/local/climate-overview-card.js?v=1` | (House view) | Temperature, humidity and lux sensors |
| Weather forecast | `cards/weather-forecast-card.js` | `/local/weather-forecast-card.js?v=1` | `dashboards/outdoor-cards.yaml` | Google Weather |
| Air quality | `cards/air-quality-card.js` | `/local/air-quality-card.js?v=1` | `dashboards/outdoor-cards.yaml` | Google Air Quality |
| Travel time | `cards/travel-time-card.js` | `/local/travel-time-card.js?v=1` | `dashboards/outdoor-cards.yaml` | Google Maps Travel Time, `packages/travel_time_refresh.yaml` |
| Energy usage | `cards/energy-usage-card.js` | `/local/energy-usage-card.js?v=1` | `dashboards/energy-card.yaml` | Energy sensors with long-term statistics |
| Dehumidifier | `cards/dehumidifier-card.js` | `/local/dehumidifier-card.js?v=2` | `dashboards/dehumidifier-card.yaml` | A `humidifier.*` entity (Tuya Arete Two here) |
| Lighting | `cards/lighting-card.js` | `/local/lighting-card.js?v=1` | `dashboards/lighting-dashboard.yaml` | Lights assigned to areas (and areas to floors) |

| Package | File | What it does |
|---|---|---|
| Hive call for heat | `packages/hive_call_for_heat.yaml` | Fires the boiler when any room needs heat; whole-house presets and Boost |
| Travel time refresh | `packages/travel_time_refresh.yaml` | Refreshes the travel sensors every 15 min, 06:00–20:00, to stay in Google's free tier |

## Requirements

- Home Assistant with the **recorder** running (the default). Every graph reads
  history or long-term statistics from it.
- Integrations, depending on the cards you use:
  - **Hive** (core) and **Better Thermostat** (HACS) for heating
  - **Waste Collection Schedule** (HACS) for bins
  - **UniFi Protect** (core) for cameras and detections
  - **Google Weather**, **Google Air Quality** and **Google Maps Travel Time** (core)
    for the outdoor cards
- A way to copy files into `/config`: the **File editor** or **Samba share** add-on,
  or SSH. In File editor, `/config` is shown as `/homeassistant`.

## Installing a card

Do this once per card file.

1. Copy the file from `cards/` to `/config/www/`. Create the `www` folder if it doesn't
   exist, then restart Home Assistant once so it starts serving `/local/`.
2. Go to **Settings → Dashboards → ⋮ (top right) → Resources → Add resource**.
3. Enter the URL from the table above, e.g. `/local/weather-forecast-card.js?v=1`,
   choose **JavaScript module**, and save.
4. Refresh the browser (on the phone app: **Settings → Companion app → Debugging →
   Reset frontend cache**, then close and reopen the app).
5. Add the card. Edit a dashboard → **Add card** → **Manual**, and paste the YAML from
   the card's section below or from the matching file in `dashboards/`.

Always use the relative `/local/...` URL. An absolute one such as
`http://homeassistant.local:8123/local/...` only works on your home network, so the
card shows "Configuration error" on the phone when you're away.

## Installing a package

1. Make sure `configuration.yaml` has this, once, under a single `homeassistant:` key:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

2. Copy the file from `packages/` to `/config/packages/`.
3. **Developer tools → YAML → Check configuration**, then restart Home Assistant.
   New helpers (`input_*`, `timer`) need a full restart the first time, not just a
   YAML reload.

## Cards

### Appliance dial (`custom:appliance-dial-card`)

A thermostat-style dial for the washing machine and tumble dryer: cycle progress on
the arc, phase and time left in the middle, and start / pause / stop buttons.
Optional control tiles and an energy graph. Every other card copies its look.

```yaml
type: custom:appliance-dial-card
name: Washing Machine
state_entity: select.washing_machine              # required: operating state select
completion_entity: sensor.washing_machine_completion_time
# select_entity: select.washing_machine_programme  # optional bottom pill
# controls:                                        # optional tiles: switches, selects, numbers, sensors
#   - switch.washing_machine_child_lock
# graph:                                           # optional energy chart
#   entity: sensor.washing_machine_energy
#   period: day                                    # hour, day, week or month
```

### Heating (`custom:heating-dial-card`, `custom:heating-rooms-card`, `custom:heating-stats-card`)

Three cards in one file. They need `packages/hive_call_for_heat.yaml`.

- **heating-dial-card**, whole-house mode (no `entity`): one dial sets every Better
  Thermostat room. Coloured preset tiles (Comfort, Eco, Sleep, Away, Boost, Off),
  each with its own −/+. Boost also has −/+ for its length. Below them are the boiler
  status and the room list.
- **heating-dial-card**, room mode (`entity: climate.<room>`): that room's dial,
  temperature, humidity, power and preset picker.
- **heating-rooms-card**: a dial for every Better Thermostat room. With `history: true`,
  each dial gets a history panel beside it.
- **heating-stats-card**: house or room history with boiler-on or valve-open periods
  shaded, cycle stats, warm-up and cool-down rates, and heat-loss coefficient (needs
  `outdoor_entity`).

```yaml
type: custom:heating-dial-card
show_name: false
boiler_entity: climate.turnuptheheat
# preset_colors: { eco: "#43a047" }   # optional, override a preset colour
```

The full dashboard (Whole house, Rooms and Dehumidifier views) is in
`dashboards/heating-dashboard.yaml`.

### Waste collection (`custom:waste-collection-card`)

The next collection day with every bin going out, a countdown and a "Put out tonight"
pill. Below that, each other bin with its next date. It finds Waste Collection
Schedule sensors by itself, or reads a calendar.

```yaml
type: custom:waste-collection-card
entities:
  - entity: sensor.waste_collection_schedule_food_waste
    name: Food Waste
  - entity: sensor.waste_collection_schedule_non_recyclable_rubbish
    name: Non-recyclable rubbish
    color: "#9aa0a6"
# calendar: calendar.waste_collection_schedule   # alternative to entities
# reminder_text: Put out tonight
```

The full section is in `dashboards/waste-section.yaml`.

### Motion activity (`custom:motion-activity-card`)

UniFi Protect detections as activity rather than a thin timeline. It shows a camera
snapshot (tap for live), what is being detected now, counts per type, an hourly chart
or heat strip, and recent detections.

```yaml
type: custom:motion-activity-card
title: Front door
camera_entity: camera.front_door_high_resolution_channel
url: https://cloud-key.mothership.sm4rt.io/protect/
hours: 24
entities:
  - binary_sensor.front_door_motion
  - binary_sensor.front_door_person_detected
```

The front door and car park cards are in `dashboards/camera-cards.yaml`.

### Climate overview (`custom:climate-overview-card`)

Inside and outside temperature, humidity and light in one card. Each tile shows a
1-hour trend, low and high, comfort level and dew point, or sunrise and sunset. One
graph combines them all.

```yaml
type: custom:climate-overview-card
inside: sensor.house_average_temperature
outside: sensor.annex_parking_sensor_temperature
humidity: sensor.house_average_humidity
light: sensor.annex_parking_sensor_illuminance
```

### Weather forecast (`custom:weather-forecast-card`)

Current conditions with a plain-English outlook ("Rain likely from 15:00", frost risk)
and six stats: wind, rain, UV, humidity, pressure trend and visibility. The hourly
graph shows temperature coloured by warmth, feels-like, rain-chance bars, and icons
and wind arrows. The daily view shows range bars. It reads `sensor.<prefix>_*`
sensors when they exist, otherwise the weather entity's own attributes.

```yaml
type: custom:weather-forecast-card
entity: weather.bergholt_road
# prefix: sensor.bergholt_road   # default: sensor.<weather object id>
# hours: 24
# view: hourly                   # or daily
```

### Air quality (`custom:air-quality-card`)

A UK DAQI gauge (1–10) with health advice, Universal AQI and the main pollutant.
Pollutant tiles each show a value, its DAQI band and a sparkline. The history graph
shows DAQI columns and a UAQI line; dragging across it rewinds the tiles to that
time. The bands use the current reading rather than the official running averages,
so treat them as a guide.

```yaml
type: custom:air-quality-card
prefix: sensor.bergholt_road
# ranges: [24, 72, 168]
```

### Travel time (`custom:travel-time-card`)

A tile per route with time now, the difference from usual for this time of day,
arrival time and distance. The Today graph compares today against the usual range
from the last 14 days of the same kind (weekday or weekend) and suggests the best
time to leave in the next 3 hours. The Week graph shows every route. Install
`packages/travel_time_refresh.yaml` too (see below).

```yaml
type: custom:travel-time-card
entities:
  - entity: sensor.google_travel_time
    name: Work
  - entity: sensor.work_besafety
    name: BeSafety
days: 14
```

Usual times need a couple of days of history before they appear.

### Energy usage (`custom:energy-usage-card`)

Energy and cost per period with the change against the previous period, and a share
per appliance. Each appliance tile shows its runs and energy per run, last run, and a
"running now" badge when a power sensor is found. The stacked bar graph covers 24 h,
7 d, 30 d or 12 months. "When they run" shows usage by hour of day and by weekday,
with the off-peak share. The sensors need state class `total` or `total_increasing`,
as the energy dashboard does.

```yaml
type: custom:energy-usage-card
entities:
  - entity: sensor.washing_machine_energy
    name: Washing Machine
  - entity: sensor.tumble_dryer_energy
    name: Tumble Dryer
# price: 0.245                    # £/kWh, or a rate sensor
# off_peak: ["00:30", "07:30"]
# range: 30d                      # 24h, 7d, 30d or 12m
```

### Dehumidifier (`custom:dehumidifier-card`)

A dial like the heating one: the big number is the target humidity, the dot is the
room's humidity now, and the arc fills from the target to the top of the range.
−/+ change the target (taps are grouped, so several quick taps send one change),
and the middle button turns it on or off. Red banners appear for a full tank or a
fault, and an amber one while it defrosts. Tiles show the water tank, the timer
(with an estimated end time) and the child lock. The graph shows humidity, target
and running periods, with red marks when the tank was full. Below it are running
time, humidity range, time on target and how often the tank filled.

```yaml
type: custom:dehumidifier-card
entity: humidifier.landing_arete_r_two_12l_dehumidifier_air_purifier
name: Landing dehumidifier
# step: 5                 # this model only takes multiples of 5
# temperature_entity: sensor.landing_temperature   # adds the dew point
# history: false          # dial and tiles only
# show_controls: false    # graph and stats only
```

The heating dashboard has a **Dehumidifier** view that uses both: the dial and tiles
on the left, a 3-day history and the fault sensors on the right.

The other entities (humidity sensor, timer, child lock, tank and fault sensors) are
found from the same device. The Tuya timer doesn't report the time left, so the end
time is worked out from when the timer was set and is wrong after a Home Assistant
restart.

### Lighting (`custom:lighting-card`)

Every light in the house, grouped by floor and room. A strip at the top shows how
many lights are on, how many are unavailable, and an **All off** button. Each floor
has its own **Off** button, and the Outside section shows the next sunset or sunrise.

Each room panel has:

- **A header tile for the room.** It controls the room's Hue room or HA light group
  if there is one, otherwise all of the room's lights. It shows "2 of 3 on" and the
  brightness.
- **Today's on-time**: a strip showing when any light in the room was on, and the
  total.
- **Scene and preset chips.** Hue scenes for the room come first, then Relax, Read,
  Bright and Night. Presets set each bulb's white to the nearest temperature it
  supports. The chip lights up when the room already matches the preset.
- **A tile per light**, tinted with the bulb's real colour and filled to its
  brightness.

On a tile or the room header:

- **Tap the icon** to toggle.
- **Drag sideways** to dim. Vertical swipes still scroll the page.
- **Tap anywhere else** to open the control sheet. It shows brightness, white
  temperature across that bulb's own Kelvin range, a colour wheel and swatches,
  effects and today's on-time, with only the controls the bulb supports. A room's
  sheet also lists its lights.

Unavailable lights are dimmed with an orange dot and sorted last. Tapping one opens
Home Assistant's more-info dialog.

Nothing has to be configured. Lights come from the area registry and rooms from the
floor registry, both in registry order. Areas with no floor go under **Outside**.

```yaml
type: custom:lighting-card
# outside_areas: [front_garden, front_door, alleyway, garden, driveway]
# areas: [library]                 # one room (no summary or floor header)
# floors: [ground_floor, outside]  # some floors; also accepts outside and other
# include: [switch.reading_lamp_plug]
# exclude: [light.hue_smart_plug_1]
# entities:                        # per light: name, icon, area, hide
#   switch.reading_lamp_plug: { area: library, icon: mdi:floor-lamp }
# presets: false                   # or a list of { name, icon, brightness, kelvin | hs_color }
# scenes: false
# history_hours: 24                # rolling window instead of "since midnight"
# history: false
```

Groups are worked out like this:

- A Hue room or zone (`is_hue_group`), or an HA light group (`entity_id` list),
  inside an area becomes that room's header.
- A group with no area takes the area of its members.
- A group that spans one floor, or is named after a floor (e.g. "Annex"), puts a
  tune button on that floor's header.
- Any other group is shown as an ordinary tile under **Other**.

## Dashboards

| File | How to use it |
|---|---|
| `dashboards/lighting-dashboard.yaml` | Create a dashboard (e.g. URL `dashboard-lighting`) → ✏️ → ⋮ → **Raw configuration editor** → replace everything with this file. One panel view with the lighting card at full width. |
| `dashboards/dehumidifier-card.yaml` | One **Manual** card. The heating dashboard also includes it, under Boiler and in its Dehumidifier view. |
| `dashboards/heating-dashboard.yaml` | Create a dashboard (URL must contain a hyphen, e.g. `dashboard-heating`) → ✏️ → ⋮ → **Raw configuration editor** → replace everything with this file. |
| `dashboards/outdoor-cards.yaml` | Three cards separated by `---`. Paste each one as a **Manual** card. |
| `dashboards/energy-card.yaml` | One **Manual** card. Replaces the statistics graph for the washing machine and dryer. |
| `dashboards/waste-section.yaml` | A section for the House view (Edit section → ⋮ → Edit in YAML). Kept for reference; the House view YAML now includes it. |
| `dashboards/camera-cards.yaml` | Two cards for the Property view. Kept for reference; the Property view YAML now includes them. |

When pasting into the card editor, don't start with `- ` (that is section list
syntax). The editor fails with `can't access property "startsWith"`.

## Packages and automations

### `packages/hive_call_for_heat.yaml` (v2.1)

Better Thermostat controls each radiator valve but never talks to the boiler. This
package fills the gap. When any room needs heat it sets Hive to 25 °C so the boiler
fires; otherwise it sets Hive to 12 °C, which also keeps frost protection if Home
Assistant stops. It also adds the whole-house presets, Boost with its own timer, and
a switch to pause boiler control.

- Turn **off** the schedule in the Hive app. Home Assistant must be the only scheduler.
- The first install sets every room to 21 °C (the Comfort default).
- Install as in [Installing a package](#installing-a-package); a full restart is needed.

### `packages/travel_time_refresh.yaml`

Google Maps Travel Time polls every 10 minutes per sensor, about 4,400 calls a month
each, and the Routes API gives 5,000 free calls a month. This automation updates both
sensors every 15 minutes from 06:00 to 20:00 instead, about 1,700 a month each.

1. Install as in [Installing a package](#installing-a-package).
2. Turn off the built-in polling, or both will run: **Settings → Devices & services →
   Google Maps Travel Time → ⋮ → System options → Enable polling for changes: off**.
3. Optionally set a daily cap of 161 or fewer requests for the Routes API in the
   Google Cloud console.

To change the hours or the interval, edit `minutes: "/15"` and the `after`/`before`
times.

## Updating

1. Edit the file here, raise the version in its header comment, and copy it over the
   old one in `/config/www/` or `/config/packages/`.
2. For a card, change the resource URL's `?v=` number to match (Settings → Dashboards
   → Resources). Without this, browsers and the phone app keep the old cached copy.
3. Update the version in the tables above and in `MEMORY.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Configuration error" / "Custom element doesn't exist" on the phone only | Reset the app's frontend cache (Settings → Companion app → Debugging), and check the resource URL is relative (`/local/...`). |
| Card still looks old after an update | The `?v=` number in the resource URL wasn't changed. |
| "Entity not found" on heating helpers | The package didn't load: wrong folder, a second `homeassistant:` key in `configuration.yaml`, or no full restart. |
| Graph says "Couldn't load history/statistics" | The recorder is off, or (energy card) the sensor has no state class. |
| Travel card shows no usual times | Needs a couple of days of history. With the refresh package, there is no data outside 06:00–22:00. |
