# Klinip Project Rules

## Frontend UI Standard

For this project only, every frontend or visual UI change must include both of these checks in the same task:

1. `ui-theme-parity`
   Every visual change must work correctly in light mode and dark mode.
   Review cards, dialogs, filters, forms, tables, charts, labels, helper text, icons, borders, empty states, and interactive states.

2. `mobile-compact-ui`
   Every visual change must be reviewed on phone-sized screens.
   Reduce unnecessary height, spacing, duplicated blocks, and oversized controls so the mobile UI stays compact and readable.

## Done Criteria For UI Work

A frontend task in Klinip is not complete until:

- Light mode is correct.
- Dark mode is correct.
- Mobile layout is compact and usable.
- Cards, filters, dialogs, charts, and summaries were checked if the change touches them.

## Reporting

When closing a frontend task for Klinip, explicitly mention:

- light/dark theme support
- mobile compact adjustments
