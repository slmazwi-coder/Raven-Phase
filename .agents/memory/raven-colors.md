---
name: Raven color tokens
description: The always-dark theme structure and how useColors() reads it.
---

## Structure
`constants/colors.ts` exports `{ light: ravenTheme, dark: ravenTheme, radius: 12 }` where both keys point to the same dark palette object. This means useColors() always returns the dark Raven theme regardless of system setting.

**Why:** Raven is a privacy-first app with a deliberate dark identity. We never want light mode accidentally rendering.

## Key tokens
| Token | Value | Use |
|---|---|---|
| background | #1A1A3C | Screen backgrounds |
| surface | #252550 | Cards, list items |
| surfaceElevated | #2F2F60 | Chat bubbles (received), modals |
| primary | #F87920 | CTAs, active tab, sent bubbles |
| accent | #EC5837 | Errors, alerts, destructive actions |
| tabBar | #12122A | Tab bar background |
| text | #F2F2F2 | Primary text on dark |

## How to apply
- Always use `colors.light.X` directly in StyleSheet.create() (since both keys are identical)
- Or use `useColors()` hook for runtime access (same result, slightly more overhead)
