# Magnus Version 6 Delivery Record

Version 6 delivers lecture-based demonstration, large-scene navigation, richer scene inventories, live annotation, distributable output, reliable online/offline roadway resolution, and incident-specific communications. It builds on the released Version 4.5 operational baseline and the completed Version 5 development cycle.

The expandable center workspace shipped in Version 4.5. Roadway rotation followed after its shared transform requirements were isolated and regression-tested.

Version 6.0.0 includes keyboard deletion, a truthful map scale, center-toolbar compass and traffic-flow instruments, toggleable roadway labels, collapsible Scene Type controls, portable scene save/load with PNG, JPG, and SVG output, interactive center-view rotation, centered 500-foot startup framing, the four-part scene catalog, and large-format classroom displays.

## Product goals

- Make the roadway the dominant workspace when reviewing long or highly zoomed scenes.
- Let an instructor orient roadway geometry for the available display shape without changing scene coordinates.
- Organize scene objects by operational ownership and purpose.
- Support persistent and temporary freehand instruction marks.
- Keep roadway context visible while traversing the edge of the initially loaded map area.
- Export the current visual composition for printing, email, and presentation materials.

## 1. Expandable center workspace

**Status: delivered in Version 4.5.0.**

The left configuration pane and right operations pane collapse independently toward their nearest screen edge.

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

**Status: delivered in Version 6.0.0.**

Roadway rotation controls sit beside the zoom controls in the top bar.

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

**Status: delivered in Version 6.0.0.**

The scene catalog uses four operational categories:

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

Additional SSP items:

- Gas cans, 3 per SSP truck
- Floor jack
- Tool bag
- Portable compressor

Floor jacks, tool bags, and portable compressors have a catalog capacity of one per SSP truck; gas cans have a capacity of three per truck.

### External Assets

External Assets include law enforcement, fire and rescue, EMS, towing, incident command, TMA, and their supplied equipment.

### Hazards

Existing involved vehicles, vehicle fire, injured person, animals, aircraft, and other direct incident hazards remain in this category.

### Incidentals

Incidentals include:

- Removed wheel or separated tire shown flat on the roadway
- Crash debris area represented by a resizable, rotatable hatched rectangle
- Motorist or passenger shown as a top-down standing person

The SSP tool bag belongs to SSP Assets.

### Catalog acceptance

- The four tabs appear in both the map toolkit and scene template designer.
- Existing saved scenarios continue to resolve every Version 4 definition ID.
- Per-source capacities update immediately when supporting vehicles are added or removed.
- Resizable incidentals expose dimensions in the selected-item inspector.

## 4. Drawing and temporary annotation

**Status: delivered in Version 6.0.0.**

The Drawing menu in the center top bar toggles independently; selecting a drawing option does not close it.

Implemented strokes are SVG polylines sampled in map-world coordinates at approximately 10-foot intervals, with a final shorter segment retained at pointer-up. This keeps scene files compact while preserving smooth printed SVG output. Stroke widths are stored in feet, and the complete drawing layer can be hidden from Map Layers.

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

## 5. SVG and PNG output

**Status: delivered in Version 6.0.0.**

The Save Scene workflow exports SVG, PNG, JPG, and a portable Magnus scene document.

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
- Export works with either pane state, every 45-degree rotation, and repositioned scenes across the loaded map.
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

### Milestone 4: Output and release hardening

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