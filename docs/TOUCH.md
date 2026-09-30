# Touch offset

Report (iPhone, portrait, home-screen app with `apple-mobile-web-app-status-bar-style: black`, iOS UA
`iPhone OS 18_7 … Version/27.0`): "Tap to touch is off by a bit. It's happening 30-50 pixels below where I
tap." Arena taps (designate, cast an armed ability, hold-to-aim) acted about 30 to 50 CSS px below the finger.
DOM buttons responded correctly.

## How taps become world points

`Input` (src/app/input.ts) → canvas-local CSS px → camera px → `Camera.toWorld` (src/render/camera.ts).
The renderer (src/render/renderer.ts) draws a world point at
`NDC = (world − cam − shake) · 2s / view + 2 (centre − view/2) / view`, and the NDC square is stretched over the
canvas' CSS box, whatever that box is. Pointer math and the drawn frame agree only if (1) the pointer is scaled
from the box into the camera's `viewW × viewH`, and (2) `toWorld` uses the same `s`, shake and centre as the
frame on screen.

## Audit

Measured in Playwright (Chromium, touch emulation, `page.touchscreen.tap`). "Error" is the drawn position of
the world point the game acted on (computed from the `uCam / uScale / uOffset` uniforms the renderer actually
sent to GL, captured by wrapping `uniform2f`, plus the canvas box) minus the tap. A pixel check confirms the
method: the touch test's canvas-drawn marker, found in a screenshot, sits within 0.3 px of the tap (390×844
DPR 2, and 360×740 DPR 3 with the buffer capped).

| Case | Before | After |
|---|---|---|
| Baseline 390×844 DPR 2 | 0 | 0 |
| Boon offer card showing | 0 | 0 |
| Ability armed (the cast command's point) | 0 | 0 |
| Inspector open | 0 | 0 |
| After tab switches (More → Battle) | 0 | 0 |
| Rotation to 844×390 and back | 0 | 0 |
| Zoom 2 | 0 | 0 |
| Camera shake (trauma 1, frozen) | 0 | 0 |
| **Punch zoom kick 0.07** | **up to 15.8 px** (−12.7 at the top, +13.2 low right) | 0 |
| Live punch + shake mid-kick | 5.3 px | 0 |
| **Stale camera size: box 844, camera fitted to 785** (box grew 59 px, no resize event) | **+18.8 px (y 250), +32.3 (y 430), +42.1 (y 560), +46.6 (y 620): below the finger** | 0 |
| Stale the other way: box 785, camera 844 | −17.5 … −39.2 px (above) | 0 |
| DPR 1 / 1.5 / 2 / 3 × High / Medium / Low (DPR cap 2 / 1.5 / 1) | 0 | 0 |
| Status-bar layout: viewport 393×793 on a 393×852 screen, DPR 3 | 0 | 0 |

### Confirmed

- **A camera fitted to a smaller height than the canvas box reproduces the report exactly.** The draw maps the
  camera view onto the whole box, so everything is stretched by box/view, while the old pointer math used
  unscaled box pixels. With the iPhone's numbers (a 59 px status-bar difference: 852 vs 793) the error is
  `y · (852/793 − 1)` ≈ 7.4 % of the distance from the top: 30 px at mid-screen, 48 px near the bottom, always
  below. That is the reported 30-50 px. It needs the canvas box to change without the camera being re-fitted;
  on the headless build nothing does that, but iOS home-screen apps can change the viewport (status bar,
  resume from background, the keyboard after Settings → import) without a resize event.
  Fixed twice over: `Input` now reads the canvas box on every pointer event and scales by
  `camera.viewW / rect.width`, `camera.viewH / rect.height` (src/app/input.ts `boxToView`, `updateRect`), so taps
  land on what is drawn even while the camera is stale; and the app re-fits whenever the box can have changed
  (src/app/main.ts: every frame compares `canvas.clientWidth/Height` and `devicePixelRatio` with the fit; plus
  `resize`, `orientationchange`, `visualViewport` resize, `pageshow`, return from hidden, and `Input.onStale`).
- **The punch zoom kick was drawn but not mapped.** The renderer drew with `s = camera.scale · (1 + punch)`
  while `toWorld` used `camera.scale`. The punch now lives on the camera (`Camera.punch`, `drawScale`); the
  renderer sets it for the frame it draws and `toWorld` / `toScreen` / zoom anchoring use it.
- **Taps used the camera at lift-off.** A tap now acts on the world point under the finger when it went down
  (the frame the player aimed at), not after a few frames of shake / punch.

### Ruled out (measured 0 px)

DPR 1-3 and the quality tiers' DPR caps (the drawing buffer size never enters the mapping: NDC is
resolution-independent), camera shake (already in `toWorld`), boon card, armed abilities, the Inspector, tab
switches, rotation, zoom, and the plain status-bar layout (`innerHeight` 793 ≠ screen 852) when the viewport is
reported consistently. A WebKit touch-coordinate offset cannot be emulated here; DOM buttons working suggests
`clientX/Y` agree with layout, but a compositor offset of the canvas alone would not show up in any number
the page can read. The touch test and calibration below cover that case.

