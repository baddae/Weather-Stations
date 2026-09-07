const MISSING = -9999;

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadStationIndex() {
  const [meta, stations] = await Promise.all([
    fetchJson("./data/meta.json"),
    fetchJson("./data/stations.json"),
  ]);
  return { meta, stations };
}

export async function loadTemperatureGrid(meta) {
  const expected = meta.nStations * meta.nMonths;
  const expectedBytes = expected * 2;

  const gzipped = await readBytes("./data/tavg.dat");
  if (gzipped.byteLength > 0) {
    const buffer = await gunzip(gzipped);
    if (buffer.byteLength === expectedBytes) {
      return new Int16Array(buffer);
    }
  }

  const raw = await readBytes("./data/tavg.bin");
  if (raw.byteLength === expectedBytes) {
    return new Int16Array(raw);
  }

  throw new Error(`Temperature file did not load (${raw.byteLength} bytes). Refresh the page.`);
}

async function readBytes(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

async function gunzip(buffer) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decompress station temperatures.");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function monthIndex(meta, year, month) {
  return (year - meta.startYear) * 12 + (month - 1);
}

export function indexToDate(meta, idx) {
  const year = meta.startYear + Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

export function readTemp(temps, meta, stationIndex, monthIdx) {
  const value = temps[stationIndex * meta.nMonths + monthIdx];
  return value === MISSING ? null : value / 100;
}

export function formatTemp(value) {
  return value == null ? "No Data" : value.toFixed(1);
}

export function searchStations(stations, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/[\s,_-]+/g, "");
  const scored = [];
  for (const station of stations) {
    const name = station.name.toLowerCase();
    const hay = `${name} ${station.id} ${station.legacyId || ""} ${station.province || ""}`.toLowerCase();
    let score = 0;
    if (station.legacyId && station.legacyId === query.trim()) score = 100;
    else if (station.id.toLowerCase() === q) score = 95;
    else if (name === q) score = 90;
    else if (name.startsWith(q)) score = 80;
    else if (hay.includes(q) || station.id.toLowerCase().includes(compact)) score = 60;
    if (score) scored.push({ station, score });
  }
  scored.sort((a, b) => b.score - a.score || a.station.name.localeCompare(b.station.name));
  return scored.slice(0, 20).map((row) => row.station);
}
