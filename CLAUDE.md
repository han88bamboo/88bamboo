# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Shopify theme for **88bamboo.co**, a drinks editorial site (whisky, sake, rum, tequila, craft beer, etc.) with an attached bottle shop. It is a heavily customized fork of Shopify's **Debut theme v16.4.0** — a "vintage" (pre-Online Store 2.0) theme: all templates are `.liquid` files, sections are statically included with `{% section %}`, and there are no JSON templates.

There is **no build, lint, or test tooling** in this repo — no package.json, no Shopify CLI config. Changes are made by editing Liquid/CSS/JS directly; the repo is synced to the live Shopify store (branch `main`), so edits to `main` reach production. To preview locally you'd need the Shopify CLI (`shopify theme dev --store <store>`) with store access.

## Architecture

Standard Shopify theme layout: `layout/` (global HTML shell), `templates/` (per-page-type entry points), `sections/`, `snippets/`, `assets/`, `config/`, `locales/`.

### Section cloning pattern (the big thing to understand)

Because static (vintage) sections carry exactly one settings instance each, reusable section designs are **duplicated as numbered files** so each placement can have its own merchant-editable settings: `hero.liquid` … `hero56`, `featured-blog2` … `featured-blog19`, `feature-columns2` … `12`, `feature-row2` … `12`, `editable-tile-1` … `8A`, `editable-section-*`. Suffixes tie clones to the page that uses them (e.g. `hero17-Whisky-101` … `hero28-Whisky-101` are used only by `templates/page.Whisky 101.liquid`; `hero30`–`39-CraftBeer101`, `hero41`–`48-Sake101`, etc.). When adding a new configurable block to a page, the convention is to copy an existing section to a new numbered file rather than reuse one already placed elsewhere. Section settings values live in `config/settings_data.json` (managed by the Shopify theme customizer — avoid hand-editing it).

### Alternate templates

Each resource type has many alternate templates assigned per-page/blog in Shopify admin:
- `page.<Topic>.liquid` — topic guide pages (Whisky 101, Sake, Gin, …), mostly thin wrappers that stack their dedicated hero sections around `page.content`.
- `blog.<name>.liquid` — one per editorial column (news, whiskyreviews, japan distilled, …), typically a hero section + `blog-template` section.
- Variants suffixed `-without-spurit_stp`, `hulkapps_backup`, `-hulkapps-backup` are backups/leftovers from third-party apps (HulkApps, Spurit) — don't delete or "clean up" without asking.
- Several filenames contain **spaces** (`page.Whisky 101.liquid`, `blog.bottoms up.liquid`) — always quote paths in shell commands.

### Homepage and articles

- `templates/index.liquid` is a hand-built editorial front page using the Bootstrap grid: it pulls latest articles across multiple blogs via `blogs[handle].articles`, finds a "Review Of The Week" by scanning a list of blog handles for a tagged article, and composes many `editable-tile-*` / `editable-section-*` / `featured-blog*` sections.
- Article pages (`templates/article.liquid`) compose granular sections: `article-title`, `article-content`, `article-contributor`, `article-comments`, `article-recommend-list`, plus advertising slots (`article-advertising-top-banner`, `article-side-advertising-area-*`, `article-bottom-advertising-area`). SEO structured data lives in `snippets/article-SEO-snippet.liquid`.
- Google AdSense is loaded conditionally for article templates in `layout/theme.liquid`; ad banner sections implement the placements.

### Frontend stack

- `layout/theme.liquid` loads **Bootstrap 4.6.2 and jQuery 3.7.1 from CDN** on top of Debut's own `assets/theme.js` and `assets/theme.scss.liquid` (~12k lines — the main stylesheet). Custom pages/sections use Bootstrap classes (`container`, `row`, `col-md-*`, `d-flex`); older Debut markup uses Shopify's `grid`/`grid__item` classes. Both systems coexist — match whichever the surrounding code uses.
- Custom edits are conventionally marked with HTML/Liquid comments like `<!-- added by Zhe Han ... -->`; keep that habit when modifying shared files like `theme.liquid`.
- `layout/theme.liquid` also holds site-wide SEO logic (noindex rules for the alternate homepage and tag pages, Pinterest verification).

### Third-party app residue

Snippets/assets from installed or formerly-installed apps: HulkApps (`hulk_po_vd`, `hulkcode_common`, cart backups), Booster currency (`booster-currency`, currency flag PNGs), Qikify smart menu (`qikify-smartmenu-data.js`), XenForum (`xenforum-*` sections), Spurit. Treat these as app-managed: don't modify or remove them as part of unrelated changes.
