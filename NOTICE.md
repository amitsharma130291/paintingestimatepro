# Template attribution

This homepage was built for the **Painting Estimate Pro** homepage brief,
which asked for the visual direction of the **Mainline** template
(shadcnblocks.com/template/mainline).

## What was checked

- The official Astro edition of Mainline is open source:
  https://github.com/shadcnblocks/mainline-astro-template
- License: MIT License **+ Commons Clause License Condition v1.0**
  (Copyright (c) 2025 shadcnblocks.com — Rob Austin). Free to use, modify,
  and ship as part of a website or product; the one restriction is that you
  may not resell the template itself, unmodified, as a template.

## Why this build does not vendor Mainline's source directly

The official Astro edition ships shadcn/ui + React 19 + Framer Motion
("Motion") as its component layer — every section (navbar, hero, FAQ,
footer, etc.) is a hydrated `.tsx` island. The brief for this homepage
explicitly requires the opposite: static Astro HTML, no React hydration,
and only small vanilla-JS behaviors for the mobile menu, FAQ disclosure,
and scroll-entrance animation. Shipping Mainline's actual components would
mean hydrating a full React app just to render a static marketing page,
which conflicts with that requirement.

**Substitution made:** this homepage is an original Astro + Tailwind CSS
implementation, built by studying Mainline's structure and design
language (sticky translucent header, generous section rhythm, card/border
system, restrained type scale, OKLCH-derived neutral palette pattern) and
reimplementing it with plain HTML, Tailwind utility classes, and the
project's own painting-specific design tokens — no Mainline source code,
Tailwind config, or component files were copied.

Per the brief's instruction to disclose any substitution: this is that
disclosure. If a byte-for-byte port of the official React/shadcn
components is later wanted instead, clone
`shadcnblocks/mainline-astro-template` and keep its LICENSE file alongside
the copied files, per the Commons Clause terms above.
