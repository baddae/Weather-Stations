# Canada Climate Stations

A browser-based replacement for the retired [Climate Station Visualizer](http://thesis.allenkoren.com/) used in the Columbia College climate trends lab. Students can search Canadian weather stations, move a monthly time slider, and read January/July temperatures for the assignment table.

## Student use

Open the hosted GitHub Pages URL in Chrome. Search `Churchill` or `403719130000`, then use the slider (or **−10y** / **+10y**) to record January and July every 10 years from 1880 to 2010. If the station dot is missing, write **No Data**.

Keyboard: spacebar plays and pauses; arrow keys step one month.

## Run locally

```bash
python scripts/build_data.py
npm install
npm run dev
```

Then open the Vite URL (default http://localhost:5173).

## Data

`scripts/build_data.py` downloads NOAA GHCN-Monthly v4 unadjusted mean temperatures, keeps Canadian stations, and writes:

- `public/data/stations.json` — names, IDs, coordinates
- `public/data/tavg.dat` — gzip-compressed monthly means
- `public/data/meta.json` — grid start/end and lab ID map

The four lab IDs from the old globe are mapped to long composite series:

| Lab ID | Station |
|---|---|
| 403719130000 | Churchill |
| 403718690000 | Prince Albert |
| 403716000000 | Sable Island |
| 403718360000 | Moosonee |

Mean temperature is available now. Maximum and minimum are reserved in the UI for a later GHCN-Daily build.

## Publish on Netlify

The station files in `public/data/` are copied into the built site. Students do not download them separately.

**Option A — connect this GitHub repo:** in Netlify, add the repository. Build command is `npm run build` and the publish folder is `dist` (`netlify.toml` already sets this).

**Option B — drag and drop:** run `npm run build` locally, then drop the `dist` folder onto [Netlify Drop](https://app.netlify.com/drop). Do not upload the project root; `src/` and the raw data scripts are not a website by themselves.

## Publish on GitHub Pages

```bash
npm run build
```

Enable Pages on the `dist` folder, or use the GitHub Pages action with `peaceiris/actions-gh-pages`. The Vite `base` is `./`, so the site also works as a project page.

## Attribution

Station temperatures: NOAA National Centers for Environmental Information, GHCN-Monthly v4. Map tiles: OpenFreeMap / OpenStreetMap contributors. The original globe UX was introduced by Allen Koren’s Climate Station Visualizer.
