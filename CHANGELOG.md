# Changelog

All notable changes to PES KitLab. Newest first. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.4.8] - 2026-11-17
### Changed
- Collars are now drawn symmetrically around the fold line (the collar is a folded strip), on both the outside and the inside face.
- New "Sides" option: outside and inside / outside only / inside only.
- Default collar measurements fit the visible ±40 px; rims are centred on the fold like in PES Master.
- Saved kits using the old `edge` rim position are converted to `fold`.

## [0.4.7] - 2026-11-16
### Fixed
- Collar orientation: the design is painted on the visible part below the fold; the collar line colour paints the collar again.
- Default stripe and rim sizes adjusted to the larger band.

## [0.4.6] - 2026-11-16
### Added
- Collar designs have options: rim (where, width, distance), stripes (count, width, gap, distance, colour 2 or alternate 2/3), two/three bands, front/back, V (depth, opening, rim) and placket.
### Changed
- Shorter collar menu: variants such as outer rim, inner rim, double rim, 3/4 stripes and the three front widths became options.

## [0.4.5] - 2026-11-16
### Fixed
- One-colour patterns and graphics on the sleeves now also show on the shoulders when "Sleeves with shoulders" is on.

## [0.4.4] - 2026-11-16
### Added
- Sponsor rotation, left/right and up/down ±600; several shorts sponsors with placement: centre (front/back), left leg, right leg, both legs.
- Mirror toggle for the shorts side stripes.
### Fixed
- The shoulder area belongs to the sleeves for every layer (cache fixed).
- Shorts side stripes no longer mirror offset/rotation on the right leg.
- Shorts number side matches Sider (0 = left, 1 = right); old kits are migrated (KitDesign v6).
- Exported name/number settings now match the editor defaults; shorts numbers reuse the back numbers.
- Name comes before Number in the Numbers tab.

## [0.4.3] - 2026-11-15
### Added
- "Sleeves" can be used as a mask.
### Changed
- Layers that cover only the sleeves follow the "Sleeves with shoulders" setting; the raglan is drawn under the layers by default.
- The default "Classic plain" template has no stripe over the sleeves.

## [0.4.2] - 2026-11-15
### Added
- Groups have their own placement: offset, size, rotation, blend mode and shine applied to every member.
- "Group colours": swap one colour across the whole group.

## [0.4.1] - 2026-11-15
### Added
- Shape outlines with their own colour and thickness; cuff stripe width, gap and distance.
- Layer panel reorganised into logical groups; − / + buttons repeat when held.
### Changed
- Pattern tiles are built at their final size (sharper); the shoulder zone reaches the middle of the neck.
### Fixed
- The layer list no longer jumps when dragging old items.

## [0.4.0] - 2026-11-15
### Added
- Layers on the sleeves cover the shoulders; colours with transparency; rebalanced 3D lights.
- Several sponsors on the shorts; "add to the other kits" on every sponsor/badge; right-click menu on logos; "copy to all kits" only adds what is missing.
- Captain's armband "apply to all kits".
- Auto-save (off / 2 / 5 / 10 / 15 min) and a history panel for undo (up to 300 steps).
- Warning for teams whose pack has no licensed kits (FL26 Mod Studio "editable kits"): Sider's kit-server disables their kits.
### Fixed
- Dragging next to the fixed Sleeves/base rows; collars paint both colours; recolouring shorts numbers.

## [0.3.9] - 2026-11-15
### Fixed
- Eyedropper reads the screen pixel through Rust (the browser EyeDropper does not work in WebView2), including over the 3D view.

## [0.3.8] - 2026-11-15
### Added
- PNG texture templates (full 2048² kits) in the library and in the editor, used as the kit base.

## [0.3.7] - 2026-11-15
### Added
- Saved shirt templates in the Library: preview, edit, rename, delete.
### Changed
- Dragging the shorts/socks base up only moves its design in front.

