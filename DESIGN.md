# Edvantage design system

## Direction: Paper and Signals

Edvantage is a shared study library and a personal revision tracker. Its interface should feel like a well-kept reference room: quiet paper surfaces for reading, ink for structure, and restrained color to identify exam papers and study subjects. The page's hierarchy comes from the library and its content, not a stack of dashboard cards.

- **Canvas and surfaces:** neutral light gray canvas with white paper panels; dark mode reverses the surfaces without changing the semantic palette.
- **Color:** graphite ink for primary controls, soft gold as a small focus accent, patina for saved/active states, and muted paper-specific hues for tags.
- **Typography:** Avenir Next/system sans for reading; monospace only for paper and subject labels, counts, and metadata.
- **Tags:** compact rectangular paper labels with a pin mark; stable color assigned from the subject name; selected tag controls use the same visual token as their display form.
- **Layout:** fixed-width desktop navigation, fluid readable content column, collapsible mobile navigation, wrapping action groups, and min-width-zero grid children to prevent overflow.
- **Motion:** brief state transitions on nav and controls; reduced-motion preference is honored.
- **Interaction:** clear keyboard focus, visible hover/selected states, direct action labels, and touch-sized controls.

Tailwind CSS provides the utility and component layer. The compiled `styles.css` is generated from `tailwind.css` with `npm run build:css`.

## Reference

The design vocabulary and review principles were adapted from [Impeccable](https://github.com/pbakaus/impeccable), then tuned to Edvantage's reading-heavy, collaborative study workflow.
