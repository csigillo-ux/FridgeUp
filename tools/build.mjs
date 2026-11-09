#!/usr/bin/env node
// Static site generator for fridgeup.app
//
// Reads the editable design sources in src/ (src/home.html, src/support.html),
// which render client-side through src/support.js, and writes plain static
// HTML pages, one per language, so that search engines see real text, titles,
// canonical and hreflang tags without running JavaScript.
//
//   node tools/build.mjs
//
// Output (committed to the repo, served by GitHub Pages):
//   /index.html            + /support/index.html            (English)
//   /it/ /de/ /fr/ /es/ /pt/  + the same under each language
//   /sitemap.xml  /robots.txt  /supporto.html (redirect stub)
//
// No dependencies. Needs Node 18+.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://fridgeup.app";
const LANGS = ["en", "it", "de", "fr", "es", "pt"];
const APPLE_APP_ID = "6779924343";
const OG_LOCALE = { en: "en_GB", it: "it_IT", de: "de_DE", fr: "fr_FR", es: "es_ES", pt: "pt_PT" };

// ---------- per-language SEO text (home page) ----------
// English title and description are the ones already used on the live site.
// The other languages are translations of them: please have a native speaker read them.
const HOME_SEO = {
  en: {
    title: "FridgeUp! — Track expiry dates, waste less food",
    description: "FridgeUp! keeps track of expiry dates and warns you before food goes bad. Scan a barcode or photograph the date. Free on iOS and Android.",
    ogTitle: "FridgeUp! — No more food thrown away because you forgot",
    ogDescription: "Expiry dates tracked, notifications in time. Free on iOS and Android."
  },
  it: {
    title: "FridgeUp! — Controlla le scadenze, butta via meno cibo",
    description: "FridgeUp! tiene traccia delle scadenze alimentari e ti avvisa prima che il cibo vada a male. Scansiona il codice a barre o fotografa la data. Gratis su iOS e Android."
  },
  de: {
    title: "FridgeUp! — Ablaufdaten im Blick, weniger im Müll",
    description: "FridgeUp! behält Ablaufdaten im Blick und warnt dich, bevor Lebensmittel schlecht werden. Barcode scannen oder Datum fotografieren. Kostenlos für iOS und Android."
  },
  fr: {
    title: "FridgeUp! — Suis les dates de péremption, gaspille moins",
    description: "FridgeUp! suit les dates de péremption et te prévient avant que les aliments ne se gâtent. Scanne le code-barres ou photographie la date. Gratuit sur iOS et Android."
  },
  es: {
    title: "FridgeUp! — Controla las caducidades, desperdicia menos",
    description: "FridgeUp! controla las fechas de caducidad y te avisa antes de que los alimentos se estropeen. Escanea el código de barras o fotografía la fecha. Gratis en iOS y Android."
  },
  pt: {
    title: "FridgeUp! — Controla as validades, desperdiça menos",
    description: "O FridgeUp! acompanha as datas de validade e avisa-te antes de os alimentos se estragarem. Lê o código de barras ou fotografa a data. Grátis no iOS e Android."
  }
};

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const homePath = (l) => (l === "en" ? "/" : `/${l}/`);
const supportPath = (l) => (l === "en" ? "/support/" : `/${l}/support/`);

function loadSource(file) {
  const html = fs.readFileSync(path.join(ROOT, "src", file), "utf8");
  const tplStart = html.indexOf("</helmet>") + "</helmet>".length;
  const tplEnd = html.indexOf("</x-dc>");
  if (tplStart < 20 || tplEnd < 0) throw new Error(`${file}: <helmet>/<x-dc> not found`);
  let template = html.slice(tplStart, tplEnd);

  const helmet = html.slice(html.indexOf("<helmet>") + 8, html.indexOf("</helmet>"));
  const css = (helmet.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];

  const scriptStart = html.indexOf(">", html.indexOf("data-dc-script")) + 1;
  const scriptEnd = html.indexOf("</script>", scriptStart);
  let code = html.slice(scriptStart, scriptEnd);
  code = code.slice(0, code.indexOf("class Component"));
  const data = vm.runInNewContext(
    code + "\n;({ S, REVIEWS: typeof REVIEWS !== 'undefined' ? REVIEWS : [], TRANS_NOTE: typeof TRANS_NOTE !== 'undefined' ? TRANS_NOTE : {} })"
  );
  return { template, css, ...data };
}

