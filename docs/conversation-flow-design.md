# Conversation Flow tool — design (proposed for the next major version)

Companion to `communications-phraseology.md` (what is said) and the scene-driven generator in
`src/domain/communications.ts` (when it is said). This document designs the **Conversation Flow**
window: a full-screen tool that shows the SSP ↔ TOC exchange as a snaking timeline of nodes next to the
text-message transcript, prefilled by the existing heuristics and editable by the instructor, and saved
inside the scene JSON.

## 1. Goals

1. Teach the *order and ownership* of radio traffic, not just the words: who opens, who acknowledges,
   what triggers each update.
2. Let the heuristic produce a skeleton conversation from the scene (origin, hazards, agencies,
   location) and let the instructor correct, reorder, add and remove calls before a lesson.
3. Keep every edit with the scene: reopening the saved scene restores the same conversation.
4. Stay honest about timing: information becomes available at a point in time (TOC sees a crash on
   camera at dispatch, or the SSP learns it after arrival) and the timeline must show where.

Non-goals (this version): audio playback, scoring of trainee answers, multi-unit conversations.

## 2. Window and layout

- Opens from the Communications section ("Open conversation flow") in its own window via the same
  mechanism as the Roadway Template Editor (`openTemplateEditorWindow` pattern, `?view=conversation`),
  so the scene builder stays untouched behind it. Falls back to a full-screen overlay if the popup is
  blocked.
- Two panes, resizable split (default 62 / 38):
  - **Left — timeline canvas (SVG).** A serpentine path: horizontal rows that alternate direction
    (left→right, then right→left) joined by semicircular bends, with an arrowhead at the end of the
    last row showing the flow of time. The path is sized to fill the pane (rows chosen from pane
    height, no scrolling at default zoom); it does not grow with the conversation.
  - **Even spacing.** Nodes are placed at equal *arc-length* intervals along the whole path: one node
    sits at the start, one at the arrowhead, and the rest are spread between them (`t = i / (N - 1)`
    along the path; a single node sits at the start). Adding or removing a node re-spaces all nodes
    with an animated slide, so the spacing simply gets more compact as the conversation grows. The
    path exposes `pointAtLength` so bends count as real distance; labels flip side on right→left rows
    to stay readable.
  - **Right — transcript.** The existing text-message bubbles (SSP right-aligned, TOC left-aligned),
    one bubble per node, in timeline order.
- Toolbar (top of left pane): origin selector (SSP discovered / TOC dispatched), unit, vehicle finding
  + who identifies it, "Regenerate from scene", "Add call", zoom ± , "Save with scene".
- Dark/light/custom themes reuse the existing CSS variables; path stroke `--line`, nodes filled per
  speaker (SSP accent `--green`, TOC `--yellow`), selected node ringed.

## 3. Node model

```ts
export interface ConversationNode {
  id: string
  order: number                       // position along the path, 0-based; renumbered on reorder
  speaker: 'SSP' | 'TOC'
  text: string                        // the spoken line, exactly as rendered in the bubble
  kind: 'hail' | 'ack' | 'report' | 'dispatch' | 'en-route' | 'update' | 'finding' | 'clear' | 'custom'
                                      // 'ack' = one-word calls: "Copy.", "10-4.", "Disregard." — always their own node
  trigger: ConversationTrigger        // why this line exists (drives prefill and the node tooltip)
  edited: boolean                     // instructor changed text/speaker; regenerate keeps it
  pinned: boolean                     // instructor added it; regenerate never removes it
  note?: string                       // teaching note shown under the node when selected
}

export type ConversationTrigger =
  | { type: 'origin' }                                   // first exchange (SSP hail or TOC dispatch)
  | { type: 'arrival' }                                  // SSP truck placed with a qualifying hazard
  | { type: 'agency'; group: AgencyGroup; event: 'arrived' | 'departed' }
  | { type: 'finding'; nature: 'accident' | 'disabled'; source: 'toc-dispatch' | 'ssp-update' }
  | { type: 'clear' }                                    // last SSP truck removed
  | { type: 'manual' }                                   // instructor-authored

export interface Conversation {
  version: 1
  nodes: ConversationNode[]
  selectedNodeId?: string
}
```

Timeline position is purely `order`; no timestamps are stored (the live transcript already stamps
`radioEvents` with wall-clock times for the ad-hoc mode).

## 4. Prefill heuristic

`buildConversation(scene: CommunicationsScene, existing?: Conversation): Conversation` is a pure
function that replays the current `advanceCommunications` reducer over a canonical sequence of scene
states and converts each emitted `RadioMessage` into a node with the matching trigger:

