# Attribution and License Notice — Interactive Front and Back Muscle Anatomy

This notice covers the interactive front/back muscle artwork used by
`src/components/MuscleFigure.astro`.

## Artwork

Both files are by **Ryan Graves — Human Anatomy Component System**.

- Front: `public/muscles/male_front_muscle_anatomy.svg`
  - Size: 187,727 bytes
  - SHA-1: `edfbc2102fac0ba294ccbfca6bf084df4850e129`
  - SHA-256: `fb7a1d4933820843446966bda10a915975364589048e509f124067d4211aea26`
- Back: `public/muscles/male_back_muscle_anatomy.svg`
  - Size: 133,560 bytes
  - SHA-1: `0cf50f25f050fa360bcb107147f28573f18f6487`
  - SHA-256: `764b128436ffe5bbe05663c019692601c7e6291c7727c4b311f669fb95927af1`
- Author: Ryan Graves — Human Anatomy Component System
- Figma Community:
  <https://www.figma.com/community/file/1320468164820924031/human-anatomy-component-system>
- Distribution/package: `muscle_mapper` advanced style —
  <https://github.com/suryamolly/muscle_mapper> (see `CREDITS.md`)
- License: CC BY 4.0 — <https://creativecommons.org/licenses/by/4.0/>
  (full legal text in `LICENSE-CC-BY-4.0.txt`)

## Modifications by this project

- Both SVGs are inlined at build time.
- Added `class` and `data-*` attributes for interaction.
- Stripped non-path `<g>` wrapper ids and all path ids in the rendered DOM.
- Added the hover/dialog/index UI.
- No path geometry was changed.

`body-muscles.json` maps the artwork into **48 muscle groups and 139 paths**
(87 front, 52 back). The Arabic/English labels and descriptions are project
content and are not part of the upstream artwork.

## Licensing scope

CC BY 4.0 covers the artwork only, not this site's code. Attribution to Ryan
Graves is required, the license must be linked, and changes must be indicated.
The interactive data and rendered figures are a modified CC BY 4.0 derivative;
redistribution of the artwork must keep this attribution and license notice.
