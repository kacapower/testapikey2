# Station Master — Software Requirements Specification

**Product:** Station Master — 2D Indian Railway signalling simulator
**Document type:** Developer requirements specification (build-ready)
**Source design brief:** [station-master-game-prompt.md](station-master-game-prompt.md)
**Version:** 1.0
**Status:** Ready for implementation

---

## How to read this document

Every requirement has an ID of the form `AREA-nnn`.

| Prefix | Area |
|---|---|
| `TEC` | Technical / platform |
| `DAT` | Data model |
| `SIM` | Simulation core |
| `LAY` | Layout & topology |
| `SIG` | Signalling & aspects |
| `ILK` | Interlocking safety logic |
| `BLK` | Block working |
| `TRN` | Trains & physics |
| `TT`  | Timetable |
| `INP` | Input & controls |
| `UI`  | Screen layout & HUD |
| `REN` | Rendering |
| `SCO` | Scoring |
| `FAI` | Failure events |
| `LVL` | Levels |
| `DBG` | Debug & tooling |
| `TST` | Test requirements |

Priority: **M** = must (blocks release), **S** = should, **C** = could.

`MUST` / `MUST NOT` / `SHOULD` carry RFC-2119 meaning.

---

## 1. Product summary

### 1.1 One-line definition

`OVR-001` **(M)** The player is the Station Master of an Indian Railways wayside
junction. The player sets **routes** through a schematic track diagram. The
interlocking derives signal aspects. The player is scored on safety first,
punctuality second.

### 1.2 The one inviolable rule

`OVR-002` **(M)** The player MUST NOT be able to select a signal aspect. Aspect
is a pure function of layout state (§6.4). Any UI affordance that lets the player
pick a colour is a defect, not a feature.

### 1.3 Non-goals

`OVR-003` **(M)** The build MUST NOT contain: scenery, buildings, terrain,
people, vehicles, weather, 3D or isometric projection, driver's-eye camera,
locomotive artwork, sky, ballast, sleepers, or catenary.

`OVR-004` **(M)** No multiplayer, no network calls, no telemetry, no accounts.

### 1.4 Target user

A player who may know nothing about railway signalling. Every rule the game
enforces MUST be discoverable in the UI *before* it can be violated (`UI-090`).

---

## 2. Technical requirements

### 2.1 Platform

| ID | Pri | Requirement |
|---|---|---|
| `TEC-001` | M | Deliverable is exactly **one** `.html` file, e.g. `station-master.html`. |
| `TEC-002` | M | Vanilla JavaScript (ES2020). No framework, no bundler, no npm, no transpiler. |
| `TEC-003` | M | Zero external resources: no `<script src>`, no `<link href>` to CDNs, no web fonts, no images, no audio files, no `fetch()` to any origin. |
| `TEC-004` | M | Runs by double-clicking the file from the local filesystem (`file://` origin). Any feature requiring a web server is out of scope. |
| `TEC-005` | M | All graphics drawn with Canvas 2D primitives. No SVG, no WebGL, no CSS-drawn game elements. |
| `TEC-006` | M | Fonts: system stack only — `ui-monospace, "SF Mono", Menlo, Consolas, monospace` for panel text. |
| `TEC-007` | S | Total file size under 500 KB. |
| `TEC-008` | S | Persistence (level progress, best scores) via `localStorage`, guarded in `try/catch` because `file://` may block it. Failure to persist MUST NOT break the game. |
| `TEC-009` | M | No `eval`, no `new Function` on user-supplied strings. |

### 2.2 Module structure

`TEC-020` **(M)** Code MUST be organised into these logical modules inside the
single file, each an IIFE or a plain object namespace, in this order:

```
1. CONST      — colours, physics constants, tunables
2. layout     — station topology data + query helpers (pure)
3. interlock  — route validation, locking, release (pure)
4. signalling — aspect computation (pure)
5. trains     — physics, movement, driver behaviour
6. timetable  — schedule, spawning
7. scoring    — score accumulation, failure detection
8. sim        — fixed-timestep loop, orchestrates 2–7
9. render     — all Canvas drawing (read-only over state)
10. input     — mouse/keyboard → intents
11. ui        — HUD, panels, message strip, dialogs
12. levels    — level definitions
13. tests     — in-file self-test harness (§16)
```

`TEC-021` **(M)** Modules `layout`, `interlock`, `signalling` MUST be **pure
logic**: no `ctx.` calls, no DOM access, no `Math.random()`, no `Date.now()`.
They take state, return state or verdicts. This is a hard constraint — these
modules are unit-tested by `TST-001`.

`TEC-022` **(M)** `render` MUST NOT mutate simulation state. It reads only.

`TEC-023` **(M)** All randomness routed through a single seeded PRNG
(`sim.rng`), seeded per level, so runs are reproducible.

### 2.3 Rendering & performance

| ID | Pri | Requirement |
|---|---|---|
| `TEC-030` | M | Minimum supported viewport 1280×720. Layout MUST remain readable and non-overlapping at that size. |
| `TEC-031` | S | Canvas scales to viewport; respects `devicePixelRatio` for crisp lines. |
| `TEC-032` | M | Sustained 60 fps on a 2019-class laptop with 12 trains active. |
| `TEC-033` | M | Rendering decoupled from simulation (§3). Frame rate changes MUST NOT change simulation outcomes. |
| `TEC-034` | S | Static geometry (track centrelines, labels, signal posts) cached to an offscreen canvas, redrawn only on layout/zoom change. |

### 2.4 Accessibility

| ID | Pri | Requirement |
|---|---|---|
| `TEC-040` | M | Every action available by mouse MUST also be available by keyboard (§10.2). |
| `TEC-041` | M | Colour MUST NOT be the sole carrier of information. Occupied track also gets a hatch pattern; locked routes also get a dashed outline; signal aspects also print a text abbreviation (`R`, `Y`, `YY`, `G`) beside the post when the "aspect labels" option is on (default on). |
| `TEC-042` | S | Minimum text size 12 px at 1280×720. Contrast ratio ≥ 4.5:1 against background for all text. |
| `TEC-043` | S | Focus ring drawn around the currently keyboard-focused signal or control. |
| `TEC-044` | C | Options toggle for a colour-blind-safe aspect palette (red → `#ff3b30`, yellow → `#ffcc00`, green → `#00d0ff` cyan-shifted). |

---

## 3. Simulation core

### 3.1 Timestep

| ID | Pri | Requirement |
|---|---|---|
| `SIM-001` | M | Fixed-timestep simulation. `TICK_HZ = 60`, `DT = 1/60` simulated seconds per tick. |
| `SIM-002` | M | Main loop uses `requestAnimationFrame`, accumulates real elapsed time, and runs `floor(accumulator / DT) * speedMultiplier` ticks per frame. |
| `SIM-003` | M | Accumulator clamped: at most `MAX_TICKS_PER_FRAME = 300` ticks per frame, to prevent a spiral of death after a tab stall. Excess time is discarded and logged to the debug overlay. |
| `SIM-004` | M | Speed multipliers: `0` (pause), `1`, `2`, `5`. Implemented by running 0/1/2/5 tick-batches per accumulated step — **never** by scaling `DT`. |
| `SIM-005` | M | Pause is genuine: zero ticks execute, but rendering, hover, tooltips, panning and the debug overlay remain live so the player can inspect and plan. |
| `SIM-006` | M | Simulation MUST be deterministic: same seed + same ordered input event list ⇒ identical state at every tick. |

### 3.2 Tick order

`SIM-010` **(M)** Each tick MUST execute phases in exactly this order. Order is
load-bearing — reordering changes safety outcomes.

```
1. consumeIntents()      apply queued player intents (route request, cancel, hold…)
2. tickTimers()          approach-locking timers, block-instrument timers, dwell timers
3. computeAspects()      derive every signal aspect from current state (§6.4)
4. driveTrains()         each driver reads aspects, sets target speed
5. moveTrains()          integrate physics, update positions
6. updateOccupancy()     recompute track-circuit occupancy from train extents
7. sectionalRelease()    release route segments behind trains (§7.6)
8. detectHazards()       SPAD, collision, derailment, deadlock (§13)
9. updateScoring()       delay, throughput, smoothness accumulators
10. advanceClock()       gameTime += DT
```

`SIM-011` **(M)** Aspects are computed **before** drivers read them, and
occupancy is recomputed **after** movement. A signal therefore cannot flip to
danger and be SPADed within the same tick by a train that had not yet moved.

### 3.3 Game clock

| ID | Pri | Requirement |
|---|---|---|
| `SIM-020` | M | `gameTime` is simulated seconds since level start, advanced by `DT` per tick. |
| `SIM-021` | M | Displayed as a 24-hour wall clock `HH:MM:SS`, starting at the level's `startTime` (e.g. `10:00:00`). |
| `SIM-022` | M | 1 simulated second = 1 real second at 1× speed. No hidden time compression; the levels are written to fit. |

### 3.4 Intent queue

`SIM-030` **(M)** Input never mutates simulation state directly. `input` pushes
**intent objects** onto `sim.intentQueue`; `consumeIntents()` drains it at the
top of a tick.

