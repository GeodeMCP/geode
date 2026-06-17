# GeodeMCP — Visual Style Specification

> Canonical visual source of truth for the dashboard and all UI. Dark-first; light is a
> later toggle. Provided by the user 2026-06-17. When implementing, the token set, font
> split, and accent semantics below are non-negotiable.

## 1. Design philosophy (the "feel")

Dark, technical, and quietly premium — a **developer-tool aesthetic** in the lineage of
Vercel / Linear / LobeHub, but with a distinct **warm-dark green-tinted base** and an
**emerald + electric-blue** accent pairing drawn from the brand "geode/gem" mark. The mood is
calm and engineered, not flashy: near-black canvas, low-contrast hairline borders, generous
spacing, and one or two restrained signature effects (an animated topographic line field and
film grain in hero areas). Color is used sparingly — emerald green is the primary accent and
"alive/active" signal; blue is reserved for primary calls-to-action.

The single source of truth is `app/static/css/app.css` (fully tokenized with CSS custom
properties).

## 2. Color system

Colors are authored in **OKLCH**. The accent ramps are essentially Tailwind's default
`emerald` and `blue`, on a **custom warm-dark neutral** (slight green hue `165`, not pure
gray).

### Base / surfaces (warm near-black, hue 165)
| Token | OKLCH | ≈ Hex | Use |
|---|---|---|---|
| `--bg` | `oklch(15% .006 165)` | `#0b0f0e` | Page background (also theme-color) |
| `--surface` | `oklch(18.5% .006 165)` | `#141917` | Cards, panels, header fill |
| `--surface-2` | `oklch(21% .006 165)` | `#191e1c` | Hover state, raised elements |
| `--input` | `oklch(12% .006 165)` | `#080b0a` | Input/code-block fills (darker than bg) |
| footer | `oklch(13% .006 165)` | `#090c0b` | Footer |

Surfaces are **not gray** — `.006` chroma at hue `165` gives a faint cool-green cast.

