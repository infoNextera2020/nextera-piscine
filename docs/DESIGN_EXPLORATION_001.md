> STATUS UPDATE —30October2026: Anas approved this direction globally in Sentinel_4dfc8e94325c8191959edeb2c3501b67. It is now canonical; see DESIGN_DIRECTION_002_CALM.md. The comparison-only statements below describe the original review phase. Progressive production rollout is not yet complete.

# Home and GreetingCard comparison

This is an opt-in visual proposal, not an approved replacement. Import `DesignExploration` only in the local fixture comparison and pass the existing actual component as its child:

```tsx
<DesignExploration page="home">{commandCenter}</DesignExploration>
<DesignExploration page="challenge">{focusedChallenge}</DesignExploration>
```

The wrapper is presentational: it owns no data, artwork lifecycle, navigation, permission or submission state. Removing it restores the current presentation. Current default routes must not import it until the owner reviews the comparison. Root fixture wiring owns the comparison query and the fixture label.

## Guidance actually available

Read local `emil-design-eng`, `apple-design`, `animate` and the button-press recipe in `/home/anas/.agents/skills`. Installation metadata identifies all three as guidance from `emilkowalski/skills`. The separate Dickwu package was not found in the inspected installed skill locations. Its public SKILL and the relevant rendered GitHub foundation references were subsequently read for the limited review below; no package was installed or script run. Raw SKILL retrieval was restricted and was not retried or replaced with a different download route. These are third-party guidance, not official Apple implementation code.

| Before                                            | After                                                              | Why                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| The welcome competes with the challenge headline  | Compact welcome and a more deliberate current-task card            | Make the next meaningful action the first decision         |
| Several boxed regions carry similar visual weight | One primary card; quieter feedback and context                     | Separate action from supporting information                |
| Wide challenge prose and a loose support rail     | Comfortable reading measure and grouped support                    | Help a beginner stay oriented without removing information |
| Dense, similarly weighted labels and paragraphs   | Size-specific tracking, comfortable leading and consistent spacing | Improve scanning without inventing content                 |
| Press feedback varies between controls            | Subtle 160ms transform response on fine-pointer presses            | Immediate feedback, without moving readable data           |

No page-entry stagger, glass stack, fake 3D, new font/library or keyboard animation is introduced. The existing approved video and Hairline remain the decorative motion. Fine-pointer press feedback uses `cubic-bezier(0.23, 1, 0.32, 1)`; focus-visible/keyboard actions and reduced motion get instant feedback. Semantic headings, links, details, controls and supplied state/status remain intact. The wrapper raises short artwork controls to a 44px target.

## Boundaries and remaining checks

The existing Home video's opaque studio background is still visibly distinct to the owner. This comparison changes composition only; it does not claim a seamless or transparent asset, alter the model or silently rerender it. A future render-background decision remains separate.

No live Auth/DB/Runner or genuine grading is implied by the local fixture. Existing controller and unavailable states remain authoritative. At 320px, card titles have a smaller lower bound, layouts become one column, and essential controls remain visible. Actual fixture browser verification, screenshots, motion and preference checks belong to the integration owner; source checks alone are not visual QA. No real-device Safari/mobile claim is made.

## Limited web foundation review

Context: React/Next.js learning portal for beginners, existing code plus this opt-in presentation wrapper. This is a source review of hierarchy, layout, palette and interaction finish, not a native Apple compliance audit or completed visual/accessibility audit. The current signature is the owner's emerald sculpture/Hairline; controls and reading content should support it quietly. Native menu bars, SF Symbols, Apple materials and native navigation conventions are not being transplanted into this web app.

The [Dickwu SKILL](https://github.com/dickwu/apple-design-skill/blob/main/SKILL.md) limits web apps to principles and foundations. Relevant opened references and headings:

- [cross-platform.md — Vocabulary](https://github.com/dickwu/apple-design-skill/blob/main/references/cross-platform.md): font scaling maps to browser zoom; available space maps to CSS media/container queries.
- [layout.md — Visual hierarchy / Adaptability](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/layout.md): “Order content by relative importance.” The task remains first in source and visual order; the support rail folds below it.
- [accessibility.md — Vision](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/accessibility.md): “Convey information with more than color alone.” Existing text statuses/labels and semantic controls remain; palette is not the authorization or state carrier.
- [typography.md — Conveying hierarchy](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/typography.md): “Minimize the number of typefaces you use”. Existing portal typography remains, with size-specific tracking, relative sizes and bounded reading measure.
- [color.md — Best practices / Inclusive color](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/color.md): accent use stays concentrated on actions and recorded state. The approved black theme is retained, not labelled a verified light-theme design.
- [motion.md — Best practices / Providing feedback](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/motion.md): “Make motion optional.” No new page-entry motion or input delay; visible press feedback is brief and suppresses movement for reduced motion and keyboard focus.
- [buttons.md — Best practices / Style](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/buttons.md): prominent styling is reserved for the next action; custom controls retain explicit labels and comfortable targets.
- [design-principles.md — Purpose / Simplicity / Delight](https://github.com/dickwu/apple-design-skill/blob/main/references/hig/design-principles.md): the learning task is the organizing purpose. The existing artwork is the signature; no extra decorative panels, fabricated metrics or ornamental numbering were added.

Computed WCAG contrast of this proposal's declared opaque pairs: primary text `#f3f7f4` on black **19.42:1**; supporting text `#b7c3bb` on `#080c0a` **10.81:1**; quiet text `#aab7af` on `#050705` **9.72:1**; kicker `#9eada3` on black **8.96:1**; CTA ink `#032017` on emerald `#62e7b1` **11.11:1**. These are source calculations, not a claim that every inherited state or rendered pixel was audited. Small proposal labels are at least `0.6875rem` and controls at least 44px high. Browser zoom, focus order, actual motion and all rendered state colors still require the integration owner's fixture checks.

Source checks: own TSX ESLint, web TypeScript and own-file Prettier passed. The checked wrapper adds no client effects, dependencies or new runtime state. Browser evidence is deliberately separate and pending integration.
