# Magnus Version 5 Roadmap

Version 5 is focused on lecture-based demonstration, large-scene navigation, richer scene inventories, live annotation, and distributable output. Version 4.5 remains the operational baseline while these capabilities are developed and validated.

The expandable center workspace shipped in Version 4.5. Roadway rotation is deferred until after the 4.5 release and branding work so its shared transform requirements can be evaluated as a separate high-risk change.

## Product goals

- Make the roadway the dominant workspace when reviewing long or highly zoomed scenes.
- Let an instructor orient roadway geometry for the available display shape without changing scene coordinates.
- Organize scene objects by operational ownership and purpose.
- Support persistent and temporary freehand instruction marks.
- Keep roadway context visible while traversing the edge of the initially loaded map area.
- Export the current visual composition for printing, email, and presentation materials.

## 1. Expandable center workspace

**Status: delivered in Version 4.5.0.**

The left configuration pane and right operations pane will collapse independently toward their nearest screen edge.

### Interaction

- Each pane receives a clearly labeled collapse control.
- A collapsed pane leaves a large edge-mounted grip that is easy to click or tap.
- Activating the grip restores the pane without changing scene zoom, pan, rotation, or selection.
- Both panes may be collapsed simultaneously.
- Collapse state should persist locally so presentation layouts survive a reload.
- Keyboard focus must move to the restore grip when a pane is collapsed from the keyboard.

### Layout acceptance

- With both panes visible, the existing three-pane workflow remains available.
- With one pane collapsed, all released width is assigned to the center pane.
- With both panes collapsed, the center pane spans the application width except for the two restore grips.
- No map, equipment, drawing, or toolbar element is clipped or repositioned in scene coordinates when the layout changes.
- Desktop and tablet layouts provide at least a 44 px tap target for each grip.

## 2. Roadway rotation

**Status: deferred.** Resume only after a dedicated transform design and regression plan is approved.

Add roadway rotation controls beside the existing zoom controls in the top bar.

### Behavior

- Rotate counterclockwise and clockwise in 45-degree increments.
- Support eight orientations from 0 through 315 degrees.
- Provide a one-action reset to 0 degrees.
- Rotate the complete map world, scene, equipment, drawings, and selection affordances as one visual composition.
- Keep labels and top-bar controls upright unless they are part of the scene itself.
- Preserve the viewed center point while rotating.
- Persist rotation in saved scenarios.

### Engineering constraints

- Pointer placement, dragging, freehand drawing, and section selection must use the inverse map transform.
- Pan and zoom must continue to center on the intended world point after rotation.
- Export must use the same rotation transform as the interactive canvas.
- Rotation must not alter stored roadway or scene coordinates.

## 3. Four-part scene catalog

Replace the current `asset | hazard` toolkit category with:

1. SSP Assets
2. External Assets
3. Hazards
4. Incidentals

Catalog definitions remain data-driven. Count classes and capacity rules remain independent from display category.

### SSP Assets

Existing SSP items:

- SSP truck
- Full-size cones, 20 per SSP truck
- Road flares
- Emergency Scene Ahead collapsible diamond signs, 2 per SSP truck
- SSP patroller

New SSP items:

- Gas cans, 3 per SSP truck
- Floor jack
- Tool bag
- Portable compressor

Unless an SOP capacity is supplied before implementation, floor jacks, tool bags, and portable compressors should begin with a provisional capacity of one per SSP truck and be easy to revise in catalog data.

### External Assets

All existing non-SSP entries currently categorized as assets move here, including law enforcement, fire and rescue, EMS, towing, incident command, TMA, and their supplied equipment.

### Hazards

Existing involved vehicles, vehicle fire, injured person, animals, aircraft, and other direct incident hazards remain in this category.

### Incidentals

Initial incidental objects:

- Removed wheel or separated tire shown flat on the roadway
- Crash debris area represented by a resizable, rotatable hatched rectangle
- Motorist or passenger shown as a top-down standing person

The SSP tool bag belongs to SSP Assets. A separate unowned loose bag should only be added to Incidentals if operational review identifies a distinct need.

### Catalog acceptance

- The four tabs appear in both the map toolkit and scene template designer.
- Existing saved scenarios continue to resolve every Version 4 definition ID.
- Per-source capacities update immediately when supporting vehicles are added or removed.
- Resizable incidentals expose dimensions in the selected-item inspector.

## 4. Drawing and temporary annotation

Add a Drawing menu to the center top bar. Tapping the menu toggles it open or closed; selecting a drawing option does not close it.

### Controls

- Pen mode using click-and-hold or touch-and-drag freehand input
- Primary color palette
- Selectable line thickness
- Undo button that removes one completed stroke per activation
- Persistent drawing mode
- Temporary drawing mode selected by a dedicated radio control
- Temporary lifetime dropdown with 5, 10, 15, and 30 seconds

### Stroke model