### Text (pure neutral, no hue)
| Token | OKLCH | ≈ Hex | Use |
|---|---|---|---|
| `--text` | `oklch(96% 0 0)` | `#f2f2f2` | Primary text (off-white, never pure #fff) |
| `--neutral-200` | `oklch(92.2% 0 0)` | `#e5e5e5` | Ghost-button text |
| `--muted` | `oklch(70.8% 0 0)` | `#a3a3a3` | Body copy, secondary text |
| `--faint` | `oklch(55.6% 0 0)` | `#777` | Captions, placeholders, meta, timestamps |

Three-step hierarchy: bright `--text` for headings, `--muted` for body, `--faint` for
incidental.

### Borders (white at low alpha — they glow rather than draw)
| Token | Value | Use |
|---|---|---|
| `--border` | `oklch(100% 0 0 / .07)` | Default hairline (7% white) |
| `--border-strong` | `oklch(100% 0 0 / .12)` | Inputs, buttons, emphasis (12% white) |

### Emerald (primary accent / "alive" / active state)
| Token | OKLCH | ≈ Hex |
|---|---|---|
| `--emerald-300` | `oklch(84.5% .143 164.978)` | `#6ee7b7` (links on accent, tool names) |
| `--emerald-400` | `oklch(76.5% .177 163.223)` | `#34d399` — **`--green`, the workhorse accent** |
| `--emerald-500` | `oklch(69.6% .17 162.48)` | `#10b981` (code keywords, mono accents) |

`--green` drives active nav underlines, focus rings, status dots/pulses, "live" chips, links,
eyebrow text, step numbers. Almost always low-alpha fills (`/ .08–.16`) with a fuller-strength
border → soft tinted "pills."

### Blue (reserved for primary buttons / CTAs only)
| Token | OKLCH | ≈ Hex |
|---|---|---|
| `--blue-100` | `oklch(93.2% .032 255.585)` | `#dbeafe` (text on blue buttons) |
| `--blue-500` | `oklch(62.3% .214 259.815)` | `#3b82f6` (button border) |
| `--blue-600` | `oklch(54.6% .245 262.881)` | `#2563eb` — `--blue`, fill |
| `--blue-700` | `oklch(48.8% .243 264.376)` | `#1d4ed8` (hover) |

Semantic split: **green = system state & identity; blue = the one primary action per view.**

### Status / feedback
- Error: red `oklch(60% .13 25)` fill + `oklch(74% .14 25)` text.
- Success/notice: emerald tints.
- Syntax: comments `--faint`; keywords `--emerald-500`; strings muted blue `oklch(70% .04 255)`
  / `#9fd0ff`; numbers/booleans amber `oklch(80% .12 80)`.

### Brand mark (geode logo) — faceted gem, three triangles
Emerald `#3FCFA1`, light mint `#86ECCB`, electric blue `#4C7DF4`. The seed for the
emerald+blue system.

## 3. Typography — four Google fonts, deliberate roles
| Family | Weights | Role |
|---|---|---|
| **Geist** | 400/500/600 | Default body / UI sans (`body`) |
| **Instrument Sans** | 400/500/600/700 | Display & UI-chrome: headings, buttons, labels, nav, chips, step numbers, card titles |
| **Onest** | 400–700 | Brand wordmark only (the "Geode" logotype, weight 500, 19px, `-.02em`) |
| **Geist Mono** | 400/500 | Code, endpoints, tool names, terminal panels, API keys |

Conventions: headings = Instrument Sans 600 with `-.02em`/`-.025em` tracking; hero h1 52px/1.04
(39px mobile), section h2 34px, block h2 20px. Global `font-feature-settings:"cv01" 1`;
`-webkit-font-smoothing:antialiased`. Body line-height 1.5; prose 1.7–1.75. `.label` eyebrow:
11px uppercase, `letter-spacing:.17em`, weight 600, color `--green`. **Never pure white text.**

## 4. Layout & spacing
- Container `.wrap`: max-width 1120px, padding 0 28px. `.wrap-sm` 560px; `.doc` ~46em.
- Section rhythm `.sec`: padding 84px 0. Hero 84–92px; CTA 90px.
- Card grids 3-up (gap 16px) → 2-up @880 → 1-up @560.
- Listing `1fr 320px` (gap 40px) → collapse @900. Dashboard `1.55fr 1fr`.
- Breakpoints: 560, 760, 820, 880, 900. Header → hamburger @760.

## 5. Shape language (radius)
Buttons/controls 6px (inputs 8px); code blocks/mini panels 10–12px; cards 14px; panels/hero/
modals 12–16px; CTA band 18px; avatars 10px/15px; chips/eyebrows/status/dots fully round
(999px).

## 6. Core components
- **Buttons** — `.btn` primary: height 2.75rem, blue-600 fill, blue-500 border, blue-100 text,
  Instrument Sans 500/.9rem, radius 6px, `.15s`, hover → blue-700. `.ghost`: transparent,
  border-strong, neutral-200, hover 4.5% white. `.sm`: height 2.25rem.
- **Server card `.cC`** — 14px radius, `--surface`, mono "terminal bar" header (endpoint in
  emerald-500), grayscale→color logo tile, Instrument name, muted desc, chip row; hover →
  border-strong + surface-2.
- **Panels `.panel`** — faux terminal: 12px radius, `.panel-bar` with 3 macOS traffic-lights
  (9px, white@10%) + faint filename, `<pre>` Geist Mono 12px, syntax classes, floating
  `.copy`.
- **Chips & status** — `.chip` 11px Instrument 600 round hairline muted; `.chip.live` emerald
  text + tinted bg/border; `.pulse`/`.dotsm` 6px emerald dot with `box-shadow:0 0 7px green`;
  `.eyebrow` round outlined emerald-300; `.ai-badge` inline emerald micro-badge.
- **Forms** — `.input` on `--input`, border-strong, 8px, 13.5px; placeholder `--faint`; focus
  → border `--green` (no default outline). Labels 12.5px muted.
- **Sticky chrome** — header sticky, 64px, `oklch(15% .006 165 / .72)` + `backdrop-filter:
  blur(12px)` + bottom hairline. Listing `.subnav` sticky @top:64px, active = 2px emerald
  bottom border (scroll-spy).
- **Modals** — native `<dialog>`, `--surface`, 16px, `::backdrop` black@60% + 2px blur.
- **Tabs** — underline; active = bright text + colored bottom border (blue for connection
  tabs, emerald elsewhere).
- **Tables/docs** — hairline-bordered rounded-clipped; `.doc` prose with emerald underlined
  links and emerald inline `code` on surface chips.

## 7. Signature effects
1. **Animated topographic line field** (`<canvas data-topo>`): flowing horizontal contour
   lines in faint `rgba(155,188,176,~.05)` mint, radial `mask-image` fade, respects
   `prefers-reduced-motion`.
2. **Film grain** (`.grain`): SVG `feTurbulence`, opacity .44, `mix-blend-mode:soft-light`.
3. **Radial spotlight** (`.grad`): soft teal `#264d4c → transparent` behind hero.
4. **3D perspective flow** (`.flow`/`.p3`): `perspective:1500px` + `rotateX(13deg)`, hover
   `translateZ(40px)`, shadow `0 36px 60px -34px rgba(0,0,0,.85)`. Flattened <820px.
5. **Glow accents** — emerald dots with small `box-shadow` glows; the only "lighting."

## 8. Iconography & motion
- Icons: inline SVG, `stroke="currentColor"`, `stroke-width:2`, `fill:none`, rounded joins
  (Lucide/Feather thin-line). No icon font.
- Motion: uniform/fast/restrained. Standard `.15s cubic-bezier(.4,0,.2,1)` (`--ease`); 3D cards
  `.35s`. Hovers shift border/bg subtly; nothing bounces.

## 9. Non-negotiables when porting
1. The OKLCH token set (bg/surface/surface-2/input @hue 165, white-alpha borders, three-step
   neutral text, emerald + blue ramps).
2. The font split: Geist (body) + Instrument Sans (headings/chrome) + Geist Mono (code) + Onest
   (logo only); headings Instrument Sans 600 with `-.02em`.
3. Accent semantics: emerald = identity/state/active/links (low-alpha pills + stronger
   borders); blue = single primary button; text never pure white.
4. Hairline translucent-white borders; surfaces ~3–6% lighter than bg; hover = +one surface
   step.
5. Radius scale + 999px pills for chips/tags/dots.
6. Restraint: at most one hero effect (topo + grain + radial glow), `.15s` transitions, lots of
   whitespace (84px sections, 1120px container).
