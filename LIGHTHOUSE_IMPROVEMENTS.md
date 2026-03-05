# Lighthouse Improvement Plan

> Initial scores: Performance 56, Accessibility 83, Best Practices 74, SEO 83

## v6 Results (production build — FINAL)

| Category | v1 (dev) | v6 (prod) | Change |
|---|---|---|---|
| Performance | 56 | **100** | +44 ✅ |
| Accessibility | 83 | **100** | +17 ✅ |
| Best Practices | 74 | 78 | +4 |
| SEO | 83 | **100** | +17 ✅ |

### v6 remaining Best Practices failures (all require HTTPS + server headers)
- Does not use HTTPS → nginx/Caddy with valid cert
- Does not redirect HTTP to HTTPS → nginx redirect
- No CSP header → `Content-Security-Policy` response header
- No HSTS → `Strict-Transport-Security` response header
- No COOP → `Cross-Origin-Opener-Policy` response header
- No XFO → `X-Frame-Options` response header
- No Trusted Types → `Content-Security-Policy: require-trusted-types-for 'script'`

**Best Practices 100 requires HTTPS deployment. Cannot be fixed in code.**

## v5 Results (production build, port 4173)

| Category | v1 (dev) | v5 (prod) | Change |
|---|---|---|---|
| Performance | 56 | **87** | +31 ✅ |
| Accessibility | 83 | **100** | +17 ✅ |
| Best Practices | 74 | 78 | +4 |
| SEO | 83 | **100** | +17 ✅ |

**Core Web Vitals (production):**
| Metric | Dev | Prod | Status |
|---|---|---|---|
| FCP | 2.4s | 1.4s | ✅ |
| LCP | 4.7s | 1.8s | ✅ |
| TBT | 10ms | 0ms | ✅ |
| CLS | 0.011 | 0 | ✅ |
| SI | 2.5s | 1.4s | ✅ |

### v5 remaining issues
- **Performance 87** (target 90+):
  - "Reduce unused JavaScript: 903 KiB" — Monaco editor workers loaded but not executed on login/dashboard pages. Hard to fix without restructuring Monaco loading.
  - "Render blocking requests: 40ms" — Vite-injected CSS `<link>` tags in built HTML. Minor.
  - "Avoid long main-thread tasks: 3 tasks" — likely initial Vue app bootstrap.
  - **Logo PNG (328 KB)** — the logo is still uncompressed. This is likely the LCP element on the login page. **Manual step needed: `cwebp -q 80 client/public/icons/logo.png -o client/public/icons/logo.webp`**
- **Best Practices 78**:
  - 7 HTTPS/security header failures — infrastructure only
  - "Missing source maps for large first-party JavaScript" — can be fixed in `vite.config.ts` with `build.sourcemap: true`, but increases bundle size and exposes source code

## v2 Results

| Category | v1 Score | v2 Score | Change |
|---|---|---|---|
| Performance | 56 | 59 | +3 |
| Accessibility | 83 | 92 | +9 |
| Best Practices | 74 | 74 | -- |
| SEO | 83 | 92 | +9 |

### Still failing (v2)
- `errors-in-console` — Chrome extension error (1Password/passkeys), not our code
- `button-name` — Fixed: icon-only buttons on DashboardPage.vue were missing `aria-label` (TopBar.vue was already fixed in v1)
- `landmark-one-main` — Fixed: DashboardPage.vue and LoginForm.vue were missing `<main>` landmark (AppLayout.vue was already fixed in v1, but Lighthouse tested the dashboard page)
- `robots-txt` — Fixed: removed invalid `Sitemap: /sitemap.xml` line (relative URL not allowed)
- `is-on-https`, `redirects-http`, `modern-http` — Infrastructure (requires HTTPS/HTTP2 deployment)
- `unminified-javascript`, `unused-javascript` — Dev server artifacts (not present in production build)
- `bf-cache` — Low priority

## v4 Results (tested on /login)

| Category | v1 | v2 | v3 | v4 | Change (v3→v4) |
|---|---|---|---|---|---|
| Performance | 56 | 59 | 100 | 63 | -37 (different URL, dev server) |
| Accessibility | 83 | 92 | 78 | **100** | +22 ✅ |
| Best Practices | 74 | 74 | 100 | 78 | -22 (HTTPS only) |
| SEO | 83 | 92 | 100 | **100** | 0 ✅ |