```js
// Intent shapes
{ type: 'REQUEST_ROUTE',  from: 'H1', to: 'PF1' }
{ type: 'CANCEL_ROUTE',   routeId: 'R_H1_PF1' }
{ type: 'CALL_ON',        signalId: 'H1' }
{ type: 'ASK_LINE_CLEAR', blockId: 'BLK_EAST' }
{ type: 'GRANT_LINE_CLEAR', blockId: 'BLK_WEST' }
{ type: 'HOLD_TRAIN',     trainId: 12951, hold: true }
{ type: 'THROW_POINT',    pointId: 'P101', position: 'REVERSE' }  // shunting only
```

`SIM-031` **(M)** While paused, intents may be queued and are applied on the
next tick after unpause — but the UI MUST show them as "pending" so the player
is not surprised.

---

## 4. Data model

### 4.1 Layout is data, not code

`DAT-001` **(M)** The station layout MUST be a plain JSON-serialisable object.
The engine MUST contain no station-specific identifiers. Adding a new station
means adding a data object and nothing else.

`DAT-002` **(M)** On load, `layout.validate(data)` runs structural checks and
throws with a precise message on failure (§4.9).

### 4.2 Coordinate system and scale

| ID | Pri | Requirement |
|---|---|---|
| `DAT-010` | M | Two independent scales. **Physics** always uses real metres. **Rendering** uses a per-edge `drawScale` (px per metre). Never mix them. |
| `DAT-011` | M | Yard edges (between Home and Advanced Starter) draw at `YARD_SCALE = 0.5 px/m`. A 600 m loop is 300 px — fits 1280×720. |
| `DAT-012` | M | Approach and block edges draw at `APPROACH_SCALE = 0.04 px/m` (compressed). A 1 km distant-to-outer gap is 40 px. |
| `DAT-013` | M | Any edge whose `drawScale` differs from its neighbour's MUST render a **scale-break marker** (a small double-slash `//` glyph on the track line) so the player understands the diagram is not to scale there. Real panels do this; it is honest and it prevents "why did that train take so long". |
| `DAT-014` | M | Node coordinates are in **schematic panel pixels**, authored by hand. Track is drawn as straight segments; turnouts as 30° diagonals. No curve interpolation. |

### 4.3 Node

```js
{
  id: 'N_H1',
  x: 240, y: 300,        // panel pixels
  kind: 'PLAIN' | 'POINT_TOE' | 'POINT_HEEL' | 'BUFFER' | 'BOUNDARY'
}
```

`DAT-020` **(M)** `BOUNDARY` nodes are where trains enter and leave the
simulated world. `BUFFER` nodes are dead ends; a train reaching one at any speed
above 0 is a derailment (`FAI-030`).

### 4.4 Edge (track segment)

```js
{
  id: 'E_UPMAIN_3',
  from: 'N_P101_H', to: 'N_P102_T',
  lengthM: 620,            // real length in metres — physics uses this
  drawScale: 0.5,          // px per metre for rendering
  circuitId: 'TC_UM3',     // which track circuit this edge belongs to
  lineName: 'UP MAIN',     // display label
  maxSpeedKph: 110,
  gradientPermille: 0,     // + = rising in from→to direction
  diverging: false         // true if traversing this edge means taking a turnout
}
```

`DAT-030` **(M)** Edges are **directed pairs**: every physical track is stored
once, and direction of travel is expressed by which end a train entered from.
The engine MUST handle both traversal directions of a single edge record.

`DAT-031` **(M)** `lengthM` MUST be a realistic value. The renderer's compression
MUST NOT leak into physics.

### 4.5 Track circuit

```js
{
  id: 'TC_UM3',
  edgeIds: ['E_UPMAIN_3'],
  kind: 'BERTH' | 'OVERLAP' | 'POINT_ZONE' | 'PLAIN' | 'BLOCK',
  failed: false            // degraded-working levels set this true
}
```

| ID | Pri | Requirement |
|---|---|---|
| `DAT-040` | M | Occupancy is **derived every tick** from train extents, never stored as authoritative player-mutable state. |
| `DAT-041` | M | `occupied = trains.some(t => t.occupiedCircuits.includes(id)) \|\| failed`. A failed circuit reads occupied forever until repaired. |
| `DAT-042` | M | A `POINT_ZONE` circuit covers the full swing of a turnout plus clearance. Points inside it are immovable while it is occupied (`ILK-030`). |

### 4.6 Point (turnout)

```js
{
  id: 'P101',
  toeNode: 'N_P101_T',
  normalNode: 'N_P101_N',   // straight / main route
  reverseNode: 'N_P101_R',  // diverging route
  position: 'NORMAL' | 'REVERSE',
  moving: false,
  moveTimeS: 4,             // seconds to swing
  lockedBy: null,           // routeId, or null
  circuitId: 'TC_P101',     // the point-zone circuit
  facingFor: ['UP']         // directions in which this is a facing point
}
```

| ID | Pri | Requirement |
|---|---|---|
| `DAT-050` | M | A point takes `moveTimeS` to swing. During the swing it is `moving: true` and **no route through it may be proved**. |
| `DAT-051` | M | `lockedBy !== null` ⇒ the point MUST NOT move under any code path, player intent, or route request. |
| `DAT-052` | M | Point indicators render as a small dot: green for `NORMAL`, yellow for `REVERSE`, flashing white while `moving`. |

### 4.7 Signal

```js
{
  id: 'H1',
  type: 'DISTANT'|'OUTER'|'HOME'|'STARTER'|'ADVANCED_STARTER'|'SHUNT',
  atNode: 'N_H1',
  facing: 'UP' | 'DN',        // direction of travel it governs
  lampCount: 4,               // 4 for MACLS running signals, 3 for distant, 2 for shunt
  hasCallingOn: true,
  hasRouteIndicator: true,    // multi-lamp / directional indicator for diverging routes
  plate: 'P' | 'C' | null,
  overlapM: 120,
  nextSignalIds: { NORMAL: 'S1', REVERSE: 'S2' },  // signal ahead per point setting
  // runtime:
  aspect: 'RED',              // derived; never assigned by player
  routeIndicator: null,       // e.g. '1' for loop 1, null when not diverging
  callingOnLit: false
}
```

`DAT-060` **(M)** `aspect` is recomputed from scratch every tick by
`signalling.computeAspect()`. Nothing else in the codebase may write to it.

### 4.8 Route

Routes are **authored data**, not path-found at runtime.

```js
{
  id: 'R_H1_PF1',
  fromSignal: 'H1',
  toBerth: 'TC_PF1',
  edgeIds: ['E_A','E_B','E_C'],
  circuitIds: ['TC_A','TC_B','TC_PF1'],
  pointSettings: { P101: 'REVERSE', P102: 'NORMAL' },
  overlapCircuitIds: ['TC_OV1'],
  overlapM: 120,
  diverging: true,            // ⇒ Home shows YELLOW + indicator, never GREEN
  indicatorText: '1',
  conflictsWith: ['R_H1_PF2','R_H2_PF1', ...],   // precomputed at load
  class: 'MAIN' | 'SHUNT' | 'CALL_ON',
  usableLengthM: 650          // clear standing room from signal to fouling mark
}
```

| ID | Pri | Requirement |
|---|---|---|
| `DAT-070` | M | `conflictsWith` MUST be **computed at load time** by `layout.buildConflictTable()`, not hand-authored, so it cannot drift from the topology. |
| `DAT-071` | M | Two routes conflict if they share any `circuitId`, share any point with **opposing** required positions, or if either's overlap circuits intersect the other's route circuits. |
| `DAT-072` | M | Head-on conflict: two routes whose direction of travel opposes on any shared edge always conflict, regardless of circuit overlap. |
| `DAT-073` | M | `usableLengthM` is measured from the signal to the **fouling mark** at the far end. This is the number a train's length is tested against (`ILK-080`). |

### 4.9 Layout validation

`DAT-080` **(M)** `layout.validate()` MUST reject a layout and report the
offending ID for each of:

1. An edge referencing a non-existent node.
2. A node of `kind: 'POINT_TOE'` with no matching point record.
3. A track circuit with zero edges.
4. A signal whose `atNode` is not on any edge.
5. A route whose `edgeIds` do not form a connected path.
6. A route whose `pointSettings` do not match the points actually on its path.
7. A route with no overlap circuits when `fromSignal.type !== 'DISTANT'`.
8. A `nextSignalIds` entry pointing at a non-existent signal.
9. Any route reachable into a `BUFFER` node without `class: 'SHUNT'`.

---

## 5. Track layout — the shipped station

`LAY-001` **(M)** Ship **one** fully realised station, `KHARGAON JN`, a double-line
junction. Schematic:

```
                  ┌───────── LOOP 1  (PF 1) ─────────┐
                  │  P101                      P103  │
  ══D1══O1══H1════╪═══════ UP MAIN (PF 2) ═══════════╪═══[S2]═══AS1══>  BLOCK EAST
                  │                                  │
  <══AS2══[S3]════╪═══════ DN MAIN (PF 3) ═══════════╪═══H2══O2══D2═══  BLOCK WEST
                  │  P102                      P104  │
                  └───────── GOODS LOOP ─────────────┘
                                  │ P105
                                  └── SIDING ──▌ (buffer stop)
```

