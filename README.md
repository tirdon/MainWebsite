# MySite

Personal portfolio with interactive physics demos and a seasonal mountain background.

## Local preview

```sh
bun run dev
```

This runs `bunx serve . --listen 3000`. Open <http://localhost:3000> and refresh after editing. The site uses native browser modules and needs no build step.

Run `bun run check` to validate page assets, module imports, and the Firebase publish paths. GitHub runs this check for every pull request and before deploying `main`. Pull requests from branches in this repository receive a seven-day Firebase preview after validation; fork and Dependabot pull requests receive validation only. The workflows use the existing `FIREBASE_SERVICE_ACCOUNT_THIRADONIUS` repository secret.

## Source layout

```text
index.html                         Portfolio page
404.html                           Error page
assets/
  css/
    site.css                       Shared site styles
    not-found.css                  Error-page styles
  js/
    main.js                        Browser entry point
    core/
      runtime.js                   Viewport, playback, canvas helpers
      webgpu.js                    Shared GPU device and shader helper
    ui/
      theme.js                     Light/dark theme (also used by 404)
      site.js                      Navigation, reveals, gestures, filters
      cv.js                        Download Resume: page tags → Typst → PDF
    backgrounds/
      game-of-life.js               Hero background
      mountain/
        renderer.js                GPU setup, draw calls, animation lifecycle
        shaders.js                 WGSL lighting and animation shaders
        terrain.js                 Height map, terrain mesh, noise
        models.js                  Trees, rocks, grass, fox/rabbit meshes
        placement.js               Scenery distribution and clearings
        math.js                    Camera matrices and clamping
        fallback.js                Canvas 2D landscape and wildlife
    simulations/
      wildlife.js                  Predator–prey behavior, independent of rendering
      physics/                     One module per interactive physics demo
        index.js                   Loads the eight physics demos
      complex-systems.js           Fixed-point, percolation, and network demos
firebase.json                      Hosting configuration
scripts/check-site.js              Local and CI validation (excluded from Hosting)
```

Existing images and documents retain their paths in `assets/`. Modules import their dependencies directly; the portfolio loads only `assets/js/main.js`. Both the GPU and fallback landscapes use the same wildlife simulation. Playback respects the site's pause control, reduced-motion preference, and page visibility.

## Resume download

“Download Resume” builds an A4 PDF in the visitor's browser; there is no PDF file to maintain.

- **Wording** comes from the tags in `index.html`: the hero name, subtitle and visible statement, `#skills`, `#experience`, `#education`, and the contact links in the footer. Edit a sentence there and the next download carries it. Extracurricular activities, projects, interests, hobbies and personal data are left out.
- **Layout** is `assets/cv/cv.typ`, a [Typst](https://typst.app/docs) template that reads the collected text as `cv.json`.
- **Compiler**: `assets/js/ui/cv.js` loads the Typst WebAssembly compiler (about 9 MB compressed, cached afterwards) and four New Computer Modern fonts from jsDelivr on the first press. The loader in `assets/vendor/typst/` must match the version in `cv.js`.

## Add your links

Search `index.html` for `data-link-placeholder`. Add an `href` to the matching anchor when its destination is ready:

```html
<a class="text-link" data-link-placeholder="graphwar-source"
   href="https://github.com/YOUR_USERNAME/YOUR_REPOSITORY">Source code</a>
```

The link becomes active and its “Coming soon” label disappears automatically. Keep the `data-link-placeholder` attribute so the entry remains easy to find. Leave out `href` until the URL is ready; an empty URL or `#` would create an active link without a useful destination.

| Document or project | Placeholder keys |
| --- | --- |
| Employment certificate | `employment-certificate` |
| Recommendation letter | `recommendation-letter` |
| Graphwar Parser | `graphwar-demo`, `graphwar-source` |
| Interactive Physics UI | `physics-source` (the simulation link already works) |
| IoT Irrigation Controller | `irrigation-details`, `irrigation-source` |
| Storyboard ECS Framework | `storyboard-demo`, `storyboard-source` |
| Character Deformer | `deformer-demo`, `deformer-source` |
| Embedded Swift Interop | `interop-docs`, `interop-source` |

For a downloadable document, put the file in `assets/` and use its real path as the `href`. Run `bun run check` after adding local files to confirm they will be included in the published site.
