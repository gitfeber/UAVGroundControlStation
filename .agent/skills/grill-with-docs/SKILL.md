---
name: grill-with-docs
description: Stress-test plans against the existing domain model, sharpen terminology, and update CONTEXT.md or ADRs only when decisions crystallize.
---

# Grill With Docs

Interview the user relentlessly about the current plan until the design is precise.

Ask one question at a time.
For each question, provide your recommended answer.
If a question can be answered by exploring the codebase, inspect the codebase instead of asking.

## Domain awareness

During codebase exploration, look for:

- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/adr/`
- context-specific `CONTEXT.md` files

Single-context repo:

```txt
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```
Multi-context repo:

```txt
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

Create files lazily. Only create CONTEXT.md after the first domain term is resolved. Only create docs/adr/ after the first ADR-worthy decision appears.

## During session

Challenge conflicts against glossary:
- If user wording conflicts with CONTEXT.md, call it out immediately.

Sharpen fuzzy language:
- Propose one canonical term.
- List ambiguous alternatives.

Discuss concrete scenarios:
- Invent edge cases that test domain boundaries.

Cross-reference code:
- If user says how something works, check whether code agrees.
- Surface contradictions immediately.

Update CONTEXT.md inline:
- When a term is resolved, update CONTEXT.md immediately.
- Use CONTEXT-FORMAT.md.
- CONTEXT.md is a glossary only, not implementation spec.

Offer ADRs sparingly.
Only create ADR when all are true:
- Hard to reverse.
- Surprising without context.
- Result of real trade-off.

Use ADR-FORMAT.md.
