import "./style.css";
import * as maplibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const maplibregl = maplibre.default ?? maplibre;
import {
  formatTemp,
  indexToDate,
  loadStationIndex,
  loadTemperatureGrid,
  monthIndex,
  readTemp,
  searchStations,
} from "./data.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SPEED_MS = {
  slow: 400,
  normal: 200,
  fast: 80,
};

const BASE_STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
    },
  },
  layers: [
    { id: "basemap", type: "raster", source: "basemap" },
    { id: "labels", type: "raster", source: "labels" },
  ],
};

const state = {
  meta: null,
  stations: null,
  temps: null,
  lastPacked: null,
  monthIdx: 0,
  playing: false,
  timer: null,
  speed: "normal",
  selected: null,
  mapReady: false,
};

const els = {
  search: document.getElementById("search"),
  results: document.getElementById("search-results"),
  slider: document.getElementById("slider"),
  ticks: document.getElementById("year-ticks"),
  play: document.getElementById("play"),
  speed: document.getElementById("speed"),
  clock: document.getElementById("clock-label"),
  selectedTemp: document.getElementById("selected-temp"),
  status: document.getElementById("status"),
  label: document.getElementById("station-label"),
};

let map;

function toGeoJSON(stations) {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => ({
      type: "Feature",
      id: station.i,
      properties: {
        i: station.i,
        name: station.name,
        id: station.id,
        legacyId: station.legacyId || "",
      },
      geometry: { type: "Point", coordinates: [station.lon, station.lat] },
    })),
  };
}

function hideStatus() {
  els.status.hidden = true;
}

function applyMonth() {
  const { meta, temps, monthIdx, lastPacked, mapReady } = state;
  if (!temps || !mapReady) {
    updateClock();
    return;
  }

  for (const station of state.stations) {
    const value = readTemp(temps, meta, station.i, monthIdx);
    const packed = value == null ? -32768 : Math.round(value * 10);
    if (lastPacked[station.i] === packed) continue;
    lastPacked[station.i] = packed;
    map.setFeatureState(
      { source: "stations", id: station.i },
      { on: value == null ? 0 : 1, t: value ?? -999 },
    );
  }

  updateClock();
  els.slider.value = String(monthIdx);
  refreshSelection();
}

function updateClock() {
  if (!state.meta) return;
  const { year, month } = indexToDate(state.meta, state.monthIdx);
  els.clock.textContent = `${MONTHS[month - 1]} ${year}`;
}

function setMonth(idx) {
  state.monthIdx = Math.max(0, Math.min(state.meta.nMonths - 1, idx));
  applyMonth();
}

function playDelay() {
  return SPEED_MS[state.speed] ?? SPEED_MS.normal;
}

function startPlayback() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (state.monthIdx >= state.meta.nMonths - 1) {
      togglePlay();
      return;
    }
    setMonth(state.monthIdx + 1);
  }, playDelay());
}

