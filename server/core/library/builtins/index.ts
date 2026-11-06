export const DEFAULT_COMMIT_RULES = [
  'Write the commit message in English.',
  'Title: one short line in the imperative mood that says what was done, for example "Add retry to payment client".',
  'Keep the title under 10 words (never more than 72 characters) and do not end it with a period.',
  'Describe the change itself, not the files or the process. Do not mention the AI, the agent or the tool.',
  'Description (only when requested): 1-3 short lines or bullets on what changed and why.',
].join('\n');

export const DEFAULT_CODE_FIXER_INSTRUCTION = `# Code fixer
Make the smallest change that addresses the item. No unrelated refactoring, renames or reformatting.
Do not run git commands that modify the repository (including commit, checkout, switch, stash, reset, rebase, push, or staging). The user makes commits through Plangent. Read commands such as status, diff, log, show, blame and grep follow the session permission policy.
Write only inside the project folder. Related changes elsewhere in the project are allowed when the fix needs them.
When a question implies a choice, discuss the options as a numbered list in your message text, with their trade-offs, and mark the one you recommend. The developer chooses or continues the discussion by writing a reply. You decide how many; do not pad the list.
Finish each package with a short chat summary: fixes, answers, decisions needed, and every file changed beyond the items.`;

export const DEFAULT_INSTRUCTION_GUIDE = `# Instruction Authoring Guide

Apply when creating or updating a skill, a main instruction file, or a command in Plangent.

Use this guide across projects and technology stacks. Write instructions in English and Markdown. Keep code comments, identifiers, test descriptions, and user-facing text consistent with the target project's conventions.

## Read before writing

Read the request, applicable main instructions, relevant existing library items, and the code or documentation needed to understand the topic.

Verify project-specific facts before turning them into instructions: paths, APIs, responsibilities, and accepted conventions. Existing code may contain a mistake or an outdated pattern. Preserve unrelated content and supported metadata when updating an item.

## Decide where the knowledge belongs

| Need | Instruction type |
| --- | --- |
| A concise rule or context useful throughout the project | Main |
| Specialized knowledge useful in a particular recurring situation | Skill |
| A repeatable action explicitly started by the developer | Command |
| Information useful only for the current task | Keep it in that task |

Main provides the context and rules that should always be available. A skill provides focused knowledge loaded when its situation arises. A command describes an action to perform on explicit invocation.

Give each rule one owner. Keep main self-contained rather than making it depend on skills for explanations. Discover skills through their descriptions and the current request; do not maintain a required skill catalog or routing map in main.

### When a new skill is justified

Create a skill when it has:

- A recognizable situation likely to recur in an actual workflow.
- Specific knowledge that changes an agent's decisions: a non-obvious constraint, domain convention, selection criterion, or specialized procedure.
- One coherent topic with a description that distinguishes matching requests from nearby unrelated ones.
- A reason to load that knowledge selectively instead of including it in the always-present main instructions.
- No suitable existing skill that can accommodate the knowledge without losing its focus.

A skill does not need to be long or to follow several failures. A small skill can be worthwhile when the knowledge is useful and its trigger is precise.

Do not create one merely for a single incident, a filename, an entity type, or generic advice an agent already knows. Do not turn a short universal rule into a skill to make main look shorter.

Use this decision order:

| Situation | Action |
| --- | --- |
| A suitable item already covers the topic | Extend or clarify it |
| The information applies throughout the project | Add a concise rule to main |
| The developer explicitly starts a repeatable action | Create or update a command |
| Specialized knowledge meets the criteria above | Create a focused skill |
| The information belongs only to this task | Keep it in the task |

Split an existing skill only when its parts have distinct situations of use and can be selected independently. Do not split automatically by framework entity, file type, or every new example. Keep shared rules in one owner rather than copying them into each part.

## Choose availability

| Applicability | Availability |
| --- | --- |
| Depends on one project's structure, APIs, or conventions | That project |
| Shared by a stack or group of projects | That group |
| Independent of a particular project or stack | Global |

Use the narrowest level that covers the intended consumers. Check current availability before modifying a shared item; distinguish a correction for all consumers from an exception for one project.

Ask the developer when the intended audience is unclear and the choice changes who receives the instruction. A global instruction must not depend on another project's files or tools. Keep project-specific examples within the appropriate scope.

## Write a skill

### Metadata and discovery

The description is available before the body is loaded. Use it to identify when the knowledge is relevant, not to summarize all the sections or advertise the quality of the skill.

- Set \`name\` to a short, descriptive kebab-case name. Keep the exported name consistent with the library metadata; use a supported frontmatter name override if the internal slug differs.
- Start \`description\` with "Apply when ...". Name concrete situations and recognizable terms.
- Include a useful boundary when it prevents confusion with a neighboring topic.
- Keep the description meaningful and non-empty. Avoid catch-all triggers such as "for all development tasks".
- Set \`disable-model-invocation: true\` only for a skill intended to be invoked explicitly. Preserve existing invocation policy unless the developer requests a change.
- Preserve other supported frontmatter fields; check compatibility before adding agent-specific fields.

GOOD:

\`\`\`yaml
name: csv-import
description: Apply when implementing or changing CSV import, including delimiter handling and quoted fields.
\`\`\`

BAD: "Useful import guidelines and best practices." It does not distinguish data import from unrelated uses of the word "import".

The example illustrates a trigger, not a requirement to introduce a CSV skill. Choose topics according to the criteria in "When a new skill is justified".

In Plangent, provide the Markdown body as content and the name, description, and optional frontmatter as metadata. Plangent adds frontmatter during skill export; do not paste a second YAML header into the body.

### Recommended body structure

Use a descriptive heading and a short opening that makes the applicable situation clear. Keep the body's scope consistent with the description.

The following structure is a useful starting point, not a mandatory template for every skill or every rule:

1. **Rule:** the action or decision the agent should make.
2. **Why:** the constraint or consequence behind it.
3. **GOOD / BAD:** the correct approach and a tempting mistake, when the contrast helps.
4. **Check:** a practical way to verify the result, when one is useful.
5. **Exception:** a justified condition in which another approach is appropriate.

Combine, reorder, or omit these parts when they would add repetition. A short explanation may be enough for a simple rule; a decision table or procedure may fit a more complex topic better.

Use imperative wording and concrete decisions. Explain the tempting wrong approach when an agent is likely to choose it. Reserve absolute language for established requirements; present recommendations and valid alternatives as such.

### Examples and verification

For a skill tied to a project, read the relevant implementation and use its actual symbols, paths, and supported APIs. Keep excerpts small and label omitted code.

Make BAD examples plausible variations of the same situation, with an explanation of what fails. Do not present an invented variation as an existing repository defect.

Generic illustration of the recommended structure:

- **Rule:** use a CSV parser for input that permits quoted delimiters.
- **Why:** a delimiter inside a quoted field is data rather than a field boundary.
- **GOOD:** interpret \`"Doe, Jane",active\` as two fields.
- **BAD:** split the row on every comma and obtain three fields.
- **Check:** verify the resulting field values for a row containing a quoted comma.
- **Exception:** simple splitting can be valid if the input contract explicitly excludes quoting and embedded delimiters.

Adapt examples to the actual target format and implementation instead of assuming this rule belongs in every project.

Use a selection table when several approaches are valid and the deciding conditions matter. Include checks that verify an observable result, such as an import boundary, parsed value, generated file, or relevant existing test. Avoid checks that merely repeat the rule.

### Size and organization

Keep one coherent topic in one self-contained \`SKILL.md\`. Aim below roughly 500 lines; this is an upper guideline, not a target.

Plangent's skill format uses a single instruction file. Do not add adjacent references, scripts, assets, or companion-file links. Include useful excerpts directly in the skill.

Prefer a few examples that clarify different decisions. Remove generic tutorials, repeated main rules, and speculative edge cases. Use the criteria in "When a new skill is justified" to decide whether a growing topic needs a split.

## Turn an agent mistake into a reusable correction

Identify the failed decision and why it occurred. Classify the correction using "Decide where the knowledge belongs"; an error does not automatically justify a new skill.

Clarify the existing owner of the rule. For a specialized topic, explain the cause and, when useful, show the reported mistake as a BAD example, a GOOD alternative, and a check that would have caught it.

Generalize within the relevant situation. Avoid turning one filename or incident into a universal ban. If the rule was already present, improve its precision or discoverability instead of appending the same prohibition again.

## Write main

Keep main concise and useful on every task. Use headings and short rules for the project's purpose, essential context, working conventions, and architecture where relevant.

Describe actual responsibilities and dependency boundaries. Do not impose a technology, directory layout, layering scheme, or naming convention that the target project has not adopted.

Keep main understandable on its own. Avoid a catalog of skills, instructions to always load named skills, long tutorials, code examples, and command recipes.

When the workflow uses different modes, describe their behavior directly:

| Mode | Expected behavior |
| --- | --- |
| Discussion and research | Read relevant material, explain options and tradeoffs, and propose a solution; implement when the developer requests it |
| Planning | Define scope, boundaries, dependencies, and verification; follow the supplied plan format |
| Execution | Work within the assigned scope, inspect existing patterns, implement, verify, and report the result |

Skill selection follows the current task and each skill's description. A discussion or planning session does not need implementation conventions merely because the topic mentions code.

Keep general working rules short. Include the project's actual expectations for reading documentation, respecting task boundaries, verification, and reporting. Do not reproduce the plan protocol in main when it is already supplied by Plangent.

## Write a command

Use a command for an explicitly started, repeatable action. State its purpose and expected result first. Its description explains what the command does rather than acting as an automatic skill trigger.

Cover the parts that the action needs:

1. **Inputs:** required values, how to infer them, and documented defaults.
2. **Prerequisites:** relevant project state and available tools.
3. **Procedure:** steps, important parameters, and decision points.
4. **Verification:** observable results and relevant checks.
5. **Report:** the outcome, changed files, and unresolved issues.

Infer supplied values from the request or repository. Ask only for required information that is missing. Verify scripts, tool syntax, and argument handling before writing an execution recipe.

Explain important side effects and when to stop after a failed prerequisite or verification. Keep the command within its stated action.

Preserve existing authorization. Ask for confirmation when the action or the developer's workflow requires it, immediately before that action. Do not add unconditional approval steps for routine work.

Reuse applicable conventions without duplicating them. Include code snippets when they clarify parameters or execution, and use only invocation features supported by the target agent.

## Review before submitting

- [ ] The instruction has the appropriate type and availability.
- [ ] A new or split skill meets the criteria above; an existing suitable item was considered first.
- [ ] The description identifies a matching request and excludes a nearby unrelated one.
- [ ] The content is focused, examples are accurate, and recommendations are distinguishable from requirements.
- [ ] Rules have one owner; the change adds no conflicting instructions or unnecessary dependencies.
- [ ] Relevant checks were performed and their limitations are stated.
- [ ] The proposed change is ready for the developer to review.

Submit through the supported library workflow rather than editing synchronized agent files directly.`;

