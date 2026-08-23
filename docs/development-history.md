# Magnus Development History

Magnus has never kept a dedicated changelog. Each release instead overwrote the
README's feature list in place, and only Version 6 produced a standalone
delivery record ([docs/version-6-delivery.md](version-6-delivery.md), itself a
rename of an earlier `docs/version-5-roadmap.md`). This document reconstructs
the project's development timeline from git history — commit dates, commit
messages, and the README/`package.json` state at each release point — so the
progression from concept to Version 7 is recorded in one place.

All dates are commit dates in this repository's history.

## Pre-release foundation (2026-08-20 – 2026-08-21)

| Date | Commit | What landed |
| --- | --- | --- |
| 2026-08-20 | `5108097` Initial commit | Empty repository scaffold. |
| 2026-08-20 | `f8fa265` Rough Idea Specifications | `gemini-code-vdot software.md`, the original concept document for a VDOT Safety Service Patrol scene-training tool. |
| 2026-08-20 | `3564290` Build spatial scene designer and training workflow | First working application: the Rust `spatial-core` crate (compiler, index, scene), the React scene builder, ESLint config, and initial e2e spec. Package version starts at `0.0.0`. |
| 2026-08-20 | `b76e741` Add live roadway location rendering | Introduces `spatial_server`, `location.rs`, and `overpass.rs` — live OpenStreetMap-backed roadway geometry replacing static fixtures. |
| 2026-08-20 | `7bb0504` Stabilize scene camera zoom behavior | Zoom/camera fixes ahead of the first tagged release. |
| 2026-08-21 | `cf89299` Stabilize scene interactions and local development | Interaction and dev-workflow hardening immediately before Version 3.0.0. |

## Version 3.0.0 — first tagged release (2026-08-21)

Commit `0bc0d96` ("Release Magnus 3.0.0") set `package.json` to `3.0.0` and
established the feature baseline documented in every later release: the
responsive three-pane builder, shoulder/right-lane closure templates, Standard
SOP / Enhanced Safety / SOP Violation training modes, draggable cones/trucks/
personnel/hazards, signboard controls, equipment catalogs, local scenario
persistence, live SOP audit, and the single-process Rust+web launch.

## Version 4 (2026-08-21 – 2026-08-22)

| Date | Commit | What landed |
| --- | --- | --- |
| 2026-08-21 | `e443208` Improve interchange rendering and scene placement | |
| 2026-08-21 | `d37ebd6` Improve roadway scene reliability and controls | |
| 2026-08-21 | `55cd3d5` Release Magnus 4.0.0-rc.1 | Adds connectivity modes (Online/LAN/Offline), cache-only local resolution, persistent roadway scene cache, NoVA/statewide OSM package preparation, custom themes, and improved interchange/ramp/bridge/lane-marking rendering. |
| 2026-08-21 | `752b04f` Fix left lane closure scene geometry | |
| 2026-08-21 | `3134431` Expand scene assets and placement controls | |
| 2026-08-22 | `331d6bc` Release Magnus version 4 | Promotes the `4.0.0-rc.1` feature set to the stable `4.0.0` release. |

## Version 4.5 (2026-08-22)

| Date | Commit | What landed |
| --- | --- | --- |
| 2026-08-22 | `2621a16` Fix Version 4 offline preparation | |
| 2026-08-22 | `69cfd1d` Outline Version 5 roadmap | Adds `docs/version-5-roadmap.md` (later renamed into the Version 6 delivery record). |
| 2026-08-22 | `bb96b7d` Release Magnus version 4.5 | Adds independently collapsible configuration/operations panes, persistent presentation layout with 44 px restore grips, keyboard focus transfer, an expanded roadway workspace, and versioned settings migration. |

## Version 5 release candidate (2026-08-22)

| Date | Commit | What landed |
| --- | --- | --- |
| 2026-08-22 | `8f1c6c4` Add Linux application launcher | `scripts/install-linux-app.sh` and desktop-entry support. |
| 2026-08-22 | `aac8fea` Add Magnus arrow-M branding | The orange arrow-M identity shared by the header, favicon, and Linux launcher; package-derived short version label (`v5`, `v6`, ...). |
| 2026-08-22 | `a7e2195` Refine collapsible pane behavior | |
| 2026-08-22 | `ce069c5` Prepare Magnus 5.0.0 release candidate | Sets `package.json` to `5.0.0-rc.1`. Adds keyboard deletion for scene objects, an accurate 40 ft map scale, compass/traffic-flow instruments, whole-scene 45-degree rotation, toggleable OSM labels, collapsible Scene Type controls, SAVE SCENE/LOAD SCENE with PNG/JPG/SVG + `.magnus.json` export, freehand SVG annotations, and dirty-scene exit confirmation. |
| 2026-08-22 | `aa23d89` Complete Version 5 annotation and map fixes | Finishes the annotation and map work started in the `5.0.0-rc.1` candidate; the package version stayed on the release-candidate label until Version 6 shipped. |

## Version 6.0.0 (2026-08-22 – 2026-08-23)

| Date | Commit | What landed |
| --- | --- | --- |
| 2026-08-22 | `a8b285f` Fix Ubuntu application icon lookup | |
| 2026-08-22 | `023d89f` Add presentation scaling and vehicle animations | |
| 2026-08-23 | `b233f45` Improve map resolution and incident reporting | |
| 2026-08-23 | `ae82ae5` Release Magnus version 6 | Sets `package.json` to `6.0.0` and adds [docs/version-6-delivery.md](version-6-delivery.md) as the first standalone delivery record, documenting the expandable center workspace (delivered in 4.5.0) and interactive roadway rotation (delivered in 6.0.0) against explicit product goals and acceptance criteria. |

## Version 7.0.0 (2026-08-23)

| Date | Commit | What landed |
| --- | --- | --- |
| 2026-08-23 | `6326221` Adapt scene setups to curved roadways | |
| 2026-08-23 | `f9583dd` Preserve non-SSP assets across scene resets | |
| 2026-08-23 | `7e45064` Bump to v7: saved scenes, SOP rework, richer Overpass viewport data | Sets `package.json` to `7.0.0`. Adds the named saved-scene library (SAVE SCENE file naming, SAVED SCENES load/download/delete menu), in-place scenario conversion, a tolerance-based SOP audit engine with a persisted compliance mode, the required-downstream-cone check, the Enhanced Safety → Extended Safety rename, distinct reset controls, and ramp-gore-aware lane markings in `overpass.rs`. |
| 2026-08-23 | `d7e1f02` Document Version 7.0 updates in README | Records the Version 7.0 feature set in the README (see the "Version 7.0 release" section there for the current, user-facing description). |

## Sources

This history was reconstructed from `git log`, `package.json` version bumps,
and the README/`docs/version-6-delivery.md` content recorded at each release
commit. It does not include information beyond what those sources evidence —
commits without a listed feature summary above were verification, bugfix, or
stabilization work between releases rather than user-facing milestones.