### 5.1 Line inventory

| Line | Circuits | Usable length | Max speed | Notes |
|---|---|---|---|---|
| UP MAIN / PF 2 | `TC_UM1..4` | 700 m | 110 km/h | Straight run — the only Green road for UP |
| DN MAIN / PF 3 | `TC_DM1..4` | 700 m | 110 km/h | Straight run for DN |
| LOOP 1 / PF 1 | `TC_L1A..C` | 620 m | 30 km/h | Holds 24 LHB coaches + loco (597 m) |
| GOODS LOOP | `TC_GLA..C` | 720 m | 30 km/h | Holds a 58-BOXN rake + loco (~650 m) |
| SIDING | `TC_SD1` | 130 m | 15 km/h | Dead end. 8 wagons + shunter. Shunt routes only |

`LAY-010` **(M)** These lengths are **enforced**, not decorative. A rake longer
than `usableLengthM` is refused entry (`ILK-080`).

### 5.2 Signal inventory

| ID | Type | Governs | Lamps |
|---|---|---|---|
| `D1` | Distant | UP approach, ~1000 m before `O1` | 3 (Y/G/Y), `P` plate |
| `O1` | Outer | UP, 700 m before `H1` | 4 |
| `H1` | Home | UP, at the toe of `P101`/`P102` | 4 + calling-on + route indicator |
| `S1` | Starter | Departure end of LOOP 1 | 4 |
| `S2` | Starter | Departure end of UP MAIN | 4 |
| `S4` | Starter | Departure end of GOODS LOOP | 4 |
| `AS1` | Advanced Starter | UP, beyond `P103`/`P104` | 4 |
| `D2`,`O2`,`H2`,`S3`,`AS2` | mirror set | DN direction | as above |
| `SH1`,`SH2` | Shunt | Siding neck, goods loop neck | 2 (position-light) |

`LAY-020` **(M)** Signal siting order on approach MUST be Distant → Outer →
Home → (platform) → Starter → Advanced Starter. Placing them out of order is a
correctness defect.

`LAY-021` **(M)** The **station section** = Home to Advanced Starter. This is the
player's authority. Outside it, the block system governs (§8).

### 5.3 Route table

`LAY-030` **(M)** The shipped layout MUST define at minimum these routes:

| Route ID | From | To | Diverging | Indicator |
|---|---|---|---|---|
| `R_H1_PF2` | H1 | UP MAIN | no | — |
| `R_H1_PF1` | H1 | LOOP 1 | yes | `1` |
| `R_H1_GL`  | H1 | GOODS LOOP | yes | `G` |
| `R_H2_PF3` | H2 | DN MAIN | no | — |
| `R_H2_PF1` | H2 | LOOP 1 | yes | `1` |
| `R_H2_GL`  | H2 | GOODS LOOP | yes | `G` |
| `R_S1_AS1` | S1 | AS1 | yes | — |
| `R_S2_AS1` | S2 | AS1 | no | — |
| `R_S4_AS1` | S4 | AS1 | yes | — |
| `R_S3_AS2` | S3 | AS2 | no | — |
| `R_AS1_BLK` | AS1 | BLOCK EAST | no | — |
| `R_AS2_BLK` | AS2 | BLOCK WEST | no | — |
| `R_SH1_SD` | SH1 | SIDING | yes | shunt |
| `R_CO_H1_PF1` | H1 | LOOP 1 (calling-on) | yes | `C` |
| `R_CO_H1_PF2` | H1 | UP MAIN (calling-on) | no | `C` |

`LAY-031` **(S)** Layout data SHOULD be authored so a second station can be added
by appending to a `LAYOUTS` registry keyed by station ID.

---

## 6. Signalling

### 6.1 Aspects

`SIG-001` **(M)** Exactly four running aspects exist: `RED`, `YELLOW`,
`DOUBLE_YELLOW`, `GREEN`. There is **no double green**. Inventing a fifth aspect
is a defect.

| Aspect | Driver meaning | Target speed behaviour |
|---|---|---|
| `RED` | Stop dead, do not pass | Brake to 0 before the signal |
| `YELLOW` | Proceed, be prepared to stop at the **next** signal | Brake so as to be able to stop at next signal |
| `DOUBLE_YELLOW` | Attention; next is Yellow, the one after is Red | Reduce toward medium speed (`70 km/h`) |
| `GREEN` | Clear, line speed | Accelerate to line speed |

### 6.2 Lamp geometry

`SIG-010` **(M)** A 4-lamp MACLS signal, drawn **bottom to top**:

```
   ( )   index 3  — YELLOW (upper)
   ( )   index 2  — GREEN
   ( )   index 1  — YELLOW (lower)
   ( )   index 0  — RED     (bottom, driver's eye level)
```

`SIG-011` **(M)** The upper yellow sits **above** the green, not adjacent to the
lower yellow. This is fail-safe geometry: a blown lamp degrades to a *more*
restrictive aspect. Drawing both yellows adjacent is a correctness defect.

`SIG-012` **(M)** Lit lamps per aspect:

| Aspect | Lamps lit |
|---|---|
| `RED` | index 0 |
| `YELLOW` | index 1 |
| `DOUBLE_YELLOW` | index 1 **and** index 3 |
| `GREEN` | index 2 |

`SIG-013` **(M)** Distant signals have 3 lamps, bottom to top: `YELLOW`,
`GREEN`, `YELLOW`. A distant signal MUST NOT be capable of showing `RED`
(`SIG-030`).

`SIG-014` **(M)** Unlit lamps render as `#14181e` fill with a `#2a3038` rim. Lit
lamps get a saturated fill plus a radial-gradient glow of radius `2.5 × lampR`.

`SIG-015` **(S)** Aspect changes animate over 150 ms (crossfade), purely
cosmetic; the logical aspect changes instantly.

### 6.3 Signal types

| ID | Pri | Requirement |
|---|---|---|
| `SIG-020` | M | **Distant** — warning only. Shows `YELLOW`/`DOUBLE_YELLOW`/`GREEN`, never `RED`. Sited ~1000 m before the Outer. Carries a `P` plate. |
| `SIG-021` | M | **Outer** — outermost stop signal. Cannot clear until Line Clear has been granted for the incoming train and the line beyond is clear. |
| `SIG-022` | M | **Home** — protects the yard and the first facing points. This is the signal that admits a train to a platform or loop. Carries the route indicator. |
| `SIG-023` | M | **Starter** — one per platform line, at the departure end. Authorises departure from the platform toward the Advanced Starter. |
| `SIG-024` | M | **Advanced Starter** — beyond the outermost points. Admits the train into the **block section**. Cannot clear without Line Clear from the next station (`BLK-020`). |
| `SIG-025` | M | **Shunt** — two-lamp position light. Authorises movement at ≤15 km/h, prepared to stop short of any obstruction. Never authorises a main-line movement. |

`SIG-030` **(M)** A Distant signal's aspect mirrors the state ahead:

```
outer = signalAhead(distant)
if      (outer.aspect === RED)            distant = YELLOW
else if (outer.aspect === YELLOW)         distant = DOUBLE_YELLOW
else if (outer.aspect === DOUBLE_YELLOW)  distant = GREEN
else                                      distant = GREEN
```

### 6.4 Aspect computation — the core algorithm

`SIG-040` **(M)** `signalling.computeAspect(sig, state)` MUST be a **pure
function** and MUST implement exactly this cascade, in order:

```js
function computeAspect(sig, st) {
  if (sig.type === 'DISTANT') return distantAspect(sig, st);      // SIG-030
  if (sig.type === 'SHUNT')   return shuntAspect(sig, st);        // SIG-025

  const route = st.activeRouteFrom(sig.id);

  // 1. No route  →  RED
  if (!route || route.state !== 'LOCKED_AND_PROVED') return 'RED';

  // 2. Any circuit in the route, its berth, or its overlap occupied → RED
  if (route.circuitIds.some(c => st.occupied(c)))          return 'RED';
  if (route.overlapCircuitIds.some(c => st.occupied(c)))   return 'RED';

  // 3. Any point in the route not proved in the required position → RED
  for (const [pid, pos] of Object.entries(route.pointSettings))
    if (st.point(pid).position !== pos || st.point(pid).moving) return 'RED';

  // 4. Diverging route (turnout at restricted speed) → YELLOW + indicator
  if (route.diverging) { sig.routeIndicator = route.indicatorText; return 'YELLOW'; }
  sig.routeIndicator = null;

  // 5. Look ahead
  const next = st.signal(route.nextSignalId);
  if (!next)                          return 'GREEN';   // exits the modelled world
  if (next.aspect === 'RED')          return 'YELLOW';
  if (next.aspect === 'YELLOW')       return 'DOUBLE_YELLOW';
  return 'GREEN';                                        // next is DY or G
}
```

