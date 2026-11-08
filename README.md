# fridgeup.app

Website of FridgeUp!, served by GitHub Pages (custom domain in `CNAME`).

## How it is built

- `src/home.html`, `src/support.html` (+ `src/support.js`): editable design sources. They render in the browser through the runtime.
- `node tools/build.mjs` turns them into plain static pages, one per language (EN at `/`, then `/it/ /de/ /fr/ /es/ /pt/`, and `support/` under each), plus `sitemap.xml`, `robots.txt` and the `supporto.html` redirect.
- The generated files are committed. After changing anything in `src/` (or the SEO texts at the top of `tools/build.mjs`), run the build and commit the result.

Each page has its own `<title>`, description, `canonical`, `hreflang` links, `<html lang>` and structured data. The language switcher is made of normal links.
