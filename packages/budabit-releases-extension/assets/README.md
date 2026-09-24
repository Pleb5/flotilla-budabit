# Releases widget icon

Original package/download artwork for the Releases widget, under this project's MIT license. The amber package and download badge sit on a charcoal rounded tile, with transparent corners. The mark identifies software releases/downloads; it is not a security certification.

- [`releases-icon.svg`](./releases-icon.svg): editable, self-contained vector source; no scripts, fonts, or external resources.
- [`releases-icon.png`](./releases-icon.png): 512 × 512 PNG used in the widget manifest for consistent image rendering across clients.
- [Hosted PNG](https://blossom.budabit.club/1bff8e9625479d94b37d6003c597445cc892c65154845c16d7e8dc24a8a553dd.png)
- PNG SHA-256: `1bff8e9625479d94b37d6003c597445cc892c65154845c16d7e8dc24a8a553dd`

To regenerate the PNG from the repository root with an installed `rsvg-convert`:

```sh
rsvg-convert --width 512 --height 512 assets/releases-icon.svg --output assets/releases-icon.png
sha256sum assets/releases-icon.png
```

Changing the image requires uploading the new PNG and updating the default URL in `package.json`. The manifest regression checks that the URL's hash matches the checked-in PNG. `WIDGET_ICON_URL` can override that default when generating a manifest. Rasterizer versions may produce different PNG bytes; use the actual exported file's hash.

The icon has been visually checked at 40 px (the widget settings listing), 24 px, and 16 px on light and dark preview surfaces. The SVG/PNG are independent of the widget HTML, so updating this artwork does not require rebuilding or uploading the app bundle. Publication still requires explicit authorization.
