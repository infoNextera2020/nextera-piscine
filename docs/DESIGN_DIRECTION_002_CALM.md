# Canonical portal design direction: calm

Approved by Anas on30October2026, message Sentinel_4dfc8e94325c8191959edeb2c3501b67: “اعتمد الشكل الجديد في كل اللي جاي اللي اتصمم واللي لسة متصممش”. This supersedes comparison-only approval status. The calm direction is canonical for existing and future portal screens; implementation rolls out progressively. Approval is not a claim that all screens have already changed.

## Direction and invariants

Keep01coding identity, the X01-only header, true black/white with restrained emerald, a clear primary task, comfortable reading measure, deliberate whitespace, quiet secondary feedback and useful component states. Reuse shared semantic tokens/components as each screen is migrated. No decorative glass stack or gratuitous movement. The approved video and Hairline remain the signature artwork; preserve heart geometry, node positions, full-viewport fit and all interaction/accessibility meaning.

Preserve actual content, route destinations, server-owned eligibility, submissions, attempts, deadlines, drafts, evaluation and role boundaries. A design approval cannot grant credentials, runtime services, database changes or permission to bypass any stopped action. Do not replace unavailable backend states with successful fixtures.

The owner still sees the opaque Home video background as separate from the page. It remains an open art-integration issue; current CSS fading is not called seamless. Do not rerender or alter the model without reviewing the required art change. Keep reduced-motion static alternatives and hidden/offscreen suspension. New motion must have a useful purpose, be interruptible, avoid delaying keyboard actions and use restrained press feedback.

## Implementation stages and verified coverage

1. Home and GreetingCard establish the shared visual baseline. Their real components already have the calm surface available and were fixture-browser checked at1440/768/390/320pixels, with keyboard controls and actual motion. Current production routes have not yet adopted the wrapper by default; apply that first, retaining behavior and verifying the actual route composition. The historical comparison remains available as evidence.
2. Apply the same tokens/component language to Sunday's login/invitation, checkpoint, project and assigned-mentor screens in bounded slices alongside backend work. Keep current approved flows and full state coverage; ask before inventing any genuinely new screen or mixed-answer interaction.
3. Extend remaining settings/staff/admin surfaces progressively. Full-platform restyling must not block genuine invitation, Runner, exam persistence, project/mentor or joined end-to-end verification. Advanced assignment/exception/admin features remain deferred from the trial.

OS reduced-motion emulation and OS-light preference are not live-browser passes. Current source has reduced-motion alternatives. Browser evidence is component-fixture evidence, not live Auth/DB/Runner or a full HIG audit.

## Historical comparison skill provenance

The installed skill lock maps all three following packages to emilkowalski/skills. These are installation folder hashes, not recorded Git commit IDs:

| Read local file                                    | Recorded folder hash                     | Contribution                                                                                                               |
| -------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| /home/anas/.agents/skills/emil-design-eng/SKILL.md | db7a20dc1d8ad26a0307dcb45ebc79fc372f5c69 | Primary-task hierarchy, quieter secondary surfaces, typography and restraint                                               |
| /home/anas/.agents/skills/apple-design/SKILL.md    | cd509ae729c86487d352e17a26651217a4c25711 | Grouping, spacing, text hierarchy, responsive and accessible feedback                                                      |
| /home/anas/.agents/skills/animate/SKILL.md         | a92e36f28d741aee4ff77d1a001300d7e86e07fe | 160ms transform-only press feedback, fine-pointer hover gating, immediate keyboard feedback and reduced-motion alternative |

The button-press section of /home/anas/.agents/skills/animate/RECIPES.md was also read. Existing frontend implementation guidance was used for engineering checks.

The separate dickwu/apple-design-skill package was not installed in the inspected local skill locations. During comparison review, the design worker read its rendered public SKILL.md and references/cross-platform.md plus references/hig/accessibility.md,layout.md,typography.md,color.md,motion.md,buttons.md,design-principles.md. This was a limited web-foundation review after the initial CSS draft, not the initial implementation source, a package installation, or a native Apple compliance audit. It supported checks of contrast, target sizes, hierarchy, readability and restraint. The document records computed key text contrast8.96–19.42:1 and CTA11.11:1. No Dickwu Git commit was pinned. A raw-file retrieval failed and was not retried; no repository script was run.

See docs/DESIGN_EXPLORATION_001.md for exact public reference links and the historical Before/After/Why rationale. Existing artwork geometry is unchanged. The adoption applies to visual direction; the separately documented backend and operational gaps remain open.

## Paired installed workflow — 30 October 2026

The provenance above describes the original comparison and remains historical. Both requested repositories are now installed and verified on Halawany: Emil's existing 16-package Ubuntu collection was preserved, matching the pinned source; Windows Codex received the same collection. Dickwu's full package is installed in both user skill roots under the unique name `apple-hig-review`, while Emil retains `apple-design`. Only Dickwu's frontmatter name differs from upstream. Codex's actual Windows `skills/list` rescan reports all 17 enabled with no skill errors. The installation does not retroactively change which guidance created the earlier draft.

For every design slice, apply `$emil-design-eng` and `$apple-hig-review` together: define the learner task; audit hierarchy, type, semantic color, spacing, disclosure and accessibility; then apply component finish and purposeful motion using Emil's appropriate motion guidance. Use existing approved artwork and content. Native Apple conventions are translated only where appropriate for this React web portal. Record a Before/After/Why plan, actual responsive and accessibility evidence, and source versus fixture versus live limits. Shared tokens and component variants replace unrelated page-by-page styling.

See `docs/DESIGN_AUDIT_003_BOTH_SKILLS.md` for the first paired source/screenshot audit, exact source commits, next bounded implementation steps and remaining evidence gaps. The approved calm direction is retained; installation/audit does not itself adopt the wrapper on production routes, fix the Home video backdrop, enable backend services, or resolve the two separately denied source actions.
