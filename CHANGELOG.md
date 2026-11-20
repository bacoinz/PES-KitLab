# Changelog

All notable changes to PES KitLab. Newest first. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.5.15] - 2026-11-20
### Added
- New "Analyzer" tab (between "Bulk generator" and "Library"). The texture analyser moved out of the editor into its own screen with a large texture view (wheel zoom, drag to pan). The source is a PNG / FTEX file or a kit read straight from the game (pick team and kit). Open a team to apply the result to one of its kits (or a free slot).
- Selection tools on the texture after the analysis: "Colour" (click a colour or a detail to take it out or put it back), "Rectangle" and "Lasso" with "Take out what is inside" / "Keep only what is inside" (red / green outlines), plus "Undo selection" and "Reset all". The before / after slider now reflects every choice at once (colours, merges, parts, details and selections), with the "Difference map" and the mean difference computed from what you chose.
- "Generated layers" list in the Analyzer: tick the layers you want and "Save N layer(s)" puts them in the user library (KitCreatorData\layers).
- Library → "Saved layers": preview, rename, delete. In the editor, Add layer → "From the library" inserts a saved set into the open kit (optionally with its base colours).
- The camera buttons of the viewer have a new "Reference window" button (3D and 2D): it shows / hides the floating reference window without losing the image; with no image loaded it asks for one.

### Changed
- Origin tab order: Kit colours, Origin, Pattern generator, Colour variants, Full template, Copy to all kits, Reference image. The "Analyze texture" section was removed from the editor (it is the Analyzer tab now).

## [0.5.14] - 2026-11-20
### Added
- Team cards (Teams screen) have "Import .kitlab": pick a file, the team opens in the editor (its saved work, or new kits) and the import dialog follows, with the usual choices for crest, brand and sponsors.
- Team cards with saved work also have "Export .kitlab": it asks which of the team's kits (only when there are several) and writes the file with the crest, brand and images.

## [0.5.13] - 2026-11-20
### Added
- Texture analyser, phase B (vectors): the review screen has a new "Shapes" section. "Recognise stripes, bands and halves of the shirt" (on by default) turns regular vertical stripes, horizontal bands and a right-half into the kit's own pattern layers (count, stripe width, gap and offset read from the texture, checked on the back of the shirt too), which are much easier to edit than free shapes. "Convert the other colours into vector shapes" turns the remaining colour masks into closed Bézier shapes; the tolerance (Fine 1 px, Normal 2 px, Loose 4 px) sets how closely the curves follow the edges.
- Vectorizer in the app core: it traces the mask edges, drops specks and tiny holes, keeps sharp corners as corners, fits cubic Béziers elsewhere (straight edges stay straight lines) and uses holes correctly (even-odd fill). A shirt-sized mask takes a few milliseconds.
- Layer panel: an "Image/texture" layer that came from the analyser (a colour mask) now has a "Convert to vector" button; it replaces the mask by vector shapes and opens them in the pen editor. The pen editor shows holes of such shapes correctly.

