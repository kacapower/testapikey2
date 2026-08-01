# PW App — UI handoff for an AI assistant

**Paste this whole file as your first message to a new AI, then attach the zip.**
It is written to be self-contained: it assumes you have no memory of how any of
this was built.

---

## 1. Your role

You are picking up the front-end of **PW App** (also called DoubtShare), a study
app for Indian Class 11–12 / JEE students. Someone else produced a new theme and
a set of UI mockups. Your job is to work *with* that material, not to redesign it.

Read section 4 (**the layering rule**) before you touch `style.css`. It is the one
constraint that will cause real damage if you ignore it — a normal "clean up this
stylesheet" refactor is exactly the wrong move here and will silently break the
live site.

---

## 2. What the app is

A **static site** — plain HTML, CSS and vanilla JS. No build step, no framework,
no bundler, no npm. Files are edited and uploaded as-is.

| Concern | How it works |
|---|---|
| Hosting | InfinityFree shared hosting, live at `https://pw.free.je` |
| Backend | Supabase (Postgres + Auth + Edge Functions), project ref `ggxsinemrhhhxhviylig` |
| Moderation | Supabase Edge Function `moderate` → NVIDIA `nemotron-3.5-content-safety` |
| Image compression | Hugging Face Space, called from the browser via `@gradio/client` from a CDN |
| Heavy file uploads | Same Hugging Face Space, `/push` endpoint → public HF dataset |

### Hosting constraints that shape everything

InfinityFree is PHP/MySQL shared hosting with real limits you must design around:

- **No SSH and no git deploy.** Uploads are **FTP only**. There is no server-side
  build step, so anything you write must run in the browser exactly as committed.
  If you want CI deployment, the options are `git-ftp` or a GitHub Action such as
  `SamKirkland/FTP-Deploy-Action`. Do not propose `npm run build` pipelines.
- **`open_basedir` confines everything to `htdocs/`.**
- **The firewall returns 403 for any URL containing the string `chat`.** This is
  why the chat page is called `community.html` and not `chat.html`. **Never create
  a file, folder, route or query parameter containing `chat`.** This has already
  cost the project one debugging cycle.

---

## 3. What is in the zip

```
style.css              the theme — READ SECTION 4 BEFORE EDITING
AI-HANDOFF.md          this file
mockups/
  index.html           hub page; links the rest, lists what to check
  gallery.html         every component in style.css on one page
  feed.html            doubts feed: hero, filter chips, cards, FAB, modal
  library.html         file library: search, upload progress, file cards
  community.html       chat: bubbles both directions, composer
  login.html           auth card
  admin.html           stat grid, wide table, moderation modal
  mock.js              class-toggling only — see the warning below
app.py                 the Hugging Face Space (combined app)
app1.py app2.py        the two original Spaces, kept for reference
```

### The mockups are presentation only

Every page links `../style.css` directly, so editing the stylesheet updates all
of them on refresh. They are a **review surface**, not app code.

**`mock.js` must never be copied into the real app.** It only adds and removes
CSS classes so that states like `.open`, `.show`, `.active` and `.voted` are
reachable in a static page. It has no auth, no network calls, no storage, and no
error handling. The real behaviour lives in the app's own `js/` directory.

Placeholder images are inline SVG data URIs so the mockups work offline. Replace
them with real assets if you build from these.

---

## 4. THE LAYERING RULE — read this before editing `style.css`

`style.css` is **not** a normal stylesheet. It is three stacked layers, in this
order, each separated by a large banner comment:

| Layer | What it is |
|---|---|
| **v2** (top of file) | The original theme. AMOLED black + purple, mobile-first. |
| **v3** | Additive polish: depth, focus rings, hover, safe-area, `dvh`, scrollbars. |
| **v3.1** (bottom) | Micro-interactions, autofill fix, opt-in utilities. |

**v3 and v3.1 deliberately re-use selectors from v2 and win on cascade order.**
That is the mechanism, not an accident.

### Rules you must follow

1. **Never reorder, merge, or "deduplicate" the layers.** Selectors intentionally
   appear more than once. Flattening them changes which declaration wins and will
   break the theme in ways that are hard to trace.
2. **Never delete a v2 rule.** Override it in a lower layer instead.
3. **Later layers may only set paint properties** — `color`, `background`,
   `box-shadow`, `outline`, `filter`, `opacity`, `transform`, `animation`,
   `transition`. Never `width`, `height`, `margin`, `padding`, `top/left`,
   `display`, `flex`, or `grid` in v3/v3.1. This is what guarantees no box moves.
4. **All animations are `opacity` or `transform` only.** Keep it that way — it
   keeps everything off the main thread and prevents reflow.
5. **Prefix every new keyframe with `pw-`.** Existing unprefixed names (`rise`,
   `shimmer`, `flashcard`) belong to v2.
6. **Some v2 rules intentionally out-specify later ones.** For example v3 gives
   `.btn` a gradient, but `.btn.ghost` and `.btn.danger` keep their flat
   backgrounds because `0,2,0` beats `0,1,0` regardless of order. Do not "fix"
   this.
7. **Respect `prefers-reduced-motion`.** v2 has a universal
   `animation: none !important` rule; v3.1 adds an `opacity: 1; transform: none`
   reset so nothing with `animation-fill-mode: both` gets stuck invisible. Any new
   animation using `both` needs the same treatment.
8. **Adding a whole new layer at the bottom is the correct way to extend this.**
   Follow the existing banner-comment format and state what the layer does.