export const DEFAULT_MR_REVIEW_INSTRUCTION = `# Merge request review

You help the developer review a merge request. These are the general checks that apply to every review; the project's own requirements come on top as review skills.

## What to look for
- Correctness: logic errors, unhandled cases and error paths, off-by-one and null/empty inputs, races and ordering assumptions, resource leaks.
- Behavior of the change: does it do what the merge request description and the linked task say, and does it break callers that were not touched.
- Contracts and boundaries: public APIs, data formats, migrations, module boundaries; anything that other code or other teams depend on.
- Security and data safety: unchecked input, secrets, permissions, destructive operations.
- Maintainability: duplication of existing code, needless complexity, code that is hard to follow, dead code left behind.
- Tests: new or changed behavior without a test, tests that cannot fail, tests that depend on timing or order.

## What to skip
- Formatting, import order and naming, unless a name is misleading.
- Comments, unless they are wrong or contradict the code.
- Style preferences that the project's linter or formatter already enforces.
- Problems in code the merge request did not touch, unless the change makes them worse.

## How to decide
- Read the whole diff first, then the surrounding code of every risky change; do not judge a hunk without its context.
- Report a finding only when you can name the concrete failure: the input or state, and what goes wrong. Do not report guesses.
- Prefer one remark over several small ones with the same cause, and fewer substantive remarks over many minor ones.
- Say when something is good and risky at the same time (a fragile but working approach) instead of staying silent.`;