1. **origin** — SSP-discovered: `SSP970 to 95 Control?` / `SSP970, go ahead.` TOC-dispatched:
   `95 Control to SSP970?` / `SSP970.` / `Please respond to … at …` / `Show me en route.`
2. **arrival report** — `Show me out at … with … blocking …` or `… on the right shoulder with …`,
   agencies-on-scene suffix, `Send VSP.` when a lane is blocked, then TOC `Copy.` / `Copy. VSP en route.`
3. **finding** — when `natureSource = 'ssp-update'` and a nature is set: `vehicle is disabled.` /
   `vehicles were in a crash.` + `Copy.` (TOC-known findings are folded into the dispatch line instead).
4. **agency updates** — one arrived node per agency group present in the scene, in `AGENCY_ORDER`,
   each followed by `Copy.`; departed nodes are *not* prefilled (the instructor adds them where the
   lesson needs them, or they appear live when assets are deleted).
5. **clear** — `show me clear.` + `Copy.`

Merge rules when regenerating over an `existing` conversation:
- Nodes with the same `trigger` keep their `id`, and keep `text`/`speaker` if `edited`.
- `pinned` nodes are preserved at their relative position (after the node they followed).
- Heuristic nodes whose trigger no longer applies are removed unless `edited` or `pinned`.

Live mode: while the window is open, scene changes still run `advanceCommunications`; emitted
messages are appended as new nodes at the end (not re-sorted), so a trainee can watch the flow grow
as assets are added.

## 5. Editing

- **Select** a node (click on canvas or bubble): highlights both, draws a connector line from the
  node to its bubble, and scrolls the transcript so the bubble is in view (`scrollIntoView` with
  `block: 'center'`). Keyboard ←/→ moves selection along the path.
- **Edit text** inline in the bubble (textarea, Enter to commit, Esc to cancel); sets `edited`.
- **Speaker toggle** on the node (SSP ⇄ TOC).
- **Add call** inserts a `custom` pinned node after the selection (or at the end), speaker alternating
  from the previous node, empty text focused for typing.
- **Quick acknowledgements**: a one-click menu ("Copy.", "10-4.", "Disregard.", "Go ahead.", "Stand by.")
  inserts an `ack` node for the *other* speaker after the selection — single words are how most of
  the traffic actually goes, so they must be as cheap to add as they are to say.
- **Remove** deletes the selected node (Delete key or ✕ on the bubble); heuristic nodes removed this
  way are remembered as suppressed (`trigger` added to a `suppressed` list) so regenerate does not
  bring them back until "Reset conversation".
- **Reorder** by dragging a node along the path (drop between neighbours) or ⌥←/⌥→.
- **Teaching note** per node (small text field under the transcript bubble when selected).
- Undo/redo (in-window stack, 50 steps).

## 6. Persistence

Saved **inside the scene JSON** as `conversation: Conversation` next to `radioEvents` and
`communicationsState` (`scenarioFile.ts` gains a normalizer that defaults it to `{ version: 1, nodes: [] }`
for older files; `scenarioFile.test.ts` fixture updated). Saved scenes in localStorage and exported
`.json` files carry it automatically. Export/import of just the conversation block (to reuse a
conversation across scenes) is a possible later addition and is not needed for v1.

## 7. Implementation plan (one build session)

1. `src/domain/conversation.ts` — types above, `buildConversation`, merge/suppress rules, reorder
   helpers; unit tests covering both origins, TOC-known vs SSP-found findings, regenerate-keeps-edits.
2. `src/domain/scenarioFile.ts` — `conversation` field + normalizer + fixture.
3. `src/components/ConversationFlow.tsx` + `.css` — window shell, serpentine path geometry
   (`serpentinePath(width, height, rows)` → path `d` + total length; `nodePositions(path, count)` →
   evenly spaced centres via `getPointAtLength`), node layer, transcript pane,
   connector, inline editing, keyboard handling.
4. `src/domain/conversationWindow.ts` — open/close helpers mirroring `templateEditorWindow.ts`;
   `main.tsx` route for `?view=conversation`; state shared with the main window through the existing
   saved-scene channel (BroadcastChannel `magnus-scene`), so edits in the flow window land in the
   scene builder's state and vice-versa.
5. Communications section: "Open conversation flow" button; the in-panel transcript becomes read-only
   mirror of the conversation nodes.
6. Version bump to 11.0.0-rc.1, `.deb` release.

Decisions from the instructor:
- Every acknowledgement (`Copy.`, `10-4.`, `Disregard.`) is its **own node**; nothing is folded into
  a neighbouring node.

Open question:
- Should departures of agencies be prefilled at the end of the skeleton (before `show me clear`) so a
  complete lesson exists without edits? Design above assumes **not prefilled**.
