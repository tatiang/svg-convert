# svg-convert

Web app that converts SVGs exported by [Laser Map Maker](http://lasermapmaker.com) into a format that drops cleanly into **xTool Studio** for the xTool P3.

Laser Map Maker emits each contour three times (stroked outline + inverse-fill mask hole + positive fill), and uses a single stroke color, so xTool Studio can't tell what to cut vs. score. This app:

1. Deduplicates the geometry (drops the canvas-mask rectangle and reversed-winding duplicates).
2. Splits the remaining contours into **cut** (red, `#FF0000`) and **score** (blue, `#0000FF`) by geometric nesting — a contour that contains another is the score guide for the next-higher layer; everything else is cut.
3. Lets you preview source vs. output and download the converted SVG.

Live: https://tatiang.github.io/svg-convert/

## Develop

```sh
npm install
npm run dev
```

## Build & deploy

`npm run build` outputs to `dist/`. Pushes to `main` trigger a GitHub Actions build that publishes to GitHub Pages.