| ID | Pri | Requirement |
|---|---|---|
| `SIG-041` | M | Rule 4 is authentic and non-negotiable: **a train received into a loop takes a turnout at restricted speed, so the Home shows Yellow with a route indicator even when everything beyond is clear.** Only a straight run on the main line earns Green. |
| `SIG-042` | M | Because step 5 reads `next.aspect`, aspects MUST be computed in **reverse order of travel** (furthest-ahead signal first) each tick, so the cascade converges in a single pass. Compute a topological order once at load. |
| `SIG-043` | M | If the topology contains a cycle (loop lines can create one), break it by iterating to a fixed point with a cap of 8 passes; log a warning to the debug overlay if the cap is hit. |
| `SIG-044` | M | Aspect changes MUST be logged to the event log at `debug` verbosity only — the main log would flood. |

### 6.5 Subsidiary signals

`SIG-050` **(M)** **Calling-On**: a single small yellow lamp on the same post,
below the main head, with a `C` plate. When lit, a train may pass the main signal
at Red and creep into an **already-occupied** platform at ≤ `CALL_ON_SPEED_KPH = 15`.

`SIG-051` **(M)** Calling-on may be cleared only when **all** hold:

1. The main signal on the same post is at `RED`.
2. The route ahead is set and points are locked and proved.
3. The destination berth is occupied (that is the whole point of it) **or** the
   route cannot be cleared for a reason the calling-on is authorised to bypass.
4. No shunt signal on the same post is off.
5. The train has been **at a stand** at the signal for ≥ `CALL_ON_DWELL_S = 60`
   seconds. (Real practice: the driver stops, then is called on.)

`SIG-052` **(M)** If any condition fails, the calling-on button is disabled and
hovering it shows which condition is unmet.

`SIG-053` **(M)** A train proceeding on calling-on is speed-limited to 15 km/h
for the whole movement and MUST stop short of the standing train. Failure to stop
short is a collision (`FAI-020`), not a lesser penalty.

`SIG-054` **(M)** Passing a Red **with** calling-on lit is not a SPAD. Passing a
Red **without** it is (`FAI-010`).

---

## 7. Interlocking

`ILK-001` **(M)** The interlocking is a **physical safety system**, not advice.
It MUST make unsafe things impossible, never merely discouraged or penalised.

`ILK-002` **(M)** Every refused request MUST produce a short, readable reason in
the message strip. **No click may ever be silently ignored.**

### 7.1 Route state machine

`ILK-010` **(M)** A route moves through exactly these states:

```
 IDLE
   │ REQUEST_ROUTE, all validations pass
   ▼
 LOCKING          points swinging (moveTimeS), route reserved, signal still RED
   │ all points proved in position
   ▼
 LOCKED_AND_PROVED   signal may now show a proceed aspect (§6.4)
   │ train enters first route circuit
   ▼
 OCCUPIED         sectional release begins behind the train
   │ last circuit cleared
   ▼
 IDLE

 From LOCKING or LOCKED_AND_PROVED:
   │ CANCEL_ROUTE with no train approaching  → IDLE immediately
   │ CANCEL_ROUTE with train approaching     → APPROACH_LOCKED (120 s) → IDLE
```

`ILK-011` **(M)** The signal MUST remain at `RED` throughout `LOCKING`. Only
`LOCKED_AND_PROVED` permits a proceed aspect.

### 7.2 Validation pipeline

`ILK-020` **(M)** `interlock.requestRoute(routeId, state)` returns
`{ ok: true }` or `{ ok: false, code, message }`. Checks run in this order and
return the **first** failure:

| # | Check | Refusal code | Player-facing message |
|---|---|---|---|
| 1 | Route exists from that signal to that destination | `NO_SUCH_ROUTE` | `NO ROUTE — H1 to PF3 is not a valid road` |
| 2 | Route is not already set | `ALREADY_SET` | `ROUTE ALREADY SET — H1 → PF1` |
| 3 | No conflicting route is set | `CONFLICT` | `ROUTE REFUSED — conflicts with route H2 → PF1` |
| 4 | No route circuit is occupied | `TRACK_OCCUPIED` | `ROUTE REFUSED — TC_L1B occupied` |
| 5 | No point in the route is locked by another route | `POINT_LOCKED` | `ROUTE REFUSED — point P101 locked by H2 → PF1` |
| 6 | No point in the route sits in an occupied point-zone circuit | `POINT_UNDER_TRAIN` | `ROUTE REFUSED — cannot move P101, train standing on it` |
| 7 | Overlap circuits clear for `overlapM` | `OVERLAP_FOULED` | `ROUTE REFUSED — overlap beyond H1 is not clear (120 m required)` |
| 8 | Approaching train fits the destination (`ILK-080`) | `TRAIN_TOO_LONG` | `ROUTE REFUSED — GOODS 58123 is 651 m, LOOP 1 holds 620 m` |
| 9 | Destination is not a `BUFFER` unless route class is `SHUNT` | `DEAD_END` | `ROUTE REFUSED — SIDING is a dead end, shunt movement only` |
| 10 | For `ADVANCED_STARTER`: Line Clear granted (`BLK-020`) | `NO_LINE_CLEAR` | `ROUTE REFUSED — BLOCK EAST has not granted Line Clear` |
| 11 | No approach-locking timer running on this route | `APPROACH_LOCKED` | `ROUTE LOCKED — approach locking, 96 s remaining` |
| 12 | Failed track circuit in route (degraded levels) | `CIRCUIT_FAILED` | `ROUTE REFUSED — TC_UM2 shows failed; use manual authority` |

`ILK-021` **(M)** The refusal message MUST name the specific conflicting object.
`ROUTE REFUSED` alone is insufficient.

`ILK-022` **(M)** Refusal messages persist in the message strip for 6 seconds and
are appended to the event log.

### 7.3 Points lock under a set route

| ID | Pri | Requirement |
|---|---|---|
| `ILK-030` | M | When a route reaches `LOCKING`, every point in `pointSettings` gets `lockedBy = routeId`. |
| `ILK-031` | M | A locked point MUST NOT move via any code path: no player intent, no route request, no shunt operation, no debug command in a non-debug build. |
| `ILK-032` | M | A point whose `circuitId` is occupied MUST NOT move, locked or not. This is `ILK-002`'s strongest case: it is **impossible**, not penalised. |
| `ILK-033` | M | If code ever attempts to move a locked or occupied point, throw in the self-test build and log a hard error in release. This is the class of bug that kills people; make it loud. |

### 7.4 Overlap

| ID | Pri | Requirement |
|---|---|---|
| `ILK-040` | M | `OVERLAP_M = 120` for MACLS. The track beyond the destination signal MUST be clear for 120 m before the signal governing entry may clear. |
| `ILK-041` | M | Overlap circuits are held locked while the route is set and released only after the train has come to a stand in the berth, or has passed clear. |
| `ILK-042` | M | The overlap MUST be drawn in the debug overlay as a distinct hatched region so the developer can verify it. |

### 7.5 Approach locking / cancellation delay

| ID | Pri | Requirement |
|---|---|---|
| `ILK-050` | M | "Train approaching" = a train is within the **approach-locking berth** (the circuit immediately in rear of the signal) **or** within braking distance of the signal at its current speed, whichever is greater. |
| `ILK-051` | M | Cancelling a route in `LOCKED_AND_PROVED` with a train approaching sets the signal to `RED` **immediately** and starts `APPROACH_LOCK_S = 120` seconds. Points remain locked for the full duration. |
| `ILK-052` | M | Cancelling with no train approaching releases immediately. |
| `ILK-053` | M | The 120 s countdown MUST be displayed prominently — a visible timer on the route, not buried in a log. It should hurt, and the player should watch it hurt. |
| `ILK-054` | M | The timer MUST NOT be cancellable, skippable, or affected by pause (it counts sim time, so pausing pauses it, but 5× speed also runs it 5× faster — that is correct and consistent). |

### 7.6 Sectional route release

| ID | Pri | Requirement |
|---|---|---|
| `ILK-060` | M | As the train's tail clears each track circuit in the route, that circuit and its points release **behind** the train. |
| `ILK-061` | M | The signal at the entrance to a released section returns to `RED` **immediately** as the train's head passes it. |
| `ILK-062` | M | The player MUST NOT have any control to put a signal back to danger. Signals return to Red on their own. Any "set signal to red" button is a defect. |
| `ILK-063` | M | Release order MUST follow the train, not the clock: circuit *n* releases only after the train's tail has passed the far end of circuit *n*. |
| `ILK-064` | M | The berth circuit releases only when the train's tail clears it — for a train stopping at a platform, that is when it departs. |

### 7.7 Fouling marks and train length

| ID | Pri | Requirement |
|---|---|---|
| `ILK-070` | M | Each loop line has a **fouling mark** at each end, drawn as a short white tick across the track. |
| `ILK-071` | M | A train standing with any part beyond the fouling mark **fouls** the adjacent line: any route through that adjacent line is refused with `FOULING` and the fouling mark renders red and flashing. |
| `ILK-072` | M | Fouling is detected geometrically from the train's head and tail positions, not by circuit occupancy alone. |
| `ILK-080` | M | Before granting a reception route, compare the approaching train's `lengthM` against the route's `usableLengthM`. If it does not fit, refuse with `TRAIN_TOO_LONG` and state both numbers. |
| `ILK-081` | M | This check runs at **route request time**, so the player learns before committing — never as a surprise after the train is halfway in. |

