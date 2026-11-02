# Interactive Front and Back Muscle Anatomy

Front/back interactive anatomy atlas built from the Human Anatomy Component
System artwork.

## Artwork

- Author: Ryan Graves — Human Anatomy Component System
- Figma Community:
  <https://www.figma.com/community/file/1320468164820924031/human-anatomy-component-system>
- Distribution/package: `muscle_mapper` advanced style —
  <https://github.com/suryamolly/muscle_mapper> (see `CREDITS.md`)
- License: CC BY 4.0 — <https://creativecommons.org/licenses/by/4.0/>
- Front: `public/muscles/male_front_muscle_anatomy.svg`
  (187,727 bytes; SHA-1 `edfbc2102fac0ba294ccbfca6bf084df4850e129`;
  SHA-256 `fb7a1d4933820843446966bda10a915975364589048e509f124067d4211aea26`)
- Back: `public/muscles/male_back_muscle_anatomy.svg`
  (133,560 bytes; SHA-1 `0cf50f25f050fa360bcb107147f28573f18f6487`;
  SHA-256 `764b128436ffe5bbe05663c019692601c7e6291c7727c4b311f669fb95927af1`)

## Interactive data

`body-muscles.json` maps the artwork into **48 muscle groups** and **139 paths**
(87 front, 52 back).

Modifications: both SVGs are inlined at build time, `class`/`data-*` attributes
are added for interaction, `<g>` wrapper ids and all rendered path ids are
stripped, and the hover, dialog, and index UI is added. No path geometry was
changed.

See [NOTICE.md](NOTICE.md) for attribution and modification details, and
[LICENSE-CC-BY-4.0.txt](LICENSE-CC-BY-4.0.txt) for the full CC BY 4.0 legal
text. The license covers the artwork only, not the site's code.