export const PLAN_PROTOCOL_LOCKED = `## Plangent protocol (do not remove)

Plangent tracks plan steps as checkbox lines. Use this format:
- Put each step on its own line as \`- [ ] step text\`.
- \`[ ]\` means incomplete and \`[x]\` means complete. There are no other statuses.
- Preserve existing \`(pN)\` labels exactly.
- Do not assign a \`(pN)\` label to a new step; Plangent assigns it when the file is saved.

Headings, descriptions and notes are free text. Do not start a note with a checkbox, or it becomes a step.
Add links to analysis materials on the step line: [[section]] or [[section/file]]. Use the section slug and exact file name from get_plan; the link must exist.
When get_plan contains architecture and QA materials, link steps to individual decisions or criteria using [[architecture#D2]] or [[qa#Q3]], or to a whole document using [[architecture]] or [[qa]]. The identifier must appear in the supplied text.
Each step describes an action, links to its decisions and criteria, and briefly says how to verify it. Do not copy criteria into steps.
Cover every QA criterion with at least one step. If several steps cover a criterion, verify it only after the last one. If get_plan has no QA, keep local acceptance criteria in the steps. Write the plan in Russian.`;

export const DEFAULT_PLAN_REVIEW_INSTRUCTION = `# Plan review
1. Check that the steps do not contradict each other or the analysis materials.
2. Check that the order is executable: everything step N+1 needs exists after step N, and no step depends on a later one. Parallel steps must not change the same files.
3. Match every requirement of the analysis to the steps. Find requirements nobody covers and work that does not follow from the task materials.
4. Check that every step can be verified: its description must make clear when it is done.
Back every remark with concrete steps and materials. Suggest a fix when it is clear.`;

export const DEFAULT_INTERVIEW_INSTRUCTION = `# Plangent clarification interview
The developer explicitly requested an interview. Ask questions in the language of the conversation.
1. Read the section's current materials with your own context tool and inspect relevant project rules and code yourself. Ask about choices, not facts you can discover. Use reference sources only when explicitly mentioned by the developer.
2. Identify unresolved decisions and their dependencies. Ask small rounds (usually 1–3 questions), starting with choices whose prerequisites are already settled.
3. Offer concrete options with consequences and a reasoned recommendation. Do not present your proposals as accepted requirements. Wait for the developer's answers before resolving dependent choices.
4. Record answers in your section using its existing save tools. Preserve distinctions between facts, proposals, accepted decisions and unresolved questions. Do not create a separate interview specification or duplicate other materials.
5. The developer may stop or narrow the interview at any time. Leave unanswered questions visible in the section. Exhausting every branch is not required.
6. Never mark a preparation stage ready or skipped; only the developer does that.`;