The document can also be scrolled a few px on iOS even with `overflow: hidden`; `fit()` now calls
`scrollTo(0, 0)` when `scrollX/Y` is non-zero, and the touch test reports and resets it.

## Touch test (More → Help → Tap accuracy → Touch test)

A full-screen layer over the live canvas; the rest of the UI hides and the field pauses. Every canvas pointer
goes to the test (`Input.probe`), never to the game. Each tap shows:

- (a) a white DOM crosshair at `clientX / clientY` (CSS, `position: fixed`): where the browser says you touched;
- (b) a magenta ring drawn by the WebGL canvas at the world point the game computed for the touch (pointer →
  `camera.toWorld` → drawn through the renderer's overlay path, like every other marker);
- (c) numbers: client, page, screen, offset, `visualViewport` size / `offsetTop` / `pageTop` / scale,
  `innerWidth × innerHeight`, `scrollY`, the canvas box, `camera.viewW × viewH`, `centerPx / Py`, DPR and buffer
  size, zoom and punch, the world point, and the (b) − (a) difference in CSS px; also how many pointer events
  this session found the canvas box and the camera out of step.

Reading it on the phone: if the crosshair and the ring sit together under your finger, taps are right. If both
sit away from your finger, the browser reports touches off where the finger is (calibrate). If the ring is away
from the crosshair, the canvas is drawn somewhere other than where the page lays it out. **Copy log** puts the
last 10 taps (with a header: UA, screen, DPR, standalone, viewport, canvas, camera, calibration) on the
clipboard; if the clipboard is blocked, it shows the text in a box to select.

## Tap calibration (same screen → Calibrate taps)

The canvas draws three rings (upper right, middle left, lower right; 24 %, 50 %, 76 % of the height). Tap the
centre of each. A per-axis line is fitted from the (tapped, drawn) pairs (src/app/touch-cal.ts):
`x' = ax·x + bx`, `y' = ay·y + by` in canvas-local CSS px, least squares with the slope clamped near 1
(`ay` within ±0.12, `ax` within ±0.05) and the intercept refit. Verdicts:

- within 2 px of identity at every ring: "Your taps are accurate", nothing stored (an old calibration is cleared);
- otherwise stored in prefs `citadel.prefs.v1` key `touchCal` and applied by `Input` to every pointer
  position before it is scaled into the camera (designate, cast, aim, pinch and wheel zoom anchor);
- taps that disagree with the fitted line by more than 14 px, or a correction over 150 px: nothing stored, try again.

**Reset calibration** restores identity. The e2e run (`tests/e2e/e2e.mjs`, "phone touch") injects a synthetic
40 px offset into canvas pointer events, measures 40 px, calibrates, and checks the error is under 2 px after
calibration and after a reload.

## Automatic self-check

Not added as a tap-vs-target heuristic: comparing the first taps with the tower or enemy positions cannot tell
a mis-tap, a moving enemy or a deliberate tap on empty ground from a device offset, and would misfire on
desktop. The only automatic check is geometric and cannot false-positive: every pointer event compares the
canvas box with the camera's fitted size, rescales if they differ, re-fits the camera and counts it (shown in
the touch test and logged once to the console).
