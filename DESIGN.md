---
version: alpha
name: Inspection Field and Report System
description: Shared light-theme design tokens for InspectionHub and See It Inspections field and recipient experiences.
colors:
  primary: "#0A4F5B"
  primary-pressed: "#073D46"
  on-primary: "#FFFFFF"
  surface: "#FFFFFF"
  surface-muted: "#F2F5F4"
  on-surface: "#17201D"
  on-surface-muted: "#4A5A55"
  outline: "#556861"
  focus: "#005FCC"
  on-focus: "#FFFFFF"
  module-building: "#174E83"
  module-building-container: "#E8F1FB"
  module-timber-pest: "#654B20"
  module-timber-pest-container: "#F6EEDC"
  classification-major: "#7D2236"
  classification-major-container: "#FBECEF"
  classification-minor: "#425467"
  classification-minor-container: "#EEF2F6"
  limitation: "#694C17"
  limitation-container: "#F9F0DA"
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  label-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0em
  label-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.01em
rounded:
  sm: 4px
  md: 8px
  lg: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  app-shell:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    padding: "{spacing.md}"
  report-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  primary-control:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: "{spacing.2xl}"
  primary-control-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
  secondary-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: "{spacing.2xl}"
  module-building-label:
    backgroundColor: "{colors.module-building-container}"
    textColor: "{colors.module-building}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  module-timber-pest-label:
    backgroundColor: "{colors.module-timber-pest-container}"
    textColor: "{colors.module-timber-pest}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  classification-major-label:
    backgroundColor: "{colors.classification-major-container}"
    textColor: "{colors.classification-major}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  classification-minor-label:
    backgroundColor: "{colors.classification-minor-container}"
    textColor: "{colors.classification-minor}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  limitation-label:
    backgroundColor: "{colors.limitation-container}"
    textColor: "{colors.limitation}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  focus-indicator:
    backgroundColor: "{colors.focus}"
    textColor: "{colors.on-focus}"
    rounded: "{rounded.sm}"
    height: "{spacing.xs}"
  metadata:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
    padding: "{spacing.xs}"
  divider:
    backgroundColor: "{colors.outline}"
    textColor: "{colors.surface}"
    height: "{spacing.xs}"
  page-title:
    typography: "{typography.display}"
    padding: "{spacing.xl}"
  section-title:
    typography: "{typography.headline-lg}"
    padding: "{spacing.md}"
  finding-title:
    typography: "{typography.headline-md}"
    padding: "{spacing.sm}"
---

# Inspection Field and Report System

## Overview

The system serves two contexts from one semantic token layer: fast, safe field capture for inspectors and calm, plain-language property-condition reading for recipients. It defaults to a high-contrast light theme. InspectionHub and See It Inspections may apply host-level brand assets, but they must consume these shared role tokens rather than fork component styles.

The field experience should feel immediate, sturdy, and quiet. Primary actions remain usable one-handed in direct sunlight, at 200% text scaling, and with wet hands or light gloves. Capture acknowledgement must never wait for AI. The report experience should feel measured and evidence-led, placing comprehension above visual novelty.

Building and Timber Pest are separate professional modules. Their labels identify provenance and taxonomy; their colours do not express an overall property rating or purchase recommendation. AI suggestions are provisional and visually subordinate to inspector-confirmed content.

## Colors

The palette uses deep teal for actions, ink neutrals for long-form reading, and pale tonal containers for hierarchy. Pure white report surfaces maximise legibility while a muted background separates cards without relying on shadows.

Building uses blue and Timber Pest uses brown, always paired with the full module name. Major, minor, and limitation treatments are inspector/report labels, never a traffic-light score. Every classification and operational state must also include text and, where useful, an icon or shape; colour alone is never sufficient. Focus uses a distinct blue ring with at least 3:1 contrast against adjacent surfaces.

## Typography

Inter is the shared web and mobile typeface. Headings are compact and decisive; report prose uses generous line height for non-expert readers. Field controls use 16px semibold labels so the action remains legible outdoors. Metadata may use 14px but must never contain the only expression of a limitation, classification, or failure.

Do not force uppercase for long labels. Preserve normal casing for Australian addresses, building terms, and Timber Pest categories. Numeric measurements must include explicit units and should use tabular figures when the platform supports them.

## Layout & Spacing

Use a four-pixel base rhythm with 8px, 16px, 24px, 32px, and 48px steps. Field layouts are single-column and thumb-reachable by default. The primary capture action remains in a stable safe-area position, while secondary tools may scroll. Primary and secondary interactive targets are at least 48 by 48 pixels; no interactive target may be smaller than 44 by 44 pixels.

Recipient reports use a readable single-column measure, progressive disclosure, and persistent module labels. The condition overview presents named major Building findings, a minor-defect summary, Timber Pest findings in their own taxonomy, and material limitations without merging counts or scores. At 320px width and 200% zoom, content reflows without horizontal scrolling.

## Elevation & Depth

Prefer tonal layers, spacing, dividers, and borders over shadows. Field screens avoid translucent surfaces that lose contrast in sunlight. Recipient cards may use one restrained shadow only when a boundary cannot be communicated by tone or outline; shadows never indicate approval, severity, or interactivity by themselves.

## Shapes

Small 4px radii suit labels and evidence metadata, 8px radii suit report surfaces, and 12px radii suit large controls. Keep shapes consistent across hosts. Pills are reserved for compact filters or immutable status chips, never paragraphs or classification explanations.

## Components

Primary controls are high-contrast teal, at least 48px high, and use an explicit verb such as “Take photo”, “Record note”, or “Approve Building report”. Pressed, loading, queued, offline, failed, and disabled states retain the action label and add a non-colour indicator. Haptics and sound may reinforce feedback but never carry it alone.

Investigation capture groups photos, voice notes, measurements, and observations without forcing classification at the shutter. Evidence cards distinguish immutable originals from annotations. AI drafts use a visible “AI suggestion — review required” label and cannot share the confirmed-content treatment until inspector confirmation.

Building and Timber Pest labels remain visible in review, approval, report, history, and PDF contexts. Major/minor labels occur only in Building findings. Timber Pest findings use their own named categories in product code and prose. Material limitations appear near affected conclusions and in the recipient overview, not solely in boilerplate.

Focus indicators are persistent for keyboard and switch navigation. Controls expose accessible names, state, and error relationships. Motion is brief and non-essential, respects reduced-motion preferences, and never moves the primary control while the inspector is capturing evidence.

## Do's and Don'ts

- Do prioritise capture speed, visible local-save acknowledgement, and a stable one-handed action area.
- Do pair every module, classification, limitation, sync, and approval state with explicit text and accessible semantics.
- Do show the source evidence and inspector attribution beside professional conclusions.
- Do place major Building findings and material limitations before totals or supporting detail in recipient views.
- Do preserve the distinction between immutable original evidence and annotated derivatives.
- Don't present a property score, traffic-light buy signal, “pass”, “safe”, or purchase recommendation.
- Don't reuse Building major/minor styling for Timber Pest categories or merge the modules into one conclusion.
- Don't block photo or voice capture on transcription, upload, AI processing, or report generation.
- Don't use colour, sound, haptics, motion, or iconography as the only carrier of meaning.
- Don't place essential actions below a 44px touch target or depend on hover.