function togglePlay() {
  state.playing = !state.playing;
  els.play.textContent = state.playing ? "Pause" : "Play";
  if (state.playing) {
    startPlayback();
  } else if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function renderYearTicks() {
  if (!state.meta || !els.ticks) return;
  const { startYear, nMonths } = state.meta;
  const endYear = startYear + Math.floor((nMonths - 1) / 12);
  const firstMark = Math.ceil(startYear / 20) * 20;
  const marks = [];
  for (let year = firstMark; year <= endYear; year += 20) marks.push(year);
  els.ticks.replaceChildren(
    ...marks.map((year) => {
      const monthIdx = monthIndex(state.meta, year, 1);
      const tick = document.createElement("span");
      tick.textContent = String(year);
      tick.style.left = `${(monthIdx / (nMonths - 1)) * 100}%`;
      return tick;
    }),
  );
}

function selectStation(station, fly = true) {
  state.selected = station;
  if (fly && map) {
    map.flyTo({ center: [station.lon, station.lat], zoom: 5.4, duration: 900 });
  }
  refreshSelection();
}

function refreshSelection() {
  const station = state.selected;
  if (!station || !map) {
    els.label.hidden = true;
    els.selectedTemp.textContent = "";
    return;
  }

  const value = state.temps ? readTemp(state.temps, state.meta, station.i, state.monthIdx) : null;
  const { year, month } = indexToDate(state.meta, state.monthIdx);
  const when = `${MONTHS[month - 1]} ${year}  ${formatTemp(value)}°C`;

  els.label.hidden = false;
  els.label.replaceChildren();
  const nameLine = document.createElement("strong");
  nameLine.textContent = station.name;
  const valueLine = document.createElement("span");
  valueLine.textContent = when;
  els.label.append(nameLine, valueLine);
  els.selectedTemp.textContent = when;

  const point = map.project([station.lon, station.lat]);
  els.label.style.left = `${point.x}px`;
  els.label.style.top = `${point.y}px`;
}

function renderResults(stations) {
  if (!stations.length) {
    els.results.hidden = true;
    els.results.innerHTML = "";
    return;
  }
  els.results.hidden = false;
  els.results.innerHTML = stations
    .map((station) => {
      const id = station.legacyId || station.id;
      return `<li><button type="button" data-id="${station.id}"><strong>${station.name}</strong><small>${id}</small></button></li>`;
    })
    .join("");
}

function addStationLayer(stations) {
  if (map.getSource("stations")) return;
  map.addSource("stations", {
    type: "geojson",
    data: toGeoJSON(stations),
    promoteId: "i",
  });
  map.addLayer({
    id: "stations-circles",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2.6, 6, 6, 10, 9],
      "circle-stroke-width": 0.6,
      "circle-stroke-color": "#102030",
      "circle-opacity": [
        "case",
        ["==", ["feature-state", "on"], 1],
        0.92,
        ["==", ["feature-state", "on"], 0],
        0,
        0.35,
      ],
      "circle-stroke-opacity": [
        "case",
        ["==", ["feature-state", "on"], 1],
        0.7,
        ["==", ["feature-state", "on"], 0],
        0,
        0.2,
      ],
      "circle-color": [
        "interpolate",
        ["linear"],
        ["coalesce", ["feature-state", "t"], -999],
        -40,
        "#08306b",
        -20,
        "#6baed6",
        0,
        "#ffffbf",
        15,
        "#fd8d3c",
        30,
        "#7f0000",
      ],
    },
  });
  state.mapReady = true;
  state.lastPacked = new Int16Array(stations.length).fill(-32767);
  setMonth(monthIndex(state.meta, 1880, 1));
}

function setupMap(stations) {
  map = new maplibregl.Map({
    container: "map",
    style: BASE_STYLE,
    center: [-96, 58],
    zoom: 3.1,
    attributionControl: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

  const start = () => {
    addStationLayer(stations);
    hideStatus();
    try {
      map.setProjection({ type: "globe" });
    } catch {
      // Mercator is fine if globe is unavailable.
    }
  };

  if (map.loaded()) start();
  else map.once("load", start);

  map.on("error", (event) => {
    console.warn("Map error", event.error);
    hideStatus();
  });
  map.on("click", "stations-circles", (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const station = state.stations.find((item) => item.i === feature.id);
    if (station) selectStation(station, false);
  });
  map.on("mouseenter", "stations-circles", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "stations-circles", () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("move", refreshSelection);
}

function setupEvents() {
  els.search.addEventListener("input", () => {
    renderResults(searchStations(state.stations, els.search.value));
  });
  els.results.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const station = state.stations.find((item) => item.id === button.dataset.id);
    els.results.hidden = true;
    els.search.value = station.name;
    selectStation(station);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) els.results.hidden = true;
  });
  els.slider.addEventListener("input", () => setMonth(Number(els.slider.value)));
  els.play.addEventListener("click", togglePlay);
  els.speed.addEventListener("change", () => {
    state.speed = els.speed.value;
    if (state.playing) startPlayback();
  });
  document.getElementById("step-back").addEventListener("click", () => setMonth(state.monthIdx - 1));
  document.getElementById("step-forward").addEventListener("click", () => setMonth(state.monthIdx + 1));
  document.addEventListener("keydown", (event) => {
    if (event.target === els.search) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowLeft") setMonth(state.monthIdx - 1);
    else if (event.key === "ArrowRight") setMonth(state.monthIdx + 1);
  });
}

async function init() {
  try {
    els.status.textContent = "Loading stations…";
    const { meta, stations } = await loadStationIndex();
    state.meta = meta;
    state.stations = stations;
    els.slider.max = String(meta.nMonths - 1);
    renderYearTicks();
    els.status.textContent = "Drawing map…";
    setupMap(stations);
    setupEvents();

    hideStatus();

    try {
      els.status.hidden = false;
      els.status.textContent = "Loading temperatures…";
      state.temps = await loadTemperatureGrid(meta);
      if (state.mapReady) {
        state.lastPacked.fill(-32767);
        setMonth(monthIndex(meta, 1880, 1));
      }
      hideStatus();
    } catch (tempError) {
      console.error(tempError);
      els.status.hidden = false;
      els.status.textContent = `${tempError.message} The map is ready — refresh if temperatures do not appear.`;
    }
  } catch (error) {
    els.status.textContent = `Could not start the map: ${error.message}`;
    console.error(error);
  }
}

init();
