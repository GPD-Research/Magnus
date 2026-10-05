# SSP ↔ TOC radio phraseology (reference for the communications module)

Source: instructor spreadsheets "SSP Phraseology" and "NRO Routes and TOC Control" (October 2026).
This document sorts that material into the rules the communications panel should implement. The
current generator (`src/domain/communications.ts`, `buildInitialRadioExchange`) produces a
three-line "marking out" exchange; the gaps against this reference are listed at the end.

## 1. Who talks to whom

A patroller (unit `SSP <number>`, e.g. `SSP970`) talks to the TOC controller for the corridor being
patrolled. The controller is chosen by **route and exit range**, not just by route number.

| Patrol route | From (top)      | To (bottom)      | Controller        |
|--------------|-----------------|------------------|-------------------|
| 66-1         | DC / Exit 73    | Exit 62          | 66 Control        |
| 66-2         | Exit 62         | Exit 52          | 66 Control        |
| 66-3         | Exit 52         | Exit 40          | 66 Control        |
| 495-1        | MD / Exit 177   | Exit 54          | 495 Control       |
| 495-2        | MD / Exit 44    | Exit 54          | 495 Control       |
| 395-1        | DC / Exit 10    | Edsall / Exit 2  | 395 Control       |
| 95-1         | Edsall / Exit 2 | Exit 160/158     | 95 Control        |
| 95-2         | Exit 160/158    | Exit 148         | 95 Control        |
| 95-3         | Exit 148        | Exit 133/130     | Stafford Control  |
| 95-4         | Exit 133/130    | Exit 118         | Stafford Control  |

Rules:
- I-95 at or north of exit 148 → `95 Control`; south of exit 148 → `Stafford Control`.
- I-66, I-495 and I-395 each have a single controller regardless of exit.
- A location given by mile marker maps to the same table (exit numbers on Virginia interstates are
  mile-based, so compare the mile marker against the exit numbers directly).
- Outside the table (unknown route or exit) fall back to `<route> Control`.

Proposed data shape (to live in `src/domain/communications.ts` or a sibling `tocSectors.ts`):

```ts
interface TocSector { route: string; patrolRoute: string; fromExit: number; toExit: number; controller: string }
function controllerFor(highway: string, referenceType: RoadReferenceType, reference: string): string
```

## 2. Exchange structure

Every exchange is a hail, an acknowledgement, then the message. Note the TOC acknowledgement is
the unit number as a question, not "go ahead".

```
SSP:  SSP970 to 95 Control?
TOC:  SSP970?
SSP:  <message>
```

## 3. Message templates

Each message is assembled left to right from the spreadsheet columns:

`<who> | <to whom> | <verb phrase> | <what> | <highway> | <direction> | <where> | <which side or lane> | <who is there>`

### 3a. Marking out on a scene the patroller found

- Verb phrase: `Show me out`
- What (one of):
  - `with an accident involving <n> vehicles`
  - `with a disabled <tag/make/model>`
  - `with a <description> <tag/make/model>`
  - `with debris` (+ type)
- Highway: spoken as the number only (`95`, `66`, `495`, `395`).
- Direction: `northbound/southbound` (95, 395), `eastbound/westbound` (66), any of NB/SB/EB/WB (495).
- Where: `at mile marker <n>` or `at exit <n>`; add `in the main lanes` when the scene is on the
  mainline (as opposed to a ramp or access lane).
- Which side or lane: `on the left shoulder`, `on the right shoulder`, `blocking the right lane`,
  `blocking the two right lanes`, `in the grass`, `in the tree line`.
- Who is there (see §4): `I'll advise` when nobody else is on scene, otherwise list them.

Example (unit 970, I-95 NB exit 155 — north of 148, so 95 Control):

```
SSP970 to 95 Control?
SSP970?
Show me out at northbound exit 155 in the main lanes with a blocking accident in the right lane. I'll advise.
```

With responders already drawn on the scene:

```
Show me out at northbound exit 155 in the main lanes with a blocking accident in the right lane. Fire and rescue plus VSP already on scene.
```

### 3b. Arriving at a scene TOC sent the patroller to

Same as 3a but the verb phrase is `Show me on scene` and the "what" is omitted (TOC already knows).

```
Show me on scene at northbound exit 155, blocking the right lane. VSP on scene.
```

### 3c. Discovering a hazard (reporting, not working it)

- Verb phrase: `There is`
- What: `a car`, `debris blocking`, `a pedestrian`, `an accident that just occurred`
- Then highway / direction / where / lane / who is there as above.

### 3d. Shift and route status (no scene)

| Event                    | Message                                                         |
|--------------------------|-----------------------------------------------------------------|
| Leaving the yard         | `SSP970 to <n> Control, on duty in truck <#>, starting mileage <#>, I'll be on <patrol route>` |
| Arriving at patrol area  | `SSP970 to <n> Control, on route`                               |
| Leaving the patrol area  | `SSP970 to <n> Control, off route`                              |
| Returning to the yard    | `SSP970 to <n> Control, off duty, ending mileage <#>`           |

Patrol route names are the first column of the sector table (`66-1`, `495-2`, …).

## 4. "Who is there" derived from the scene

The trailing clause should be generated from external assets present in the scene
(`category: 'external-asset'` in `src/domain/equipmentCatalog.ts`):

| Scene asset ids                                   | Spoken as         |
|---------------------------------------------------|-------------------|
| `vsp-cruiser`, `vsp-officer`                      | `VSP`             |
| `ems-ambulance`                                   | `EMS`             |
| `ladder-truck`, `pump-truck`, `fire-chief`, `hurst` | `Fire and rescue` |
| `tow-truck`, `heavy-tow-truck`                    | `tow`             |

Composition: none → `I'll advise.`; one → `<X> on scene.`; several → `<A>, <B> plus <C> already on
scene.` (spreadsheet forms: `VSP on scene`, `EMS VSP on scene`, `Fire, EMS VSP on scene`,
`tow on scene`). Recompute whenever assets are added or removed so the transcript tracks the drawing.

## 5. Vocabulary

- Phonetic alphabet: Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike
  November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whisky X-Ray Yankee Zulu — used for
  tags/plates.
- `on route` = arrived in patrol area; `en route` = on my way; `direct` = heard/confirmed;
  `attenuator` = impact-absorbing end of a guard rail.

## 6. Gaps in the current implementation

`buildInitialRadioExchange` already covers: unit hail, highway spoken as a number, exit/mile-marker
location, incident description from the scenario's blocked lanes, and per-incident TOC detail
questions. Still to do:

1. Controller selection by sector table (§1) — currently always `<route> control`.
2. TOC acknowledgement should be `SSP970?` (§2), not `SSP970, go ahead`.
3. Hail punctuation: `SSP970 to 95 Control?`.
4. `in the main lanes` / ramp wording from the scene's roadway context (§3a).
5. "Who is there" from external assets on the scene instead of the fixed `I'll advise` (§4).
6. Exchange types beyond marking out: on scene (3b), hazard report (3c), shift/route status (3d).
7. Unit number input in the Communications panel, replacing the hard-coded `SSP970` in `App.tsx`
   (`addRadioEvent`). Free text, persisted with app settings; any call sign works (`SSP970`,
   `SSP914`, `IMC601`) and is used verbatim in the hail and the TOC acknowledgement.
8. The panel only fills after **Build initial radio call** is pressed; consider regenerating live.
9. Classroom display (`displayCommunications`): open as a portrait/vertical window and render the
   exchange like a text-message thread — SSP messages as bubbles on one side, TOC on the other,
   timestamps between groups — rather than the current log list.
