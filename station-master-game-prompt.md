# Build prompt — "Station Master" (2D Indian railway signalling game)

> Paste everything below this line into the AI that will build the game.

---

## 0. What you are building

A 2D, top-down **railway signalling simulator** in which the player is the
**Station Master (SM)** of an Indian Railways wayside junction. The player does
not drive trains. The player sets routes, clears signals, decides which train
waits and which train goes, and is judged on **safety first, punctuality second**.

The single most important design rule, which shapes everything else:

> **The player never picks a signal colour.** The player sets a *route*. The
> interlocking decides what aspect the signal is allowed to show. If the player
> could just click "green", the game would have no subject matter.

Build it as a **single-file HTML5 + Canvas game**: one `.html` file, vanilla
JavaScript, no framework, no bundler, no npm, no external assets. It must run by
double-clicking the file. Everything is drawn with Canvas 2D primitives.

---

## 1. The view — this is a panel, not a landscape

The player sees what a real SM sees on a **Route Relay Interlocking (RRI) panel**
or an Electronic Interlocking VDU: **a schematic track diagram and nothing else.**

**Draw only:**
- Track as thin straight lines and simple angled turnouts. Schematic, not
  geographic — curves are drawn as straight segments with 30° diagonals at points.
- Signals as small posts with lamp circles beside the track.
- Point (turnout) position indicators.
- Track-circuit occupancy as colour changes on the track line itself.
- Text labels: signal IDs, line names (`UP MAIN`, `DN MAIN`, `LOOP 1`, `PF 2`),
  train numbers, a clock.

**Do NOT draw:** scenery, buildings, platforms as 3D objects, trees, people,
locomotives with detail, sky, ballast, sleepers, catenary, or any perspective.
Nothing outside the railway. The screen is a diagram.

**Colour language (copy real Indian panels):**

| State | Colour |
|---|---|
| Background | near-black `#0b0e12` |
| Track, unset and unoccupied | dark grey `#3a4048` |
| Track with a route set through it | white `#e8eef5` |
| Track circuit occupied by a train | red `#ff3b30` |
| Route locked but not yet cleared | amber outline |
| Point indicator, normal | small green dot |
| Point indicator, reverse | small yellow dot |

Train bodies are drawn as thick rounded segments along the track, coloured by
train class (§5), with the train number written alongside. A train's length is to
scale with the track — this matters, because long goods trains must physically fit
inside a loop line clear of the fouling marks.

---

## 2. Signalling — get this right, it is the game

Implement **4-aspect Multiple Aspect Colour Light Signalling (MACLS)** as used on
Indian Railways.

### 2.1 The four aspects

| Aspect | Name | Meaning to the driver |
|---|---|---|
| **Red** | Stop / Danger | Stop dead. Do not pass. |
| **Yellow** | Caution | Proceed, be prepared to stop at the **next** signal. |
| **Double Yellow** | Attention | Proceed, next signal is Yellow, the one after is Red. |
| **Green** | Proceed | Clear, proceed at line speed. |

There is **no "double green" aspect.** If a brief you were given says otherwise,
it is wrong — four-aspect MACLS is Red, Yellow, Double Yellow, Green.

### 2.2 Lamp layout — draw it correctly

On a real 4-unit Indian signal the lamps from **bottom to top** are:

```
   ( )   <- Yellow   (upper)
   ( )   <- Green
   ( )   <- Yellow   (lower)
   ( )   <- Red      (bottom, at driver's eye level)
```

The second yellow sits **above** the green, not next to the lower yellow. Two
reasons, both worth honouring in the art: the wide separation makes "double
yellow" unmistakable at distance, and it is **fail-safe** — if one yellow lamp
blows, the driver sees a *more* restrictive aspect, never a less restrictive one.

Draw unlit lamps as dark circles with a faint rim; lit lamps get a coloured fill
plus a soft glow.

### 2.3 Aspect computation — the core algorithm

The aspect a signal shows is **derived**, never chosen. Each tick, for every
running signal, compute:

```
if (no route set through this signal)                 -> RED
else if (route's overlap or berth track is occupied)  -> RED
else if (route diverges through a turnout)            -> YELLOW  + route indicator
else if (next signal ahead shows RED)                 -> YELLOW
else if (next signal ahead shows YELLOW)              -> DOUBLE YELLOW
else                                                  -> GREEN
```

That "route diverges" line is important and authentic: a train being received
into a **loop line** takes a turnout at restricted speed, so the Home signal shows
**Yellow with a route/direction indicator** even when everything ahead is clear.
Straight run through on the main line is what earns a Green.

### 2.4 Signal types to implement

Place them in this order as a train approaches the station:

| Signal | Role |
|---|---|
| **Distant** | Warning only, never shows Red. 3 lamps: Yellow / Green / Yellow. Marked with a `P` plate. Sited ~1 km before the first stop signal. |
| **Outer** | Outermost stop signal. The line must be clear beyond it before Line Clear is granted. |
| **Home** | Protects the station yard and the first facing points. This is the signal that admits a train to a platform or loop. |
| **Starter** | One per platform line, at the departure end. Authorises departure from the platform. |
| **Advanced Starter** | Beyond the outermost points. This is the signal that admits the train into the **block section** to the next station. |