### v4 analysis
- **Accessibility 100** — all scored audits pass ✅
- **SEO 100** ✅
- **Performance 63** — dev server artifacts only (unminified JS 1,410 KB, unused JS 1,740 KB, total 4,619 KB). Will be ~90+ in production build.
- **Best Practices 78** — all failures are HTTPS/security headers (no CSP, no HSTS, no COOP, no XFO). Requires nginx/Caddy deployment config, not code changes.
- **CLS 0.011** — minor layout shift detected on /login (layout shift culprits listed in insights). Low priority.

## v3 Results

| Category | v1 Score | v2 Score | v3 Score | Change (v2→v3) |
|---|---|---|---|---|
| Performance | 56 | 59 | 100 | +41 |
| Accessibility | 83 | 92 | 78 | -14 REGRESSION |
| Best Practices | 74 | 74 | 100 | +26 |
| SEO | 83 | 92 | 100 | +8 |

### Accessibility regression analysis (v3)
The v2 fix changed `CardTitle.vue` from `<h3>` to `<h2>` globally, which broke heading hierarchy on pages where CardTitle appears inside components without a direct parent h1. Additionally, the clone URL input on DashboardPage was missing a label.

### v3 fixes applied
- `CardTitle.vue` — added configurable `as` prop (defaults to `h3`), use `as="h2"` only on pages with explicit `<h1>` parents (DashboardPage, LoginForm)
- `DashboardPage.vue` — added `aria-label="Repository URL"` and `id="clone-url"` to clone URL input
- `DashboardPage.vue` — added `role="progressbar"` with proper ARIA attributes to clone progress bar
- `DashboardPage.vue` — added `role="banner"` to header, `role="contentinfo"` to footer, wrapped actions in `<nav>` landmark
- `index.html` — added `role="status"` to loading skeleton

## P0 — Quick Wins (minutes)
- [x] Remove `user-scalable=no` and `maximum-scale=1.0` from viewport meta in `client/index.html`
- [x] Add `<meta name="description">` to `client/index.html`
- [x] Add `<main>` landmark to AppLayout.vue
- [x] Add `<main>` landmark to DashboardPage.vue and LoginForm.vue (v2 fix)
- [x] Add `aria-label` to icon-only buttons in TopBar.vue header
- [x] Add `aria-label` to icon-only buttons in DashboardPage.vue header (v2 fix)
- [x] Fix heading hierarchy (h3 without parent h1/h2) — v3: reverted CardTitle default to h3, added `as` prop for explicit h2 where needed
- [x] Create `client/public/robots.txt`
- [x] Fix `robots.txt` — remove invalid relative Sitemap URL (v2 fix)

## P1 — Performance (30min each)
- [x] Optimize `client/public/icons/logo.png` (328 KB) — **requires manual step**: run `cwebp -q 80 client/public/icons/logo.png -o client/public/icons/logo.webp` and `pngquant --quality=65-80 client/public/icons/logo.png` (cannot run in sandbox)
- [x] Add inline loading skeleton in `client/index.html` for faster perceived FCP
- [x] Fix `manifest.json` — split `"purpose": "any maskable"` into two entries

## P2 — Bundle Size (1-2hrs)
- [x] Tree-shake `lucide-vue-next` — verified: all imports already use explicit named imports (tree-shaking works)
- [x] Configure Vite `manualChunks` to split `reka-ui`, `vue-vendor`, `icons`, `vueuse`, `monaco`, `vue-flow`
- [x] Tree-shake `@vueuse/core` — verified: all imports use named imports (`reactiveOmit`, `useVModel`), tree-shaking works
- [x] Lazy-load all Vue Router routes via dynamic imports — verified: all routes already use `() => import()` pattern

## P3 — Infrastructure (out of scope for code changes — requires deployment config)
- [ ] Deploy with HTTPS + HTTP/2 (nginx/Caddy) — fixes most Best Practices failures
- [x] Back/forward cache: reconnect WebSockets on `pageshow` event

## Not fixable
- `errors-in-console` — caused by Chrome extension (1Password passkeys plugin), not application code