### 7.8 Degraded working

| ID | Pri | Requirement |
|---|---|---|
| `ILK-090` | M | A track circuit may be marked `failed: true` by a level script. It then reads permanently occupied and no route through it can be signalled. |
| `ILK-091` | M | Under failure, the player gains a **Manual Authority** control: issue a written authority (paper line clear) to a specific train to pass a specific signal at danger at ≤ `MANUAL_AUTHORITY_KPH = 15`. |
| `ILK-092` | M | A train moving on manual authority does not SPAD, but the player MUST first confirm the section is clear via a **confirmation dialog listing every train the game believes is in that section**. Getting it wrong is a collision, and the player owns it. |
| `ILK-093` | M | The failed circuit renders with a distinct magenta cross-hatch and a `TC FAILED` label, so it can never be mistaken for a real occupancy. |

---

## 8. Block working

| ID | Pri | Requirement |
|---|---|---|
| `BLK-001` | M | Each block section (`BLOCK EAST`, `BLOCK WEST`) has a block instrument with states: `LINE_CLOSED`, `LINE_CLEAR_ASKED`, `LINE_CLEAR_GRANTED`, `TRAIN_ON_LINE`, `TRAIN_ARRIVED`. |
| `BLK-002` | M | **Absolute block**: at most one train in a block section at a time. Enforced structurally — a second `ASK_LINE_CLEAR` while `TRAIN_ON_LINE` is refused. |
| `BLK-010` | M | Sending a train: player presses **Ask Line Clear** → neighbouring station (simulated) replies after `LINE_CLEAR_REPLY_S` (2–8 s, seeded random) with grant or refusal. |
| `BLK-011` | M | The neighbour refuses if its own section is occupied by the level script. Refusal shows `LINE CLEAR REFUSED BY MIRAJ — SECTION OCCUPIED`. |
| `BLK-020` | M | `AS1`/`AS2` MUST NOT clear until the corresponding block shows `LINE_CLEAR_GRANTED`. |
| `BLK-021` | M | When the train passes the Advanced Starter, block goes to `TRAIN_ON_LINE`; when the neighbour reports arrival (after transit time), it returns to `LINE_CLOSED`. |
| `BLK-030` | M | Receiving a train: the neighbour asks the player for Line Clear. A **Grant Line Clear** button lights. Granting requires the reception line to be clear up to the Home overlap; otherwise the button is disabled with a tooltip reason. |
| `BLK-031` | M | An ungranted request escalates: after 120 s the log shows `MIRAJ REPEATING LINE CLEAR REQUEST` and a delay penalty begins accruing against the waiting train. |
| `BLK-040` | M | The block instrument panel MUST render as a distinct HUD widget per direction, with the current state in plain words (`BLOCK EAST — TRAIN ON LINE (12951)`). |

---

## 9. Trains

### 9.1 Train record

```js
{
  id: 12951,
  name: 'MUMBAI RAJDHANI',
  class: 'RAJDHANI',
  priority: 1,
  lengthM: 597,
  maxSpeedKph: 130,
  direction: 'UP',
  stopsHere: false,
  schedArrival: 36000,      // sim seconds since midnight
  schedDeparture: 36060,
  minDwellS: 60,
  // runtime
  headEdge: 'E_UM2', headOffsetM: 143.2,
  speedMps: 24.1,
  state: 'APPROACHING'|'RUNNING'|'BRAKING'|'STOPPED'|'DWELLING'|'DEPARTED',
  held: false,
  delayS: 0,
  occupiedCircuits: ['TC_UM2','TC_UM3']
}
```

### 9.2 Train classes

| Class | Priority | Colour | Typical length | Max speed | Notes |
|---|---|---|---|---|---|
| Vande Bharat / Rajdhani | 1 | deep blue `#1b3a8c` | 400–600 m | 130 km/h | Usually runs through. Never delay. |
| Shatabdi | 2 | royal blue `#2f5fd0` | 450 m | 130 km/h | |
| Mail / Express | 3 | red-orange `#e0602c` | 550 m | 110 km/h | The bread and butter |
| Passenger | 4 | green `#2f9e4f` | 350 m | 75 km/h | Stops everywhere |
| MEMU / EMU | 5 | teal `#1f9c9c` | 200 m | 100 km/h | Short, quick to clear |
| Goods / Freight | 6 | grey-brown `#7a6a54` | 600–700 m | 60 km/h | Long, slow, hard to fit |
| Light engine | 7 | yellow `#d8c33a` | 21 m | 80 km/h | Very short |

`TRN-010` **(M)** Priority is used by the scoring weight (`SCO-020`) and by the
precedence advisor (`UI-070`). Holding a priority-1 train to let a priority-6
train pass MUST be scored as a serious operating error.

### 9.3 Physics

| ID | Pri | Requirement |
|---|---|---|
| `TRN-020` | M | Longitudinal point-mass model with a length. Head position = `(edge, offsetM)`; tail derived by walking back `lengthM` along the traversed path. |
| `TRN-021` | M | Integration: `v += a·DT`, `s += v·DT`, semi-implicit Euler. Clamp `v ≥ 0`. |
| `TRN-022` | M | Acceleration constants (m/s²): passenger classes `ACCEL = 0.5`, goods `0.25`. Service brake: passenger `BRAKE_SVC = 0.7`, goods `0.35`. Emergency brake: passenger `1.2`, goods `0.6`. |
| `TRN-023` | M | Braking distance `d = v² / (2·b)` plus `REACTION_S = 3` seconds of driver reaction at current speed. This is the number that makes Yellow and Double Yellow mean something. |
| `TRN-024` | M | Gradient contributes `a_grad = -9.81 · gradientPermille/1000`. |
| `TRN-025` | M | Speed is capped by `min(train.maxSpeedKph, edge.maxSpeedKph, routeRestriction)`. Diverging routes impose `TURNOUT_KPH = 30`. |
| `TRN-026` | M | A train MUST NOT be able to stop instantly. If a Yellow appears too late for `d`, the train SPADs. That is the intended, teachable outcome (`DOD-009`). |

### 9.4 Driver model

`TRN-030` **(M)** Each tick, the driver computes a target speed from the nearest
signal ahead and its aspect:

```js
function targetSpeed(train, st) {
  const sig = st.nextSignalAhead(train);
  const d   = st.distanceTo(train, sig);            // metres, head to signal

  switch (sig.aspect) {
    case 'RED':
      if (train.callingOnAuthority) return kph(15);
      return brakeCurve(d, 0);                       // stop AT the signal
    case 'YELLOW': {
      const dNext = d + st.distanceBetween(sig, st.signalAfter(sig));
      return Math.min(brakeCurve(dNext, 0), kph(sig.routeIndicator ? 30 : 60));
    }
    case 'DOUBLE_YELLOW': return kph(70);
    case 'GREEN':         return lineSpeed(train, st);
  }
}

// Highest speed from which the train can still reach vEnd within distance d
function brakeCurve(d, vEnd) {
  const usable = Math.max(0, d - train.speedMps * REACTION_S);
  return Math.sqrt(vEnd*vEnd + 2 * brakeRate(train) * usable);
}
```

| ID | Pri | Requirement |
|---|---|---|
| `TRN-031` | M | The driver is **not clairvoyant**. It reacts only to the aspect currently displayed on the nearest signal ahead, plus its own knowledge of line speed. It MUST NOT read route state, occupancy, or future aspects. |
| `TRN-032` | M | The `REACTION_S = 3` delay applies to aspect *deterioration* only (a signal going more restrictive). Improvements are acted on immediately. |
| `TRN-033` | M | A train at a platform with `stopsHere` waits `max(minDwellS, schedDeparture - now)` before it will move, and additionally will not move while `held` (`INP-050`) or while the Starter is at Red. |
| `TRN-034` | M | Station stop: the train targets a stopping point at the platform centre, not the Starter. Overrunning the platform is a smoothness penalty, not a failure. |
| `TRN-035` | S | Trains draw a **braking-distance ghost** on the diagram when the debug overlay is on: a translucent bar ahead of the train showing where it can still stop. |

### 9.5 Occupancy

| ID | Pri | Requirement |
|---|---|---|
| `TRN-040` | M | `occupiedCircuits` is recomputed each tick by walking the train's extent from tail to head and collecting every circuit it touches. |
| `TRN-041` | M | Occupancy MUST include the full body, not just the head. A 600 m goods train occupies every circuit under it. |
| `TRN-042` | M | Circuit occupancy has no de-bounce and no hysteresis; it is exact and instantaneous. |

### 9.6 Spawning and despawning

| ID | Pri | Requirement |
|---|---|---|
| `TRN-050` | M | Trains spawn at `BOUNDARY` nodes at their timetabled entry time, at line speed unless the level says otherwise. |
| `TRN-051` | M | A spawning train MUST NOT appear inside an occupied circuit. If the entry circuit is occupied, spawning is deferred and the train accrues delay from its scheduled time — and the log says so. |
| `TRN-052` | M | A train reaching the far `BOUNDARY` node despawns, its final delay is banked, and the event log records `12951 DEPARTED BLOCK EAST — 4 MIN LATE`. |