## [0.3.6] - 2026-11-15
### Fixed
- Shoulder panel with three stripes runs continuously to the cuff (short and long sleeves); long horizontal stripes.

## [0.3.5] - 2026-11-14
### Fixed
- Each sleeve has one continuous design around the arm; rotation and mirroring on sleeves.

## [0.3.4] - 2026-11-14
### Added
- Shorts/socks base can be dragged between layers.
### Fixed
- Rotation on sleeves is mirrored between arms; patterns on shorts/socks keep their proportions; thinner sock-cuff stripes.

## [0.3.3] - 2026-11-14
### Added
- Layers on the sleeves continue the shirt; copy/paste/duplicate layers (right-click); named shirt templates.
### Fixed
- Out-of-memory on the pattern grid.

## [0.3.2] - 2026-11-14
### Fixed
- V-stripes use the full shirt width for depth.

## [0.3.1] - 2026-11-14
### Added
- V-stripes and multi-colour bands; background remover in the logo cropper.
### Fixed
- Size and rotation of shapes and pen from the middle of the layer.

## [0.3.0] - 2026-11-14
### Changed
- New name **PES KitLab**, new icon, Inter font.
- Collar designs are now layers; sleeves reworked; settings reorganised; "Reset to defaults" replaces "Random".

## [0.2.41] - 2026-11-14
### Changed
- Short sleeve zone measured on the model; long sleeve aligned; sleeves with/without shoulders (curve and stitching); coloured preview grids; 12 new collars.

## [0.2.40] - 2026-11-14
### Added
- Single "Designs" menu (base designs, shapes, panels, cuffs, collars, graphics) with 3D previews; library folders in English.

## [0.2.39] - 2026-11-14
### Added
- Armband parallel to the sleeve hem; movable Sleeves row with mask; mask button by dragging; stitching on cuffs; shine on logos and numbers.

## [0.2.38] - 2026-11-14
### Added
- Long sleeves in the right place; armband glued to the sleeve; centred stitching and group stitching; layer lock.

## [0.2.37] - 2026-11-14
### Added
- Aligned side seam; per-layer stitching; new logo and number positions; "New kit" defaults per type; colour swapper; shirt tucked in; fabric on shorts/socks.

## [0.2.36] - 2026-11-14
### Fixed
- Long sleeves, armband, shoulders, panels, socks, pen, group masks, rotation.

## [0.2.35 to 0.2.30] - 2026-11-13
### Added
- English and Spanish interface (0.2.35); Settings tab (0.2.34); icon tabs and camera menu (0.2.33); single side panel with 3D previews (0.2.32); panels, cuffs and hems as graphics (0.2.31).
### Fixed
- Open side vents of the in-game shirt closed (0.2.30).

## [0.2.29 to 0.2.24] - 2026-11-13
### Changed
- 3D view uses the game's own shirt, sleeves and collar; tucked-in shirt; shorts without cuts; collars without artefacts, 14 designs and a short model list.

## [0.2.23 to 0.2.15] - 2026-11-12/13
### Added
- Pattern and graphics libraries by category (0.2.22); light/ambient menu (0.2.21); Logos and Numbers tabs (0.2.20); vector pen (0.2.19); full text tool (0.2.18); 26 base designs (0.2.17); common layer fields (0.2.16); layer list and PES-Master-style colour picker (0.2.15).

## [0.2.14 to 0.2.2] - 2026-11-12
### Added
- 20 new multi-layer templates; 16 blend modes, mirror and blur; panels as layers; layer groups; custom pattern and free drawing; 3D shine; export size 512–4096; extra cameras, auto-rotate and 3D snapshot; monochrome logo tool.
- Models re-exported with welded seams (no tears), 2D template = `KIT Template.png`.

## [0.2.0] - 2026-11-11
### Changed
- Rewritten in Tauri 2 + Rust with a WebGL2 compositor and Comet 3D models.

## [0.1.x] - 2026-11-07
- First version (Electron): editor, bulk generation, export, versions.