The **station section** is the stretch between the Home signal and the Advanced
Starter. That is the player's domain.

### 2.5 Subsidiary signals

- **Calling-On** — a single small yellow lamp on the same post, below the main
  signal, with a `C` plate. Lets a train pass a Red stop signal and creep into an
  **already-occupied** platform at ~15 km/h. Essential for the "two trains, one
  platform" scenarios. Rules: cannot be cleared while the main signal is off;
  cannot be cleared at the same time as a shunt signal on the same post.
- **Shunt signal** — small, for yard movements only, at a speed that allows
  stopping short of any obstruction.

---

## 3. Interlocking — safety rules the game enforces *for* the player

The interlocking is the safety system. The player should feel it refusing them.
When a request is refused, show a short reason in a message strip
(e.g. `ROUTE REFUSED — conflicts with route H2 → PF1`). Never silently ignore a click.

Enforce all of the following:

1. **No conflicting routes.** Two routes that share any track segment, or that
   cross, cannot both be set.
2. **Points lock under a set route.** Once a route is set, every point in it is
   locked and cannot be moved.
3. **Never move points under a train.** If a track circuit is occupied, its points
   are immovable. This should be impossible, not merely penalised.
4. **Overlap must be clear.** The track beyond a stop signal must be clear for the
   overlap distance (120 m for MACLS) before the signal can be cleared.
5. **Absolute block.** Only one train in a block section at a time. The Advanced
   Starter cannot be cleared until the next station grants **Line Clear**.
6. **Sectional route release.** As the train passes each track circuit, that
   portion of the route releases behind it and the signal drops back to Red
   immediately behind the train. Signals return to Red on their own — the player
   never sets a signal back to danger manually.
7. **Cancellation delay.** Cancelling a route that has already been cleared, with a
   train approaching, imposes a **120-second** timer before the points free up.
   This is approach locking. It should hurt, because it hurts in real life.
8. **Fouling marks.** A train standing in a loop must be clear of the fouling mark
   or the parallel line is blocked. A goods train longer than the loop **cannot be
   received into that loop** — refuse the route with that reason.

---

## 4. Track layout

Ship one well-designed station. Suggested layout, a double-line junction:

```
                    ┌── LOOP 1 (PF 1) ──────────────┐
                    │                                │
  ══D══O══H1════════╪═══ UP MAIN (PF 2) ═════════════╪════AS1══>  to NEXT STN
                    │                                │
  <══AS2════════════╪═══ DN MAIN (PF 3) ═════════════╪═══H2══O══D══
                    │                                │
                    └── GOODS LOOP ─────────────────┘
                             │
                             └── SIDING (dead end)
```

- `D` distant, `O` outer, `H` home, `AS` advanced starter, plus a starter at the
  departure end of every platform line.
- Loop 1 holds 24 coaches. The goods loop holds a full freight rake. The siding
  holds 8 wagons. Make these lengths real and enforced.
- Trains enter from either end and from a third branch direction if you add a
  junction level.

Store the layout as **data, not code** — a JSON-ish object of nodes, edges, track
circuits, points and signals — so new stations can be added without touching the
engine.

---

## 5. Trains

Each train has: number, name, class, length, max speed, direction, whether it
**stops here or runs through**, scheduled arrival/departure, and accumulated delay.

| Class | Priority | Colour | Notes |
|---|---|---|---|
| Vande Bharat / Rajdhani | 1 (highest) | deep blue | Usually runs through. Never delay these. |
| Shatabdi | 2 | royal blue | |
| Mail / Express | 3 | red-orange | The bread and butter |
| Passenger | 4 | green | Stops everywhere |
| MEMU / EMU | 5 | teal | Short, quick to clear |
| Goods / Freight | 6 (lowest) | grey-brown | Long, slow, hard to fit |
| Light engine | 7 | yellow | Very short |

**Precedence is the actual gameplay.** The classic decision: an Express is running
20 minutes late and a Goods is sitting in the loop. Do you hold the Goods and let
the Express through, or release the Goods and delay the Express further? Holding a
Rajdhani to let a Goods pass should be scored as a serious operating error.

Train physics can stay simple but must include **acceleration and braking
distance** — a train cannot stop instantly at a Red, which is exactly why the
Yellow and Double Yellow aspects exist. If a driver gets a Yellow too late to
brake, that is your SPAD.

---

## 6. Player controls

- **Set a route:** click the origin signal, then click the destination line. The
  game finds the path, throws the points, locks the route, and computes the aspect.
- **Cancel a route:** right-click the origin signal. Applies the cancellation delay
  from §3.7 if a train is approaching.
- **Calling-on:** a separate small button on the signal, only enabled when the
  conditions in §2.5 are met.
- **Block instruments:** "Ask Line Clear" and "Grant Line Clear" buttons for each
  adjacent station.
- **Hold / release** a train standing at a platform.
- **Time controls:** pause, 1×, 2×, 5×. Pause must be genuine — the player should
  be able to stop and think, since real signalling is a thinking job.

