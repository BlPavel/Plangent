import { readItemContent } from './library-manager';
import { libraryItemsFor, listLibraryItems } from './index';
import { getProject } from '../projects';

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

export function resolveInstructionGuide(projectId: string): string {
  const project = getProject(projectId);
  const guides = project
    ? libraryItemsFor(project, 'instruction-guide').filter(item => item.enabled)
    : listLibraryItems({ type: 'instruction-guide', projectId: '', enabledOnly: true })
      .map(item => ({ ...item, origin: 'global' as const }));
  // Prefer a project's own guide, then its group's guide, then the global guide.
  const guide = (['direct', 'group', 'global'] as const)
    .map(origin => guides.find(item => item.origin === origin)).find(Boolean);
  return guide ? readItemContent(guide) : DEFAULT_INSTRUCTION_GUIDE;
}
