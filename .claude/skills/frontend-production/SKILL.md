---
name: frontend-production
description: Use when planning or implementing production frontend UI, interaction design, responsive layouts, animation, or component architecture.
---

# Production Frontend

## Before coding
- Read package manifests, app entry points, routes, styling setup, existing components, lint/type-check/build scripts, and design conventions.
- Identify the target users, key flows, responsive breakpoints, accessibility requirements, and data states.
- Plan before implementation and wait for explicit approval.

## Design system
- Define/reuse tokens for color, typography, spacing, radii, shadows, focus, and motion.
- Prefer coherent hierarchy and real content over generic dashboard cards or decorative gradients.
- Ensure mobile, tablet, and desktop behavior.
- Include loading, empty, error, disconnected, permission-denied, and success states where applicable.
- Use semantic elements, accessible names, keyboard navigation, visible focus, and sufficient contrast.

## Animation/tool selection
- Use CSS for simple transitions and micro-interactions.
- Consider GSAP for complex timelines or scroll-linked scenes.
- Consider React Bits for a specific reusable visual treatment, after checking the component's source, dependency footprint, license, accessibility, and fit with the current framework.
- Consider Lenis only for a clear smooth-scroll use case; avoid breaking browser-native scroll, anchors, keyboard behavior, or reduced-motion settings.
- Consider Motion/Framer Motion for React state-driven transitions when already present or justified.
- Do not install all of these by default. Propose the minimum set, including a no-new-dependency option.
- Respect `prefers-reduced-motion`; animations must not block core actions or content.

## Production quality
- Avoid unbounded effects, unnecessary re-renders, layout shifts, giant bundles, inaccessible custom controls, and hard-coded secrets/endpoints.
- Include responsive and interaction tests appropriate to the repository.
- Do not claim browser testing without actually performing it.