Also show: a clock, a train-order list with scheduled vs actual times, and a
scrolling event log (`12:04 RAJDHANI 12951 ENTERED BLOCK`).

---

## 7. Scoring and failure

**Score on, in order of weight:**
1. **Safety** — any unsafe event ends the level. No points can compensate.
2. **Punctuality** — total minutes of delay, weighted by train priority.
3. **Throughput** — trains handled per hour.
4. **Smoothness** — a train brought to a dead stand at a Red it could have avoided
   is a small penalty even if nothing goes wrong. Good signalling keeps trains
   *moving*, not merely un-crashed.

**Instant-fail events:**
- **SPAD** — Signal Passed At Danger.
- **Collision** — two trains in the same track circuit.
- **Derailment** — points moved under a train, or a train sent into a dead-end.
- **Deadlock** — two trains face to face on a single line with no escape. Detect it
  and declare it, rather than letting the player sit confused.

On failure, freeze the screen, mark the location, and explain in plain language
what rule was broken and what the player should have done instead. The game should
teach.

---

## 8. Level progression

Build these in order. Each introduces exactly one new idea.

1. **Tutorial** — one train, one route, one signal. Teach that you set routes, not
   colours.
2. **Reception and dispatch** — receive a train to a platform, then start it away.
   Introduces the Starter and Advanced Starter.
3. **Crossing** — single line, two trains from opposite directions. One must take
   the loop. Introduces the loop and the Yellow-for-diverging rule.
4. **Precedence** — a late Express behind a slow Goods. Introduces priority.
5. **Rush hour** — four trains, three lines, overlapping timings.
6. **Calling-on** — a second train must join an occupied platform.
7. **Degraded working** — a track circuit fails and shows permanently occupied. The
   player must work the section under manual authority with signals unavailable.
   This is where a real SM earns their salary.
8. **Junction** — a third direction, with routing indicators.

---

## 9. Technical requirements

- One self-contained `.html` file. Vanilla JS. No dependencies, no build step, no
  network calls, no external images or fonts.
- **Fixed-timestep simulation** (e.g. 60 Hz logic) decoupled from rendering, so the
  sim is deterministic and speed controls don't change outcomes.
- Separate the code into clear modules within the file: `layout`, `interlocking`,
  `signalling`, `trains`, `scoring`, `render`, `input`. The interlocking must be
  pure logic with no drawing calls in it — you will need to unit-test it.
- Keyboard accessible; readable at 1280×720 and above.
- Include a **debug overlay** (toggle with `~`) showing track circuit IDs, route
  states and point positions. You will need it.

---

## 10. Definition of done

The build is complete when all of these are demonstrably true:

- [ ] A signal shows Green only when the route is set, straight, and at least two
      signals ahead are clear.
- [ ] Receiving a train into a loop yields Yellow plus a route indicator, never
      Green.
- [ ] Double Yellow appears in the correct place in a three-signal sequence.
- [ ] Signals return to Red behind a passing train without player action.
- [ ] Attempting a conflicting route is refused with a readable reason.
- [ ] Points cannot be moved under an occupied track circuit, by any means.
- [ ] A goods train too long for a loop is refused entry to that loop.
- [ ] Cancelling a cleared route with a train approaching enforces the 120 s delay.
- [ ] A train given a late Yellow cannot stop in time and SPADs — proving that
      braking distance is real.
- [ ] The screen contains no scenery. Only track, signals, trains and text.

---

## 11. Do not do these

- Do not let the player click a signal to choose its colour.
- Do not add scenery, isometric or 3D views, or a driver's-eye camera.
- Do not invent aspects. Four only: Red, Yellow, Double Yellow, Green.
- Do not use a framework, a bundler, or any asset the file doesn't contain.
- Do not make the interlocking advisory. It is a physical safety system; it should
  make unsafe things *impossible*, not merely discouraged.
- Do not punish the player for something the game never showed them. If a rule
  matters, surface it in the UI before it can be broken.

---

## 12. Reference material

- [IRFCA — Signalling Systems](https://irfca.org/faq/faq-signal.html)
- [IRFCA — Principal Running Signals](https://irfca.org/faq/faq-signal2.html)
- [IRFCA — Subsidiary Signals and Indicators](https://irfca.org/faq/faq-signal3.html)
- [Railway Signalling Concepts — signal locations](https://www.railwaysignallingconcepts.in/railway-signals-location-home-signal-distant-signal-routing-signal-starter-signal-advanced-starter/)
- [IRISET — Colour Light Signalling (PDF)](https://cse.iitkgp.ac.in/~chitta/CRR/sigDocs/S10-ColorAutoSig.pdf)

---

## 13. Start here

Do not build all of this at once. Build in this order and show me each step:

1. Render the static track diagram from the layout data. Nothing moves.
2. Add track circuits and make one hand-placed train occupy and light them up.
3. Add signals with correct lamp geometry, hard-coded aspects.
4. Add route setting, point throwing and route locking.
5. Add the aspect computation from §2.3. This is the moment it becomes the game.
6. Add train movement with acceleration and braking to signal aspects.
7. Add the timetable, scoring and the level list.

After step 1, stop and show me the diagram before continuing.