function resolve(scope, expr) {
  return expr.split(".").reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

function interpolate(text, scope) {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const v = resolve(scope, expr);
    if (v === undefined) throw new Error(`Unknown template value: ${expr}`);
    return esc(v);
  });
}

// Renders <sc-for> and <sc-if> blocks (possibly nested) and {{ }} values.
function render(tpl, scope) {
  let out = "";
  let i = 0;
  const re = /<(sc-for|sc-if)\b([^>]*)>/g;
  while (i < tpl.length) {
    re.lastIndex = i;
    const m = re.exec(tpl);
    if (!m) { out += interpolate(tpl.slice(i), scope); break; }
    out += interpolate(tpl.slice(i, m.index), scope);
    // find matching close tag
    const tag = m[1];
    const open = new RegExp(`<${tag}\\b`, "g");
    const close = `</${tag}>`;
    let depth = 1, pos = m.index + m[0].length;
    while (depth > 0) {
      const nextClose = tpl.indexOf(close, pos);
      if (nextClose < 0) throw new Error(`Unclosed <${tag}>`);
      open.lastIndex = pos;
      const nextOpen = open.exec(tpl);
      if (nextOpen && nextOpen.index < nextClose) { depth++; pos = nextOpen.index + 1; }
      else { depth--; pos = nextClose + close.length; if (depth === 0) var innerEnd = nextClose; }
    }
    const inner = tpl.slice(m.index + m[0].length, innerEnd);
    const attrs = m[2];
    if (tag === "sc-for") {
      const list = resolve(scope, attrs.match(/list="\{\{\s*([^}]+?)\s*\}\}"/)[1]);
      const as = attrs.match(/\bas="([^"]+)"/)[1];
      for (const item of list) out += render(inner, { ...scope, [as]: item });
    } else {
      const expr = attrs.match(/value="\{\{\s*([^}]+?)\s*\}\}"/)[1];
      if (expr === "isWide") out += `<div class="wide-only">${render(inner, scope)}</div>`;
      else if (resolve(scope, expr)) out += render(inner, scope);
    }
    i = pos;
  }
  return out;
}

// ---------- layout CSS replacing the runtime's JS-driven styles ----------
const EXTRA_CSS = `
.pill{display:inline-block;padding:6px 12px;border-radius:999px;border:none;background:transparent;color:#6a6f96;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;text-decoration:none}
.pill.on{background:rgba(255,255,255,.78);color:#1e2140;font-weight:600}
.pill.on.support{background:#eceaf6}
.hero-main{width:34%;max-width:400px;overflow:hidden;border-radius:18px;aspect-ratio:1290/2180;filter:drop-shadow(0 30px 60px rgba(30,33,64,.2))}
.hero-cta{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:24px 36px}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:clamp(16px,2.5vw,30px)}
.tile{margin:0}
.step-2{margin-left:clamp(16px,5vw,72px)}
.step-3{margin-left:clamp(32px,10vw,144px)}
.wide-only{display:contents}
.hv-op:hover{opacity:.85}
.hv-btn:hover{background:#2b2f5c!important;color:#fff!important}
@media (max-width:699px){
.hero-main{width:100%;max-width:380px;border-radius:16px;filter:drop-shadow(0 24px 50px rgba(30,33,64,.16))}
.hero-cta{flex-direction:column;flex-wrap:nowrap;gap:20px}
.gallery{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px;margin:0 calc(-1*clamp(20px,5vw,48px));padding-left:clamp(20px,5vw,48px);padding-right:clamp(20px,5vw,48px)}
.tile{flex:0 0 62%;scroll-snap-align:start}
.step-2,.step-3{margin-left:0}
.wide-only{display:none}
}
`;

