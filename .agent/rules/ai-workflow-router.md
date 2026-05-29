# AI Workflow Router

Use workspace Skills instead of long ad-hoc prompts.

This rule replaces the Cursor `.mdc` router. In Google Antigravity, workspace rules belong in `.agent/rules/`; workspace skills belong in `.agent/skills/`.


Use project skills instead of long ad-hoc prompts.

## Skill routing

Use `.agent/skills/grill-with-docs/SKILL.md` when:
- user wants to stress-test a plan, architecture, domain model, product concept, or implementation approach
- user asks for critique, "grill me", "challenge this", "is this design good?", or wants sharper terminology
- task involves documenting domain language, bounded contexts, ADRs, or architectural trade-offs

Use `.agent/skills/handoff/SKILL.md` when:
- user asks to continue in another session
- user asks for a compact summary, handoff, context packet, next-agent brief, or restart-safe continuation doc
- conversation is long and future work needs preserved context

Use `.agent/skills/caveman/SKILL.md` when:
- user says "caveman", "less tokens", "be brief", "kurz", "token sparen", or "no fluff"
- user wants compressed technical communication

## Token discipline

Do not load skill files unless relevant.
Do not paste whole docs into chat.
Prefer referencing paths over duplicating content.
Keep default responses concise.
For long tasks, first inspect relevant project files, then answer.
