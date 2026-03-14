---
name: ui-copy-integrity
description: Verify visible UI copy for encoding issues, mojibake, malformed accents, stray replacement characters, and spelling mistakes. Use when modifying frontend text, labels, cards, dialogs, helper text, empty states, alerts, onboarding copy, navigation text, landing content, or any user-facing strings in Klinip.
---

# UI Copy Integrity

Apply this check whenever a task changes visible text or could expose existing broken text.

## Workflow

1. Review all affected user-facing strings.
2. Check for encoding corruption.
   Look for mojibake such as `Ã¡`, `Ã³`, `Â`, `�`, or other broken accent sequences.
3. Check spelling and grammar.
   Fix obvious spelling, accent, punctuation, and capitalization issues in Spanish UI copy.
4. Check mixed-language or malformed labels.
   Ensure headings, buttons, badges, helper text, alerts, cards, and empty states read naturally.
5. Re-check the final UI surface after edits.
   Do not stop at source text if the rendered result can still be wrong.

## Rules

- Prefer UTF-8 safe text in source files.
- Treat visible copy as part of UI quality, not as optional polish.
- Fix existing corrupted strings found in the touched surface, even if they predate the current task.
- When a text choice is ambiguous, prefer simple clinical Spanish consistent with Klinip.
- Watch summaries, AI cards, alerts, medication labels, document labels, and landing copy carefully.

## Done Criteria

- No mojibake or broken accent characters remain in the touched UI.
- Visible Spanish copy has no obvious spelling mistakes.
- Labels, helper text, alerts, and summaries read naturally.
- The final UI was checked together with theme and mobile passes when applicable.

## Response Pattern

When reporting the work, mention the UI copy integrity pass explicitly.
State whether encoding issues or spelling fixes were corrected in the touched surfaces.