function prepareTemplate(tpl, kind, lang) {
  let t = tpl;
  // style values that the runtime computed in JS -> classes
  t = t.replace('style="{{ heroCtaStyle }}"', 'class="hero-cta"');
  t = t.replace('style="{{ heroMainStyle }}"', 'class="hero-main"');
  t = t.replace('style="{{ galleryStyle }}"', 'class="gallery"');
  t = t.replace(/style="\{\{ tileStyle \}\}"/g, 'class="tile"');
  t = t.replace(
    /style="(display: flex; align-items: flex-start; gap: clamp\(16px, 2vw, 26px\);) margin-left: \{\{ s\.indent \}\};"/,
    'class="step step-{{ s.n }}" style="$1"'
  );
  // language buttons -> real links
  t = t.replace(
    /<button type="button" onClick="\{\{ set(\w+) \}\}" style="\{\{ pill\w+ \}\}">(\w+)<\/button>/g,
    (_, code, label) => {
      const l = code.toLowerCase();
      const href = kind === "home" ? homePath(l) : supportPath(l);
      const on = l === lang ? " on" : "";
      const sup = kind === "support" ? " support" : "";
      return `<a class="pill${on}${sup}" href="${href}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ""}>${label}</a>`;
    }
  );
  // hover styles
  t = t.replace(/<a ([^>]*?)\s*style-hover="([^"]*)"([^>]*)>/g, (_, a, hv, b) => {
    const cls = /opacity/.test(hv) ? "hv-op" : "hv-btn";
    return `<a class="${cls}" ${a}${b}>`;
  });
  // placeholder hints (design-tool only)
  t = t.replace(/\s+hint-placeholder-[a-z]+="[^"]*"/g, "");
  // paths: pages live in subfolders, so use absolute paths
  t = t.replace(/(src|href)="assets\//g, '$1="/assets/');
  t = t.replace(/href="supporto\.html"/g, `href="${supportPath(lang)}"`);
  t = t.replace(/href="index\.html"/g, `href="${homePath(lang)}"`);
  // hero screenshots had English-only alt text: use the translated captions
  t = t.replace('alt="Scan barcodes and dates"', 'alt="{{ cap2 }}"');
  t = t.replace('alt="Never miss an expiry date"', 'alt="{{ cap1 }}"');
  t = t.replace('alt="Smart notifications"', 'alt="{{ cap5 }}"');
  return t;
}

function alternates(pathFn) {
  const links = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}${pathFn(l)}" />`);
  links.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${pathFn("en")}" />`);
  return links.join("\n");
}

function jsonLd(lang, description) {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "FridgeUp!",
      applicationCategory: "LifestyleApplication",
      operatingSystem: "iOS, Android",
      description,
      inLanguage: lang,
      url: SITE + homePath(lang),
      image: `${SITE}/assets/icon.jpg`,
      installUrl: [
        `https://apps.apple.com/app/id${APPLE_APP_ID}`,
        "https://play.google.com/store/apps/details?id=com.csigillo.fridgeup"
      ],
      author: { "@type": "Person", name: "Carmelo Sigilló" },
      offers: { "@type": "Offer", price: "0", priceCurrency: "CHF" }
    },
    null,
    2
  );
}