---

## 10. Player controls

### 10.1 Mouse

| ID | Pri | Requirement |
|---|---|---|
| `INP-001` | M | **Set route**: left-click the origin signal (it highlights and enters "route origin" mode), then left-click the destination line or berth. The game looks up the route, throws points, locks, and lets the aspect compute. |
| `INP-002` | M | While in route-origin mode, all valid destinations from that signal highlight in amber. Invalid ones do not highlight. This satisfies `UI-090` — the player sees the possibilities before choosing. |
| `INP-003` | M | Pressing `Esc` or left-clicking empty background exits route-origin mode without side effects. |
| `INP-004` | M | **Cancel route**: right-click the origin signal of a set route. Confirmation dialog if the cancellation will incur the 120 s approach lock, stating the penalty explicitly. |
| `INP-005` | M | **Calling-on**: a distinct small button rendered on the signal post, visible only on signals with `hasCallingOn`, enabled only when `SIG-051` is satisfied. Disabled state shows the unmet condition on hover. |
| `INP-006` | M | **Point throw** (shunting only): shift-click a point. Refused with a reason if locked or occupied. |
| `INP-007` | M | Hovering any track circuit, signal, point or train shows a tooltip with its ID and state. |
| `INP-008` | S | Mouse wheel zooms 0.75×–2×; middle-drag pans. Zoom/pan never affect simulation. |
| `INP-009` | M | The click target for a signal is a padded hitbox of at least 24×24 px regardless of zoom. |

### 10.2 Keyboard

`INP-020` **(M)** Full keyboard parity:

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Cycle focus through signals and controls |
| `Enter` | Activate focused signal as route origin, then as destination |
| `Esc` | Cancel current selection / close dialog |
| `Delete` | Cancel the route from the focused signal |
| `C` | Calling-on for the focused signal |
| `A` | Ask Line Clear for the focused block |
| `G` | Grant Line Clear for the focused block |
| `H` | Hold / release the focused train |
| `Space` | Pause / resume |
| `1` `2` `5` | Set speed 1× / 2× / 5× |
| `L` | Toggle event log panel |
| `T` | Toggle train-order list |
| `?` | Rules reference overlay |
| `` ~ `` | Debug overlay |

### 10.3 Other controls

| ID | Pri | Requirement |
|---|---|---|
| `INP-040` | M | **Block instruments**: "Ask Line Clear" and "Grant Line Clear" buttons, one pair per adjacent station, showing current instrument state. |
| `INP-050` | M | **Hold / release**: a train standing at a platform can be held. A held train will not depart even with the Starter off. The train renders with an `H` badge. |
| `INP-051` | M | **Time controls**: Pause, 1×, 2×, 5× as visible buttons plus keyboard. Current speed always visible. |
| `INP-052` | M | **Manual authority** (degraded levels only, `ILK-091`). |

---

## 11. Screen layout and HUD

`UI-001` **(M)** Screen regions at 1280×720:

```
┌────────────────────────────────────────────────────────────────────┐
│ 10:04:12   KHARGAON JN        [‖][1×][2×][5×]   SCORE 8420   LVL 4 │  40 px header
├─────────────────────────────────────────────┬──────────────────────┤
│                                             │  TRAIN ORDER         │
│                                             │  12951 RAJDHANI      │
│            TRACK DIAGRAM                    │    10:04 / 10:04  ✓  │
│            (canvas, ~940 × 560)             │  56321 GOODS         │
│                                             │    10:02 / 10:19 +17 │
│                                             ├──────────────────────┤
│                                             │  BLOCK EAST          │
│                                             │  LINE CLEAR GRANTED  │
│                                             │  [ASK] [GRANT]       │
├─────────────────────────────────────────────┴──────────────────────┤
│ ROUTE REFUSED — conflicts with route H2 → PF1                      │  32 px strip
├────────────────────────────────────────────────────────────────────┤
│ 10:03:58  12951 ENTERED BLOCK EAST                                 │  88 px log
│ 10:03:31  ROUTE SET  S2 → AS1                                      │
└────────────────────────────────────────────────────────────────────┘
```

| ID | Pri | Requirement |
|---|---|---|
| `UI-010` | M | **Clock** — sim wall time, `HH:MM:SS`, monospace, always visible. |
| `UI-020` | M | **Train order list** — every train in the level: number, name, class colour swatch, scheduled vs actual arrival/departure, current delay in minutes, current state. Late trains highlighted amber, >15 min late red. |
| `UI-021` | M | Clicking a train in the list pans/highlights it on the diagram. |
| `UI-030` | M | **Event log** — scrolling, timestamped, newest at the bottom, ~200 line ring buffer. Format `HH:MM  MESSAGE`, e.g. `12:04 RAJDHANI 12951 ENTERED BLOCK`. |
| `UI-031` | M | Log entries are categorised (`ROUTE`, `SIGNAL`, `BLOCK`, `TRAIN`, `REFUSAL`, `HAZARD`) and colour-coded; refusals and hazards are visually distinct. |
| `UI-040` | M | **Message strip** — one line, large, for the most recent refusal or important notice. Persists 6 s then fades. Never empty-flashes. |
| `UI-050` | M | **Block instrument widget** per adjacent station, showing state in plain words plus the two buttons. |
| `UI-060` | M | **Score readout** — current score plus a breakdown on hover (safety/punctuality/throughput/smoothness). |
| `UI-070` | S | **Precedence hint** — when two trains are contending, a subtle advisory shows their priorities. Advisory only; the player may ignore it and be scored accordingly. |
| `UI-080` | M | **Rules reference** (`?`) — a scrollable overlay listing the aspect table, the interlocking rules, and the failure conditions. Pauses the game while open. |
| `UI-090` | M | **No unexplained punishment.** Before any rule can be broken for the first time in a level, the level's briefing or an inline tooltip MUST have surfaced it. Track "rules introduced" per level and assert this in tests. |

---

## 12. Rendering

### 12.1 Palette

`REN-001` **(M)** Exact colours:

| Token | Hex | Use |
|---|---|---|
| `BG` | `#0b0e12` | Background |
| `TRACK_IDLE` | `#3a4048` | Track, no route, unoccupied |
| `TRACK_ROUTE` | `#e8eef5` | Track with a route set through it |
| `TRACK_OCCUPIED` | `#ff3b30` | Track circuit occupied |
| `ROUTE_LOCKING` | `#ffb020` | Amber outline: route locked, not yet cleared |
| `POINT_NORMAL` | `#2fd05a` | Point indicator dot, normal |
| `POINT_REVERSE` | `#ffd23f` | Point indicator dot, reverse |
| `LAMP_RED` | `#ff3b30` | |
| `LAMP_YELLOW` | `#ffcc00` | |
| `LAMP_GREEN` | `#2fd05a` | |
| `LAMP_OFF` | `#14181e` | Unlit lamp fill |
| `LAMP_RIM` | `#2a3038` | Unlit lamp rim |
| `TEXT` | `#c9d4e0` | Labels |
| `TEXT_DIM` | `#6b7885` | Secondary labels |
| `FOULING` | `#ffffff` | Fouling mark tick |
| `FAILED_TC` | `#c04ad0` | Failed track circuit hatch |

### 12.2 Draw order

`REN-010` **(M)** Layers, back to front:

```
1. background fill
2. track centrelines (idle colour)
3. route highlight overlay (white / amber outline)
4. occupancy overlay (red + hatch)
5. fouling marks, scale-break markers
6. point indicator dots
7. train bodies
8. signal posts and lamps
9. text labels (line names, signal IDs, train numbers, indicators)
10. debug overlay (if on)
11. HUD panels
```

### 12.3 Geometry

| ID | Pri | Requirement |
|---|---|---|
| `REN-020` | M | Track line width 3 px idle, 4 px when routed or occupied. Turnouts drawn as 30° diagonals joining parallel lines. No curves. |
| `REN-021` | M | Train body: rounded-cap stroke of width 9 px along the track path, in the class colour, with the train number in `TEXT` alongside, offset perpendicular by 14 px. |
| `REN-022` | M | Train length on screen = `lengthM × edge.drawScale`. A 597 m rake on a 0.5 px/m yard edge is 298 px. Length MUST be visibly to scale — this is how the player judges whether it will fit. |
| `REN-023` | M | Signal post: 2 px vertical stem, 14 px tall, offset 16 px from the track on the driver's left. Lamp radius 4 px, 11 px spacing. |
| `REN-024` | M | Route indicator: when lit, a small white numeral/letter box beside the signal head. |
| `REN-025` | M | Calling-on lamp: radius 3 px, 9 px below the bottom red, with a small `C` plate glyph. |
| `REN-026` | M | Fouling mark: 10 px white tick perpendicular to the track. Turns red and flashes at 2 Hz when fouled. |
| `REN-027` | M | Occupancy hatch: 45° lines, 4 px pitch, over the red fill — satisfies `TEC-041`. |
| `REN-028` | M | Line name labels (`UP MAIN`, `LOOP 1`, `PF 2`) drawn once per line at its left end, 11 px, `TEXT_DIM`. |
| `REN-029` | M | Aspect text label (`R`/`Y`/`YY`/`G`) beside each signal head when the option is on. |