### Changed
- Kit format version 11: vector layers can be in texture space (the kit's own layout, in px) instead of the unit box, so shapes taken from a texture keep their exact place. Older kits and files open unchanged; a file made with this version is refused by older versions of the app with a message.

## [0.5.12] - 2026-11-20
### Added
- Colour variants (Origin tab → "Colour variants"): proposals of the current kit in other colours (Inverted, Complementary, Analogous (+/−), Triad A/B, Darker), shown as a grid of previews. The kit's three main colours are swapped everywhere they are used (colour slots, layers, collar, cuffs, gradients and outlines), so edges stay clean and nothing is repainted pixel by pixel.
- Variants are checked with the legibility check: the name and numbers of recolourable prints get the nearest colour that reads well, and a variant that would read worse than the current kit is left out (a checkbox shows them anyway). "More variants" tries other hue turns.
- "Create N variant(s)" puts the selected ones into the free kit slots of the same kind (players p1-p12, goalkeepers g1-g4) in one undoable step; it warns when there are fewer free slots than variants, and when there are none.

### Changed
- The legibility check measures recolourable prints with the colour set in the Numbers tab instead of the colour of the loaded glyphs.

## [0.5.11] - 2026-11-20
### Added
- Texture analyser (Origin tab → "Analyse texture"): opens a kit texture (a PNG or FTEX file, the game's kit for the current slot, or the base texture imported in the kit) and splits it into editable layers. The app core smooths the fabric grain and compression noise with an edge-preserving filter, finds the flat colours (the number of colours is automatic or chosen, with a sensitivity slider), and makes one colour mask per colour and kit part (shirt, sleeves, shorts, socks). Each mask becomes an image layer painted in one colour, so it can be recoloured, hidden and reordered; the main colour of each part becomes its base colour.
- Crests, sponsors, gradients and painted shadows are not flat colours: they are cut out of the original into one "Details" layer per part.
- Review screen before anything changes: the original against the result with a sliding curtain, a difference map and the mean difference per pixel, the colours found (merge similar colours, drop the ones you do not want), and per part: use it or leave it alone, keep or drop its details. The result goes into the current kit or a free slot and can be undone.
- Limits shown in the review: shadows, folds, gradients and photographic textures stay as an image, and designs that cross seams are split by kit part.

## [0.5.10] - 2026-11-20
### Added
- Pattern generator (Origin tab → "Pattern generator", for kits that are not a full imported texture): pick a style (Vertical stripes, Horizontal bands, Halves and quarters, Diagonal sash, 70s retro, Classic Italian), the three colours and optionally the number and width of the stripes, bands or collar panel, see a preview, and press "Generate". The kit gets normal, editable layers (patterns, panels, sleeve / shorts / socks designs, collar and cuffs), not a flat image, and the step can be undone.
- "Surprise me" tries another variant of the same style; the same seed always gives the same kit.

## [0.5.9] - 2026-11-20
### Added
- Reference image (Origin tab → "Reference image"): load a photo or screenshot of a real kit to copy from (button, paste with Ctrl+V, or drop it over the viewer). It only lives in this session: it is never part of the kit, the undo history, the exported texture or the 3D view.
- Floating reference window over the viewer (3D and 2D), in the bottom-right corner above the camera buttons by default. Drag the title bar to move it, the top-left corner to resize it (Shift keeps the shape), use the mouse wheel to zoom around the cursor, drag the image to move it and double click to fit. It can be minimised, closed (the image stays loaded) and reset to its default place; its position and size are remembered.
- The reference can also be shown over or under the kit on the 2D texture view, with opacity, size, position and rotation. The eyedropper reads colours from the reference window (the droplet button in its title bar, or the eyedropper tool) and from the 2D view including the reference.
- New command "Show / hide the reference window" (assignable in Settings -> Keyboard shortcuts).

## [0.5.8] - 2026-11-20
### Added
- Numbers tab: a "Legibility" check. It measures the contrast (WCAG ratio, minimum 3:1) between the back number, the name, the chest number and the shorts number and the kit right under them, so stripes, patterns and fabrics count (the worst 5% of the pixels are left out as noise). With an outline, the outline colour is measured. It is only a warning and never blocks anything.
- When a part is hard to read, a "Use #rrggbb" button picks the closest kit colour (or white / black) that passes and applies it. For the game's own baked-in numbers the tab suggests switching to "Recolour the game's".

## [0.5.7] - 2026-11-20
### Added
- Shareable kit files (`.kitlab`). Origin → Share → "Export .kitlab…" saves the current kit with everything it uses (layers, colours, fabrics, numbers and names, sponsors, the crest, the brand and all the images) in one file; "Import .kitlab…" puts a file into a kit slot of the open team. The crest and the brand are always exported, also for kits that come from the game.
- The import dialog shows a preview of the kit, lets you pick the target slot (free slots first, or replace one) and asks whether to use the crest, the brand and the sponsors from the file or the team's own ones (position, size and colours always come from the file). It also warns about fonts that are not installed on this PC.
- Files are checked before they are opened: only the kit and its PNG / JPG / WebP images are accepted, with size limits, and nothing in the file is ever run. Files made by older versions open through the normal kit migrations; files made by a newer version are refused with a message. Imported images get new ids, so nothing already in the team is overwritten.
- The first export shows a reminder that official logos and brands may be copyrighted.

### Fixed
- Saving a kit as a template (Origin → "Save as template…") now also keeps the image of the captain's armband.

## [0.5.6] - 2026-11-20
### Added
- Keyboard shortcuts. In the editor, with a layer selected: arrow keys move it 1 px (Shift: 10 px), `[` and `]` move it down / up the layer list, Del deletes, Ctrl+D duplicates, H hides / shows, L locks / unlocks, + and - resize, R rotates 15°. They do nothing while you type in a field, and a locked layer is not moved or deleted.
- Ctrl+Shift+Left / Right switch between the editor tabs (it wraps around); Alt+1 … Alt+7 jump straight to a tab; Ctrl+Tab still switches between the 3D view and the 2D texture.
- Command palette (Ctrl+K): search and run any command. "?" shows a sheet with every shortcut.
- Ctrl+Enter in the Bulk generator runs "Generate teams".
- Settings → "Keyboard shortcuts": every shortcut can be changed (click it, press the new combination; Esc cancels, Backspace removes it), with a search box, a warning when a combination is already used (you can swap them) and "Reset" / "Reset all". F5, Ctrl+R, Ctrl+P and Ctrl+F belong to the web view and are blocked.

### Changed
- Undo / Redo (Ctrl+Z / Ctrl+Y) and Ctrl+Tab now go through the same shortcut system, so they can also be changed in Settings, and Ctrl+Z / Ctrl+Y no longer interfere with text areas and drop-downs.

## [0.5.5] - 2026-11-20
### Added
- Captain's armband: an "Image/texture" option. Modes: fill the whole band, loose image (aspect kept, with Size / Position X / Position Y), or "Full texture (only the armband)" which takes just the armband area from a full kit texture (picked automatically for square images).
- Every font installed on the PC can now be chosen in all text fields (text layers, armband, numbers and names), with a search box in the font picker.
- The font list updates by itself: a font installed while the app is open appears within a few seconds or as soon as the window gets focus.

## [0.5.4] - 2026-11-20
### Added
- Up to 12 team kits and 4 goalkeeper kits per team (the "Add kit" list, the game/kit-server reader and the export now cover p1-p12 and g1-g4, in numeric order).
- In the Teams grid every kit of a team is shown in the same card space; the kit row scrolls sideways (mouse wheel works too) to reach the ones that do not fit.

### Changed
- The "Image" layer is now called "Image/texture".
- A full kit texture (square image) imported into an Image/texture layer now only brings in the part of the current tab: Shirt (front, back, short and long sleeves, collar), Shorts or Socks. Picking a square image switches the layer to the "Full texture (only this tab's part)" mode automatically.
- New kits start with plain, single-colour socks instead of a template pattern on the socks.

### Fixed
- Colour detection on existing kits ("Kit colours" / recolouring) is more accurate: it now uses a colour histogram on sharp (non-blurred) pixels and reports only colours that really cover area, so blends of two colours (for example purple from a blue and red kit) no longer appear.

## [0.5.3] - 2026-11-20
### Added
- "Buy me a coffee on Ko-fi" button (https://ko-fi.com/bacoinz) on the start screen and in a new "Support the project" card in Settings.

## [0.5.2] - 2026-11-19
### Added
- Captain's armband: a "Font size" slider for the armband text.

### Fixed
- Text layers on the shorts now appear on one leg only; "Mirror" (centre) puts the mirrored copy on the other leg.
- The mirrored copy of shorts text keeps its letters reading normally instead of being flipped.

## [0.5.1] - 2026-11-19
### Fixed
- A layer with its own fabric no longer gets the kit's base fabric on top: the kit fabric now skips every layer, group, collar, cuff, logo or shorts / socks design that has a fabric of its own (one or the other), on the shirt and the shorts.
- Stitching on a layer with a mask no longer darkens the whole kit: when the mask left nothing to stitch in a zone (for example a mask that only covers the front), an empty stitch image was read as opaque black and laid over that whole zone.

## [0.5.0] - 2026-11-19
### Changed
- New start screen: the logo and name with a small version next to them. On the first run it shows the "Choose game folder…" button and the folder field; on later runs it shows a loading spinner with the current loading step in small text underneath.
- Small footer with the GitHub repository, an "Other projects" link (https://bacoinz.github.io/) and the credits, at the bottom of the start screen and of Settings.

## [0.4.23] - 2026-11-19
### Changed
- Shorts stitching defaults (hem, fly and back): dashed topstitch, centred, intensity 40, scale 20, relief 5.
- Kits that had a shorts design inside Base now get it as a normal layer on the shorts (same drawing, stitching and fabric), so it stays editable.
- Imported kits: fabric and stitching can also be changed on the shorts (hem, fly / back seam, kit fabric) and the socks (fabric).

## [0.4.22] - 2026-11-19
### Changed
- 3D speed without losing quality: the kit texture is now drawn straight inside the 3D view's own WebGL context (copying the 2048² texture between contexts took ~40 ms on every change); the half-size draft while dragging is gone. Moving a slider on the AVS kits went from ~65 ms to ~15–25 ms per change.
- Compositor: logos and small parts are drawn only over their own area; the picture before the layer being changed is kept and reused; painted canvases (stitching, fabrics, designs) are no longer thrown away on every render; fabric on plain layers is masked on the GPU; stitching keeps its last shape while a slider moves and is traced again when it stops.
- Hem stitching (shirt and shorts) and the fly / back seam are drawn as real thread lines: thin, following the stitch size (also at the minimum), with the light edge only when relief is on.
- Collar: the inside is always the exact mirror of the outside (every collar design); "Sides" / "Colour 2 goes to" options removed.

## [0.4.21] - 2026-11-19
### Changed
- Editor speed: while a slider (or any quick run of changes) is moving, the texture is drawn at 1024 px (about 3× faster on a kit with many layers) and a full-size render follows when you stop.
- Collar: the whole design of the outside is reflected above the fold (same colours, mirrored), leaving the top of the strip free for the inside of the shirt.
- Sponsors / brands, text and images on the socks take the sock base fabric (in 2D and 3D).
### Fixed
- The shorts fly / back seam was not showing; it is now a single thin dashed line.

## [0.4.20] - 2026-11-19
### Changed
- Editor speed: the 3D relief map, the sock relief map and the shininess map are only built when something needs them, and wait until you stop moving a slider (0.7 s).
- Fabric, stitching and embroidery remember their last values when switched off and on again. Changing a layer's design keeps its fabric, stitching, embroidery and relief.
- All stitching starts at strength 30, size 45, relief 0 (cuffs centred). The fly / back seam is a single thin dashed line.
- The kit's hem stitching is only the bottom hem of the shirt (not the cuffs).
- Cuffs start with the fine rib fabric at size 70, angle 90, strength 40 (also cuff layers); sock base fabric starts at size 110, angle 0, strength 10, mix 20; fabric on sock layers at size 100, angle 0, strength 25.
- New kits start with shininess on for name and numbers (90) and for emblems, brands and sponsors (general 75, "Same in all" off); a logo without its own value follows the general one; sponsors on the socks start with shininess off.
- Collar: the design of the outside (below the fold) is reflected above it, leaving a free space at the top for the inside of the shirt (no collar colour or fabric there).
- First tab: the "3D preview" area was removed.

## [0.4.19] - 2026-11-19
### Changed
- Shorts: the hem and fly / back stitching options are inside the Base row again (no separate row); both start switched on (also in kits saved with 0.4.18).
- Shorts hem stitching sits a little inside the leg end; the fly and back stitching follows the notch edge of one leg only (the other leg meets it there), so it is no longer doubled.
- Sock fabric starts at strength 10, mix 50. Its relief in 3D only covers the sock base, not the sock layers or logos.

## [0.4.18] - 2026-11-19
### Added
- Socks: the sock texture is now a real fabric on the sock base (on by default: fine rib, size 110, strength 20, mix 85), shown on the 2D texture too; it also drives the sock relief in 3D. Socks have no base design any more, only colour, with "One colour per sock" (a second base colour).
- New sock design layers start with the fine stretchy rib (size 100, angle 0, strength 15).
- Shorts: locked "Shorts stitching" row with Hem and Middle (fly and back seam) stitching (new kits: double stitch on both); the hem stitch of the kit no longer touches the shorts. The base is only the colour (shorts model picker removed).
- Fabric and stitching switches in the texture view: "Show fabrics" (all fabrics) and "Show stitching" (all stitching and relief), both on by default.
- Kit fabric: "Also on the shorts" switch (the socks have their own fabric).
### Changed
- "Mirror to the other side of the sock" now adds a mirrored copy on the opposite side of each sock.
- Text placement "Back of collar" is now "Collar"; picking it starts at Y offset −54, size 30.
### Fixed
- Collar faces are back as they were: the outside is below the fold, the inside above it. The collar colour covers the outside; the inside is the shirt's primary colour.
- "Fabrics in 3D" only hid some stitching; it now hides every fabric and no stitching.

## [0.4.17] - 2026-11-19
### Added
- More than one sponsor on the socks ("+ Sponsor on the socks": both socks, left or right).
- Text layers: "Vertical text" (letters stacked one under the other).
- Image / text layers on the socks: "Mirror between the socks" puts the right sock's copy on the opposite side of the leg.
- Shorts and socks base designs have Stitching and Fabric.
- Logos tab → "Same in all": every logo starts with shininess on; each logo has its own slider and can be switched off.
### Fixed
- The sock texture (stretchy rib) was not applied to the socks in the 3D preview; it is now, and stronger.
- Collar colour only covers the outer face (above the fold); the inner face is the shirt's primary colour.

## [0.4.16] - 2026-11-19
### Added
- Fabric and stitching of the whole kit are drop-downs (no more library): "Fabric" (same types as layers; new kits start with fine knit, size 48, strength 31, soft light) and "Hem stitch" (new kits: double stitch, strength 50, size 45, relief 10). Kits saved before keep neither.
- Fabric and stitching can be put on base designs; they only affect the design's elements, not its base colour.
- Sock texture in the 3D preview: size, strength and mix (with the kit's grain), type = fine stretchy rib.
- Text on the back of the collar wraps round the collar band (what leaves one end comes in at the other).
### Changed
- Layers and logos with their own shininess are not covered by the kit's fabric (one or the other); a layer with shininess ignores its own fabric.
- Layer options: outline, stitching, embroidery, fabric and shininess now come after blend mode, opacity and blur.
- Fixed rows start in the order Sleeves, Collar model, Base, Fabric and stitching (top to bottom).
- Cuffs start with stitching (strength 31, size 45, relief 11) and the fine rib fabric at angle −90; sleeves no longer start with stitching.
- Relief is tighter (less blur, smaller shadow).
### Fixed
- Collar faces: the outer face of the collar is above the fold and the inner one below it (measured on the collar model), so "Outside only / Inside only" and the text on the back of the collar now land on the right face.

## [0.4.15] - 2026-11-19
### Added
- Layer masks now also apply to the layer's stitching, fabric and relief (they follow the masked shape).
- "Relief" also lays a small soft drop shadow round the layer.
- Fabric can be set on a group (it covers everything the group draws); collar layers can have stitching.
- Origin tab → 3D preview: "Sock texture" (stretchy knit / same as the rest of the kit; 3D only) replaces the shirt in/out option, which stays in the 3D panel.
### Changed
- New collar designs and cuffs start with the fine stretchy rib fabric (scale 77, angle 0, strength 25); fabric on sleeve-only layers starts at scale 77, angle −90, strength 25.
- New collar layers and new kits start with stitching (strength 31, scale 45, relief line, relief 11), also on the sleeves.
- The inside of the shirt (everything past the collar band) is filled with the shirt's primary colour instead of the collar colour.

## [0.4.14] - 2026-11-19
### Added
- "Relief" option on stitching and on outlines (logo outline, text outline, design outline): the fabric around the seam / outline stands out in the 3D preview (3D only, not in the texture).
- Sleeves with shoulders: new "Angle" slider (how sharp the seam's corner is); the old "Angle" is now "Curve". New sleeves start from the preferred default points.
### Changed
- Texture view: the "3D mesh" button now draws the 3D model's real mesh (UV wireframe) over the texture.
- Stitching on every layer is a drop-down ("None" / stitch type) like Fabric; its options sit in their own sub-section. Embroidery and fabric options also sit in a sub-section.
- Embroidery list order: chain, cross, satin, tatami; defaults scale 70, angle 45, strength 49.
- Sleeve point sliders no longer say "point" (Arm X / Y, Neck (Front) X / Y, Neck (Back) X / Y).
- Own shininess says "Same as the shirt fabric" when off.

## [0.4.13] - 2026-11-18
### Added
- Texture view: "3D mesh" button (shows / hides the model's outlines over the texture) and "Fabrics in 3D" button (shows / hides the fabric textures in the preview) replace the "Long sleeve" button there.
- Sleeves with shoulders: separate back neck point; sliders "Arm point X / Y", "Neck point (Front) X / Y", "Neck point (Back) X / Y".
- "Embroidery" texture (satin, tatami, cross stitch, chain stitch; size, angle, strength) on every emblem, brand, sponsor, image layer and text layer.
- "Fabric" option on layers (knit, mesh, piqué, rib, fine rib, collar / cuff elastic, jacquard, honeycomb, twill) with size, angle and strength; collar layers and cuffs can limit it to chosen colours.
- Socks have a stretchier knit relief in the 3D preview (3D only, not in the texture).
### Changed
- Sleeves with shoulders: "Bend" is now called "Angle".

## [0.4.12] - 2026-11-18
### Fixed
- Free image layers set to show on "Sleeves" now appear on the sleeves (they were only drawn on the front and back); with "Short sleeves only" they stay off the long ones.
### Changed
- Sleeves → "Sleeves with shoulders": "Bend" is now the angle between the seam's two ends (neck point and armpit point), in degrees; kits saved with the old pixel value keep their look.
- "Neck point" is now "Neck point X" and "Lower the neck point" is "Neck point Y".

## [0.4.11] - 2026-11-17
### Changed
- After exporting kits, the destination folder opens (the club's folder for one team, the export folder for several).

## [0.4.10] - 2026-11-17
### Added
- Settings → General: default folder for kit export, with an "Always ask" checkbox (when ticked, the folder is chosen each time and the saved one is disabled).
### Changed
- Export always creates a folder named after the club first (also for a single team).

## [0.4.9] - 2026-11-17
### Added
- New "Export" button (header, for the selected teams, and on each team card) that saves the kits in the Sider kit-server layout (`p1/`, `g1/`…, `order.ini`, `gk_order.ini`) to a folder you choose; with several teams, one sub-folder per club.
### Changed
- The old "Export changes" / "Export" buttons are now "Import into the game" / "Import" (they write to the game).

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
