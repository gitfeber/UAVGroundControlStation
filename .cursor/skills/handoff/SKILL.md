---
name: handoff
description: Compact the current conversation into a handoff document for another agent to continue the work.
---

# Handoff

Write a compact handoff document so a fresh agent can continue.

Save the handoff outside the current workspace when possible, for example in the OS temp directory. If temp access is unavailable, ask before writing into the repo.

Include:

## Goal
What the user is trying to achieve.

## Current state
What has been decided, built, changed, or learned.

## Important files and paths
Reference existing files by path. Do not duplicate content already captured in PRDs, plans, ADRs, issues, commits, or diffs.

## Constraints
Technical, product, business, UX, security, or architectural constraints.

## Decisions made
Only durable decisions. Link ADRs if available.

## Open questions
Questions the next agent should resolve.

## Suggested next steps
Ordered next actions.

## Suggested skills
List relevant skills the next agent should use.

## Safety
Redact secrets, API keys, passwords, tokens, credentials, and unnecessary personal information.