---

## 13. Scoring and failure

### 13.1 Score components

`SCO-001` **(M)** Weighted, in this order of importance:

| Component | Weight | Formula |
|---|---|---|
| Safety | absolute | Any unsafe event ends the level with score 0. No points compensate. |
| Punctuality | 60 % | `1000 − Σ(delayMinutes(t) × priorityWeight(t))` |
| Throughput | 25 % | `400 × (trainsCleared / trainsScheduled)` |
| Smoothness | 15 % | `300 − 10 × avoidableStops − 2 × unnecessaryBrakeEvents` |

`SCO-010` **(M)** `delayMinutes(t)` is measured at despawn (or at level end for
trains still present) against the timetable, in whole minutes, floored at 0.

`SCO-020` **(M)** `priorityWeight = [—, 10, 8, 5, 3, 3, 1, 1][priority]`. A minute
of Rajdhani delay costs ten times a minute of goods delay.

`SCO-030` **(M)** **Avoidable stop**: a train brought to a dead stand at a Red
that a competent player could have cleared in time — detected as: the train
reached 0 km/h at a signal, and at the moment the train entered its braking
distance the route ahead had no conflict and no occupancy. Small penalty. Good
signalling keeps trains *moving*, not merely un-crashed.

`SCO-031` **(M)** **Precedence error**: a lower-priority train given a road that
causes a higher-priority train to be held. Logged explicitly and penalised at
`50 × (priorityDiff)`. Holding a Rajdhani for a Goods is a serious operating
error and MUST be reported as such in the post-level debrief, in words.

`SCO-040` **(M)** Score updates live in the HUD and MUST be explainable — the
hover breakdown shows the actual accumulated numbers, not a mystery total.

### 13.2 Instant-fail events

`FAI-001` **(M)** Any of the following ends the level immediately.

| ID | Event | Detection |
|---|---|---|
| `FAI-010` | **SPAD** — Signal Passed At Danger | Train head crosses a signal's node while that signal shows `RED` and the train holds no calling-on or manual authority for it |
| `FAI-020` | **Collision** | Two trains' extents overlap on the same edge, or two trains occupy the same circuit with converging positions |
| `FAI-030` | **Derailment** | (a) a point changes position while its point-zone circuit is occupied — which MUST be unreachable, so this is also an assertion failure; (b) a train reaches a `BUFFER` node at speed > 0; (c) a train enters a turnout that is `moving` |
| `FAI-040` | **Deadlock** | Two trains face-to-face on a single line with no escape route, or a cycle of trains each blocking the next |

`FAI-041` **(M)** Deadlock detection: build a wait-for graph each 5 s of sim time
— an edge from train A to train B if A's only available routes are all blocked by
B. Any cycle ⇒ deadlock. Declare it explicitly; never let the player sit
confused wondering why nothing moves.

### 13.3 Failure presentation

`FAI-050` **(M)** On failure:

1. Freeze the simulation instantly (not a fade-out; a hard stop).
2. Draw a marker at the exact location of the event, with a leader line.
3. Show a modal with, in plain language and in this order:
   - **What happened.** `SPAD — train 12951 passed signal H1 at danger.`
   - **Which rule was broken.** `A train may not pass a signal showing Red.`
   - **Why it happened here.** `H1 returned to Red when route H1→PF1 was cancelled at 10:03:44. 12951 was 380 m away travelling at 96 km/h and needed 640 m to stop.`
   - **What you should have done.** `Do not cancel a cleared route with a train inside its braking distance. Set the alternative route first, or let the train in and re-route it from the platform.`
4. Offer **Retry level** and **Back to menu**.

`FAI-051` **(M)** The explanation MUST be generated from actual simulation state
(distances, speeds, times), not a canned string. The game teaches by showing the
player their own numbers.

---

## 14. Levels

`LVL-001` **(M)** Levels are data:

```js
{
  id: 3, name: 'CROSSING', station: 'KHARGAON_JN',
  startTime: '10:00:00', durationS: 900, seed: 40317,
  briefing: 'Two trains, opposite directions, one line...',
  rulesIntroduced: ['DIVERGING_YELLOW', 'LOOP_RECEPTION'],
  trains: [ /* timetable rows */ ],
  scriptedEvents: [ { atS: 420, type: 'TC_FAIL', circuitId: 'TC_UM2' } ],
  passCriteria: { minScore: 600, maxDelayMin: 10 }
}
```

`LVL-002` **(M)** Each level introduces **exactly one** new idea and MUST list it
in `rulesIntroduced`. The briefing screen explains that idea before the level
starts (`UI-090`).

| # | Level | New idea | Key content |
|---|---|---|---|
| 1 | **Tutorial** | You set routes, not colours | One train, one route, one signal. Explicitly demonstrate that there is no way to pick a colour. |
| 2 | **Reception and dispatch** | Starter, Advanced Starter | Receive a train to PF 2, then start it away into the block. |
| 3 | **Crossing** | Loop reception; Yellow for diverging | Two trains, opposite directions. One must take Loop 1. Player sees Yellow-plus-indicator instead of Green and is told why. |
| 4 | **Precedence** | Priority | Late Express behind a slow Goods in the loop. The classic decision. |
| 5 | **Rush hour** | Contention | Four trains, three lines, overlapping timings. |
| 6 | **Calling-on** | Subsidiary signals | A second train must join an occupied platform. |
| 7 | **Degraded working** | Manual authority | `TC_UM2` fails and reads permanently occupied. Work the section by written authority with signals unavailable. This is where a real SM earns their salary. |
| 8 | **Junction** | Third direction, route indicators | A branch is added; routing indicators become load-bearing. |

`LVL-010` **(M)** Levels unlock in order. Completed levels remain replayable.
Best score per level persisted (`TEC-008`).

`LVL-011` **(M)** Post-level debrief: score breakdown, every refusal the player
hit, every precedence decision and whether it was correct, total delay per train.

---

## 15. Debug tooling

| ID | Pri | Requirement |
|---|---|---|
| `DBG-001` | M | Overlay toggled with `` ~ ``, off by default. |
| `DBG-002` | M | Shows: every track-circuit ID and occupancy flag; every route's state and timers; every point's position, `lockedBy` and `moving`; every signal's computed aspect and which cascade branch produced it. |
| `DBG-003` | M | Shows per-train: speed (km/h), current braking distance, target speed, nearest signal and its aspect, occupied circuits. |
| `DBG-004` | M | Renders overlap regions as hatched zones (`ILK-042`) and the braking-distance ghost (`TRN-035`). |
| `DBG-005` | M | Shows tick count, ticks-per-frame, dropped ticks, and the RNG seed. |
| `DBG-006` | S | A step-one-tick control (`.`) while paused. |
| `DBG-007` | S | A state dump to the console as JSON (`Ctrl+Shift+D`) for bug reports. |

---

## 16. Testing

### 16.1 Self-test harness

`TST-001` **(M)** Ship an in-file test harness runnable by appending
`?test=1` to the URL (or pressing `Ctrl+Shift+T`). It renders a pass/fail list to
the canvas and returns a non-zero-style summary. Tests cover `layout`,
`interlock`, and `signalling` — the pure modules (`TEC-021`).

`TST-002` **(M)** Tests MUST construct state directly, run the pure function, and
assert. No rendering, no timers, no waiting.

### 16.2 Required test cases

`TST-010` **(M)** Every row below MUST have a passing automated test.