function page({ lang, kind, title, description, ogTitle, ogDescription, canonicalPath, altFn, css, body, ld }) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}${canonicalPath}" />
${altFn ? alternates(altFn) : ""}
<link rel="icon" href="/assets/icon.jpg" />
<link rel="apple-touch-icon" href="/assets/icon.jpg" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="FridgeUp!" />
<meta property="og:title" content="${esc(ogTitle)}" />
<meta property="og:description" content="${esc(ogDescription)}" />
<meta property="og:image" content="${SITE}/assets/og-image.jpg" />
<meta property="og:url" content="${SITE}${canonicalPath}" />
<meta property="og:locale" content="${OG_LOCALE[lang]}" />
<meta name="twitter:card" content="summary_large_image" />
${kind === "home" ? `<meta name="apple-itunes-app" content="app-id=${APPLE_APP_ID}" />` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
${css.trim()}
${EXTRA_CSS.trim()}
</style>${ld ? `\n<script type="application/ld+json">\n${ld}\n</script>` : ""}
</head>
<body>
${body.trim()}
</body>
</html>
`;
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log("wrote", rel);
}

// ---------- build ----------
const home = loadSource("home.html");
const support = loadSource("support.html");

for (const lang of LANGS) {
  // home
  {
    const t = home.S[lang];
    const seo = HOME_SEO[lang];
    const reviews = home.REVIEWS.map((r) => {
      const copy = r[lang] || r.en || r[r.lang];
      const translated = r.lang !== lang;
      return {
        by: r.by,
        stars: "★".repeat(r.stars) + "☆".repeat(5 - r.stars),
        title: copy.title,
        body: copy.body,
        translated,
        note: translated ? (home.TRANS_NOTE[lang] || home.TRANS_NOTE.en)[r.lang] || "" : ""
      };
    });
    const scope = {
      lang, t, reviews, trust: t.trust, features: t.features,
      steps: t.steps, proItems: t.proItems,
      cap1: t.screens[0].caption, cap2: t.screens[1].caption, cap3: t.screens[2].caption,
      cap4: t.screens[3].caption, cap5: t.screens[4].caption, cap6: t.screens[5].caption,
      badgeApple: `/assets/appstore-${lang}.svg`,
      badgeGoogle: `/assets/googleplay-${lang}.svg`
    };
    const body = render(prepareTemplate(home.template, "home", lang), scope);
    const html = page({
      lang, kind: "home",
      title: seo.title, description: seo.description,
      ogTitle: seo.ogTitle || seo.title, ogDescription: seo.ogDescription || seo.description,
      canonicalPath: homePath(lang), altFn: homePath,
      css: home.css, body, ld: jsonLd(lang, seo.description)
    });
    write(lang === "en" ? "index.html" : `${lang}/index.html`, html);
  }
  // support
  {
    const t = support.S[lang];
    const scope = { lang, t, faq: t.faq };
    const body = render(prepareTemplate(support.template, "support", lang), scope);
    const title = `FridgeUp! — ${t.title}`;
    const description = lang === "en"
      ? "Help and frequently asked questions about FridgeUp!, the app that tracks expiry dates on iOS and Android."
      : t.intro;
    const html = page({
      lang, kind: "support", title, description, ogTitle: title, ogDescription: description,
      canonicalPath: supportPath(lang), altFn: supportPath, css: support.css, body
    });
    write(lang === "en" ? "support/index.html" : `${lang}/support/index.html`, html);
  }
}

// Old support URL (may be linked from the stores): keep it working.
write("supporto.html", `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FridgeUp! — Support</title>
<link rel="canonical" href="${SITE}/support/" />
<meta http-equiv="refresh" content="0; url=/support/" />
<meta name="robots" content="noindex" />
</head>
<body>
<p><a href="/support/">FridgeUp! — Support</a></p>
</body>
</html>
`);

// sitemap with hreflang alternates
const urls = [];
for (const fn of [homePath, supportPath]) {
  for (const l of LANGS) {
    const alts = LANGS.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${SITE}${fn(a)}"/>`);
    alts.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${fn("en")}"/>`);
    urls.push(`  <url>\n    <loc>${SITE}${fn(l)}</loc>\n${alts.join("\n")}\n  </url>`);
  }
}
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`);

write("robots.txt", `User-agent: *
Allow: /
Disallow: /get/

Sitemap: ${SITE}/sitemap.xml
`);