### Verifying you did not break it

```bash
python - <<'EOF'
import re
src = open('style.css', encoding='utf-8').read()
noc = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
assert noc.count('{') == noc.count('}'), "brace mismatch"
kf = re.findall(r'@keyframes\s+([\w-]+)', noc)
assert len(kf) == len(set(kf)), f"duplicate keyframes: {kf}"
print("OK —", noc.count('{'), "rules,", len(kf), "keyframes")
EOF
```

There is also a stronger check: every class defined in `style.css` is used by at
least one mockup, and every class used by a mockup is defined in `style.css`. If
you add a class, add it to `gallery.html` too so that stays true.

---

## 5. Known-good vs known-broken

### Works, verified

- The Hugging Face Space runs on **Gradio 6.21.0** and all three endpoints were
  tested live: `/compress`, `/compress_manual`, `/push`. A 6.9 MB image compressed
  to 682 KB; a `/push` upload returned a URL that downloaded anonymously with
  HTTP 200.
- The Space's `README.md` frontmatter must keep `app_file: app.py` and
  `sdk_version: 6.21.0`.

### Broken or unresolved — this is your likely work queue

1. **`uploadHeavyFile()` in `js/app.js` still calls the wrong backend.** It calls
   the Supabase Edge Function `hf-upload`, which **can never work**: Supabase Edge
   Functions cap CPU at **2 seconds** and the HF client hashes the whole payload
   in-process. Measured: a 12-byte file succeeded; 256 KB, 2 MB, 10 MB and 45 MB
   all died with `WORKER_RESOURCE_LIMIT` in about 0.9 s. It must be rewired to call
   the Space's `/push` endpoint instead. **Until this is done, `/push` is dead
   code and large uploads silently fail.** This is the single highest-value fix.
2. **`@gradio/client` CDN version is unverified.** The browser client is pinned to
   a CDN URL that may be from the v4/v5 era, while the server now runs Gradio 6.21.
   Only the *Python* client was tested against it. Check the pin and test in a real
   browser before trusting image compression.
3. **Dataset name conflict.** The project notes say `kacapower/pw-files`; `app.py`
   defaults to `kacapower/Directory`. Pick one. Whichever you pick **must be a
   public dataset**, or every returned `resolve/` link will 401 for all users.
4. **`api_name="push"` burns rate-limit quota on rejected requests.** In `app.py`,
   `_rate_ok()` runs *before* the key and file checks, so the budget is 12
   *requests* per 10 minutes, not 12 successful uploads. Decide whether that is
   intended.
5. **Both compress functions write to a fixed path**, `compressed_output.jpg`.
   Concurrent requests could in principle collide. Six concurrent trials produced
   zero cross-contamination, so this is a latent risk, not a confirmed bug.
6. **Cross-page view transitions are written but commented out**, at the very
   bottom of `style.css`. Enabling them makes navigation crossfade, but if any page
   runs an auth-guard redirect on load, the transition can paint the guarded page
   for one frame first. Check that path before enabling.
7. **Card entrance stagger may flicker.** `.card` fades in on render. If the app
   re-renders the list on a timer or a realtime subscription, this replays. If it
   looks wrong, delete the five `.card` animation lines in §3 of the v3.1 layer.

---

## 6. Security rules — non-negotiable

- **Never put a credential in the repo or in browser-visible JS.** No API keys, no
  tokens, no passwords, in any file you commit.
- `HF_TOKEN`, `HF_DATASET_REPO` and `PW_UPLOAD_KEY` are **Hugging Face Space
  secrets** (Settings → Variables and secrets). They must never reach a browser.
- `NVIDIA_API_KEY` lives **only** in Supabase secrets. It must never reach the repo
  or the browser.
- The Supabase **anon key is public by design** and is safe in `js/config.js`. Row
  Level Security is what protects the data. Do not "fix" it by hiding it.
- **`PW_UPLOAD_KEY` is not authentication.** It ships inside browser JS. It only
  stops drive-by abuse of a public endpoint. Do not describe it as auth, and do not
  build anything security-critical on it.
- If you ever see a token pasted into a conversation, treat it as compromised and
  tell the user to rotate it.

---

## 7. Suggested first steps

1. Open `mockups/index.html` in a browser. It lists eight specific things to check.
2. Use device emulation, or a real phone. The theme is mobile-first and several
   fixes (safe-area insets, `dvh` viewport, tap targets) only show up at that size.
3. Read the three banner comments in `style.css` before editing anything.
4. Ask the user which of the section 5 items they want first. Do not start
   restyling — the theme is finished and reviewed; the outstanding work is
   integration, not design.

---

## 8. Prompt to paste

> I'm handing you the front-end of PW App, a static HTML/CSS/JS study app on
> InfinityFree with a Supabase backend. The attached zip contains a finished theme
> (`style.css`) and seven UI mockups that render it.
>
> Read `AI-HANDOFF.md` first, in full, before opening any other file. Two things in
> it will cause real damage if you skip them: `style.css` is a three-layer cascade
> where selectors are duplicated on purpose — do not flatten, reorder or
> deduplicate it — and no file or URL may contain the string `chat`, because the
> host's firewall 403s those.
>
> The mockups are a review surface, not app code, and `mock.js` must never be
> copied into the real app.
>
> When you've read it, tell me which of the items in section 5 you think is most
> urgent and why, and wait for me to confirm before writing any code.