Each pointer-down through pointer-up interaction creates one stroke containing:

- Stable stroke ID
- Ordered world-coordinate points
- Color
- Width in screen-oriented display units or a clearly documented scene-unit equivalent
- Creation time
- Persistence mode
- Temporary lifetime when applicable

### Behavior and acceptance

- Drawing begins only when a drawing mode is active and does not drag underlying equipment.
- One undo activation removes exactly one completed stroke; an in-progress stroke is canceled separately.
- Temporary strokes self-delete after their selected lifetime, measured from pointer-up.
- Undo can remove a temporary stroke before its timer expires without leaving a pending state update.
- Persistent strokes are included in saved scenarios and exports.
- Temporary strokes are excluded from saved scenarios and exports by default.
- Strokes remain aligned while the map is panned, zoomed, rotated, or expanded by pane collapse.
- Touch input uses pointer capture and does not trigger browser scrolling while drawing.

## 5. Adjacent roadway loading

Version 5 will load a 3 by 3 neighborhood centered on the requested roadway area: the selected map section plus its eight adjacent sections.

### Spatial contract

- Define deterministic section IDs from a common projected coordinate grid.
- Return section bounds, world origin, coordinate reference system, and revision metadata with every section.
- Normalize all nine sections into one shared world-coordinate space.
- Deduplicate road features crossing section boundaries by stable source and geometry identifiers.
- Cache sections independently so subsequent pans request only missing neighbors.

### Runtime behavior

- Initial resolution requests the center section and its eight neighbors.
- Panning into an outer section shifts the active neighborhood and fetches newly adjacent sections.
- Previously loaded sections remain in a bounded least-recently-used memory cache.
- Offline mode renders every locally available section and reports missing neighbors without attempting public network access.
- A scene and its assets can cross section boundaries without being split or re-anchored.

### Acceptance

- No blank map band appears while panning across a loaded section boundary.
- Matching roadway geometry joins without visible gaps, duplicate lane markings, or coordinate jumps.
- Network and disk requests are deduplicated when multiple viewport updates require the same section.
- Failure of one adjacent section does not discard the center section or other successful neighbors.
- Automated tests cover all eight movement directions and a scene spanning at least two sections.

## 6. SVG and PNG output

Add an Output menu to the center top bar with SVG and PNG actions.

### Export bounds

- Export the currently visible center-pane roadway area.
- When side panes are visible, use the reduced center-pane viewport.
- When either or both panes are collapsed, use the expanded center-pane viewport at export time.
- Exclude application chrome, restore grips, menus, selection outlines, and transient interaction handles.
- Include roadway layers, scene equipment, persistent drawings, and the current roadway rotation.

### Formats

- SVG preserves vector roadway, glyph, and drawing geometry.
- PNG rasterizes the same composition at a print-appropriate scale with explicit pixel dimensions.
- Both formats include a predictable filename containing the scenario and export timestamp.
- Attribution required by map data sources remains present in the exported composition.

### Acceptance

- SVG and PNG show the same world bounds and orientation.
- Export works with either pane state, every 45-degree rotation, and long scenes crossing section boundaries.
- PNG output is crisp at its declared size and does not depend on a screenshot of the full browser window.
- Exporting does not mutate the active scene or dismiss the current layout.

## Delivery sequence

### Milestone 1: Viewport foundation

- Collapsible side panes and restore grips (delivered in Version 4.5.0)
- Persisted pane state (delivered in Version 4.5.0)
- Rotation state and 45-degree controls
- Shared forward and inverse world transforms
- Regression coverage for placement, dragging, pan, and zoom under rotation

### Milestone 2: Catalog taxonomy

- Four toolkit categories
- Existing catalog migration without ID changes
- New SSP assets and capacity rules
- Initial incidental glyphs and resizable debris area
- Saved-scenario compatibility tests

### Milestone 3: Annotation

- Drawing menu and pen controls
- Persistent stroke model
- Stroke-level undo
- Temporary strokes and expiration lifecycle
- Rotation, zoom, touch, save, and restore coverage

### Milestone 4: Spatial neighborhood

- Grid-section contract and stable IDs
- 3 by 3 server resolution
- Shared-coordinate composition and feature deduplication
- Incremental neighbor loading and bounded cache
- Online, LAN, and Offline behavior tests

### Milestone 5: Output and release hardening

- SVG composition export
- PNG raster output
- Viewport-bound export under all pane and rotation states
- Accessibility and touch-target audit
- Desktop, tablet, and installed-build smoke testing

## Cross-cutting release criteria

- Version 4 saved scenarios load without data loss.
- New state fields use explicit document-version migration rather than optional behavior scattered through components.
- Scene geometry remains measured in feet and independent from screen layout.
- Every map-to-screen feature shares one tested transform pipeline.
- Controls are usable by mouse, touch, and keyboard.
- Production and offline builds do not require write access to the application installation directory.