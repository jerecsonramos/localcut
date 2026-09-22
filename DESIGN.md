# LocalCut Design System

## 1. Visual theme

LocalCut is a quiet, editor-first utility: closer to a small audio console than a marketing landing page. The atmosphere is calm, tactile, and precise. Density is balanced (5/10), variance is lightly asymmetric (5/10), and motion is restrained (3/10). Every visual decision should help a user open, cut, preview, or export media.

## 2. Color palette

- **Paper** (`#F4F0E8`) — application canvas.
- **Raised paper** (`#FFFCF6`) — editor surface and inputs.
- **Ink** (`#14261F`) — primary text, controls, and export bar.
- **Muted ink** (`#718078`) — descriptions, labels, and secondary metadata.
- **Structural line** (`#D9D5CA`) — dividers and field borders.
- **Acid accent** (`#CCE76A`) — primary action, active keep state, and playhead affordances.
- **Literal warning** (`#FF7C52`) — remove mode and errors only.

Use one accent family. Do not introduce gradients, purple/blue neon, pure black, or decorative color changes that do not communicate state.

## 3. Typography

- **Display:** Aptos Display / Arial Narrow fallback, tight tracking, controlled scale.
- **Body:** Aptos / Segoe UI fallback, 14–16px with relaxed leading.
- **Mono:** Cascadia Mono / SFMono-Regular fallback for timestamps, labels, and file metadata.
- Use tabular numerals for changing time values. Keep headings concise and left aligned.

## 4. Component rules

- Primary buttons are dark or acid-filled, tactile, and never glowing.
- Editor surfaces use a quiet border and a tinted shadow; avoid cards inside cards.
- Inputs place their label above the field and keep error/status text inline.
- Empty states show the next action, supported formats, and the privacy boundary.
- Controls remain usable with keyboard focus and a minimum 44px mobile hit area.

## 5. Layout and responsive behavior

- The first viewport prioritizes the media editor, not promotional copy.
- Use an asymmetric empty state on wide screens: action content on the left, local-processing facts on the right.
- Collapse to one column below 760px. Preserve comfortable touch targets and prevent horizontal scrolling.
- Use a consistent 8px spacing rhythm with larger 24–40px section gaps.

## 6. Motion

Motion clarifies state only: subtle hover/press transitions, drag-state emphasis, and reduced-motion support. Animate transform, opacity, background, and borders; never rely on motion to communicate a required state.

## 7. Anti-patterns

- No generic hero copy, oversized empty space, fake metrics, or decorative feature cards.
- No emojis, neon glow, gradient text, pure black, or purple-to-blue defaults.
- No unlabelled icon-only controls, tiny touch targets, or color-only error states.
- No `transition: all`; specify the properties that change.