| Test | Assertion |
|---|---|
| `T01` aspect: no route | Signal with no route ⇒ `RED` |
| `T02` aspect: route occupied | Route set, a route circuit occupied ⇒ `RED` |
| `T03` aspect: overlap fouled | Route set, overlap circuit occupied ⇒ `RED` |
| `T04` aspect: diverging | Diverging route, everything ahead clear ⇒ `YELLOW` with indicator, **never** `GREEN` |
| `T05` aspect: next red | Straight route, next signal `RED` ⇒ `YELLOW` |
| `T06` aspect: next yellow | Straight route, next signal `YELLOW` ⇒ `DOUBLE_YELLOW` |
| `T07` aspect: green | Straight route, next `DOUBLE_YELLOW` or `GREEN` ⇒ `GREEN` |
| `T08` three-signal cascade | Set three consecutive straight routes with a train beyond; assert the sequence reads `RED`, `YELLOW`, `DOUBLE_YELLOW`, `GREEN` in the right places |
| `T09` distant never red | For all states, distant ∈ {`YELLOW`,`DOUBLE_YELLOW`,`GREEN`} |
| `T10` lamp map | For each aspect, the set of lit lamp indices matches `SIG-012` exactly |
| `T11` conflict refusal | Requesting a route conflicting with a set route returns `code: 'CONFLICT'` and names the other route |
| `T12` point locked | A point with `lockedBy` set cannot be moved by `THROW_POINT` |
| `T13` point under train | A point whose circuit is occupied cannot be moved by any API, including the shunt path |
| `T14` long goods refused | A 651 m rake requesting a 620 m loop returns `TRAIN_TOO_LONG` with both numbers in the message |
| `T15` approach locking | Cancelling a cleared route with a train in the approach berth sets a 120 s timer; the route cannot be reused before it expires |
| `T16` no approach lock | Cancelling with no train approaching releases immediately |
| `T17` sectional release | Simulate a train traversing a 3-circuit route; assert each circuit releases only after the tail clears it, in order |
| `T18` signal drops behind | Assert the origin signal is `RED` on the tick after the train's head passes it |
| `T19` no line clear | `AS1` cannot clear while `BLOCK EAST` is not `LINE_CLEAR_GRANTED` |
| `T20` absolute block | A second `ASK_LINE_CLEAR` while `TRAIN_ON_LINE` is refused |
| `T21` braking distance | A train at 96 km/h given a Yellow 380 m out cannot stop before the next signal ⇒ SPAD is raised |
| `T22` calling-on conditions | Each of the five conditions in `SIG-051`, individually violated, disables calling-on |
| `T23` calling-on not a SPAD | Passing a Red with calling-on lit raises no SPAD |
| `T24` fouling | A train stopped 10 m beyond a fouling mark blocks routes through the adjacent line |
| `T25` deadlock | Two trains face-to-face with no escape is detected within 5 s of sim time |
| `T26` determinism | Same seed + same recorded intent list ⇒ identical state hash after 30 000 ticks |
| `T27` layout validation | Each of the nine failure modes in `DAT-080` is caught with the offending ID in the message |
| `T28` conflict table | `buildConflictTable()` output is symmetric and matches a hand-checked expected set for the shipped layout |
| `T29` purity | `interlock` and `signalling` source text contains no `ctx.`, `document.`, `Math.random`, or `Date.` |
| `T30` no colour control | No input handler produces an intent that sets an aspect |

### 16.3 Manual test script

`TST-020` **(M)** A written manual pass, executed before release, walking each
Definition of Done item in §17 and each level end to end.

---

## 17. Definition of done

`DOD` **(M)** The build is complete when all of the following are demonstrably
true, each verified by a named automated test and a manual observation.

| # | Criterion | Verified by |
|---|---|---|
| 1 | A signal shows Green only when the route is set, straight, and at least two signals ahead are clear | `T07`, `T08` |
| 2 | Receiving a train into a loop yields Yellow plus a route indicator, never Green | `T04`, Level 3 |
| 3 | Double Yellow appears in the correct place in a three-signal sequence | `T06`, `T08` |
| 4 | Signals return to Red behind a passing train without player action | `T17`, `T18` |
| 5 | Attempting a conflicting route is refused with a readable reason naming the conflict | `T11` |
| 6 | Points cannot be moved under an occupied track circuit, by any means | `T12`, `T13` |
| 7 | A goods train too long for a loop is refused entry to that loop | `T14`, Level 4 |
| 8 | Cancelling a cleared route with a train approaching enforces the 120 s delay | `T15`, `T16` |
| 9 | A train given a late Yellow cannot stop in time and SPADs, proving braking distance is real | `T21` |
| 10 | The screen contains no scenery — only track, signals, trains and text | Manual |
| 11 | The player has no way to select an aspect | `T30`, manual |
| 12 | Runs from `file://` with no network activity | Manual, DevTools network tab empty |
| 13 | Deterministic across replays at 1×, 2× and 5× | `T26` |
| 14 | Every enforced rule was surfaced in the UI before it could first be broken | `UI-090` audit per level |

---

## 18. Prohibitions

`NEG-001` **(M)** Do not let the player click a signal to choose its colour.
`NEG-002` **(M)** Do not add scenery, isometric or 3D views, or a driver's-eye camera.
`NEG-003` **(M)** Do not invent aspects. Four only: Red, Yellow, Double Yellow, Green.
`NEG-004` **(M)** Do not use a framework, a bundler, or any asset the file does not contain.
`NEG-005` **(M)** Do not make the interlocking advisory. It is a physical safety system; unsafe things must be *impossible*, not discouraged.
`NEG-006` **(M)** Do not punish the player for something the game never showed them.
`NEG-007` **(M)** Do not path-find routes at runtime. Routes are authored data (`DAT-070`).
`NEG-008` **(M)** Do not let rendering scale leak into physics (`DAT-031`).

---

## 19. Build order

`BLD-001` **(M)** Build incrementally in this order. **Stop after step 1 and show
the diagram before continuing.**

| Step | Deliverable | Exit criterion |
|---|---|---|
| 1 | Render the static track diagram from layout data. Nothing moves. | Diagram matches §5 schematic, readable at 1280×720, `layout.validate()` passes |
| 2 | Track circuits + one hand-placed train that lights them up | Occupancy renders red as the train is moved by a debug slider |
| 3 | Signals with correct lamp geometry, hard-coded aspects | `T10` passes; upper yellow is above the green |
| 4 | Route setting, point throwing, route locking | `T11`–`T13` pass; refusals show reasons |
| 5 | Aspect computation from §6.4 | `T01`–`T09` pass. **This is the moment it becomes the game.** |
| 6 | Train movement with acceleration and braking to aspects | `T21` passes; a late Yellow produces a real SPAD |
| 7 | Sectional release, approach locking, block working | `T15`–`T20` pass |
| 8 | Timetable, scoring, failure modals, level list | §13, §14 complete; debrief explains failures in plain language |
| 9 | Polish: accessibility, debug overlay, self-tests, DoD audit | All of §17 green |

---

## 20. Constants reference

```js
const CONST = {
  TICK_HZ: 60, DT: 1/60, MAX_TICKS_PER_FRAME: 300,
  SPEEDS: [0, 1, 2, 5],

  OVERLAP_M: 120,
  APPROACH_LOCK_S: 120,
  POINT_MOVE_S: 4,
  CALL_ON_SPEED_KPH: 15,
  CALL_ON_DWELL_S: 60,
  MANUAL_AUTHORITY_KPH: 15,
  TURNOUT_KPH: 30,
  SHUNT_KPH: 15,
  REACTION_S: 3,
  LINE_CLEAR_REPLY_S: [2, 8],
  DEADLOCK_SCAN_S: 5,

  ACCEL:      { PAX: 0.5,  GOODS: 0.25 },
  BRAKE_SVC:  { PAX: 0.7,  GOODS: 0.35 },
  BRAKE_EMG:  { PAX: 1.2,  GOODS: 0.6  },

  YARD_SCALE: 0.5,        // px per metre
  APPROACH_SCALE: 0.04,

  PRIORITY_WEIGHT: [0, 10, 8, 5, 3, 3, 1, 1],
  MSG_STRIP_S: 6,
  LOG_LINES: 200,
};
```

---

## 21. Glossary

| Term | Meaning |
|---|---|
| **Aspect** | The indication a signal displays: Red, Yellow, Double Yellow, Green |
| **Advanced Starter** | Signal beyond the outermost points; admits a train to the block section |
| **Approach locking** | Locking that persists after a cleared signal is put back, because a train may already be braking on it |
| **Berth track** | The track circuit immediately in rear of a signal, where a train waits |
| **Block section** | The line between two stations; only one train at a time (absolute block) |
| **Calling-on** | Subsidiary signal permitting entry to an occupied line at very low speed |
| **Facing point** | A turnout a train can be diverted by, in the direction of travel |
| **Fouling mark** | The point beyond which a standing vehicle obstructs the adjacent line |
| **Home signal** | Stop signal protecting the station yard and first facing points |
| **Interlocking** | The safety system preventing conflicting routes, signals and point positions |
| **Line Clear** | Permission from the next station for a train to enter the block section |
| **MACLS** | Multiple Aspect Colour Light Signalling |
| **Overlap** | Safety distance beyond a stop signal that must be clear before it can clear |
| **Route** | A defined path from a signal to a destination, with the point positions it requires |
| **RRI** | Route Relay Interlocking — the panel type this UI imitates |
| **Sectional release** | Releasing a route piece by piece as the train passes, rather than all at once |
| **SPAD** | Signal Passed At Danger |
| **Starter** | Signal at the departure end of a platform line |
| **Track circuit** | An electrical section of track that detects whether a train is on it |
| **Turnout / Point** | The movable trackwork that diverts a train from one line to another |

---

## 22. Reference material

- [IRFCA — Signalling Systems](https://irfca.org/faq/faq-signal.html)
- [IRFCA — Principal Running Signals](https://irfca.org/faq/faq-signal2.html)
- [IRFCA — Subsidiary Signals and Indicators](https://irfca.org/faq/faq-signal3.html)
- [Railway Signalling Concepts — signal locations](https://www.railwaysignallingconcepts.in/railway-signals-location-home-signal-distant-signal-routing-signal-starter-signal-advanced-starter/)
- [IRISET — Colour Light Signalling (PDF)](https://cse.iitkgp.ac.in/~chitta/CRR/sigDocs/S10-ColorAutoSig.pdf)
