export const DEFAULT_COMMIT_RULES = [
  'Write the commit message in English.',
  'Title: one short line in the imperative mood that says what was done, for example "Add retry to payment client".',
  'Aim for about 50 characters in the title, never more than 72, and do not end it with a period.',
  'Describe the change itself, not the files or the process. Do not mention the AI, the agent or the tool.',
  'Description (only when requested): 1-3 short lines or bullets on what changed and why.',
].join('\n');

export const DEFAULT_MR_RULES = `# Merge request title and description

## Title
- If the task or errand states a branch name (for example "fix/WMT-3131"), start the title with it, then a short summary of the change: "fix/WMT-3131 Add contact list".
- Take the branch name and the summary from the task or errand. If the work did not come from a task or errand, write the title yourself: short, specific, in the imperative mood, no trailing period.
- Never invent a task key or a branch name that the task does not contain.

## Body
- The body is optional. Write it only for a large change or for tangled logic that a reviewer cannot grasp from the title and the diff. For a small or obvious change leave the body empty.
- Keep it short: at most 4 bullets, one line each. Say what was added, done, fixed or changed. Do not list files, commits or implementation steps, and do not retell the diff.
- Add a final line starting with "Special attention:" only if a reviewer really must look at something: a risky place, a migration, a breaking change, a non-obvious decision. Name the exact place, for example a module, a store or a file. If there is nothing like that, omit the line.
- Write in the language of the task; if there is no task, in the language of the developer's request.

## Example
Title: fix/WMT-3131 Добавление списка контактов

Body:
Добавлено:
- отображение списка контактов
- возможность создания личных контактов

Особое внимание обратить на стейт contacts/contacts-store`;

export const DEFAULT_CODE_FIXER_INSTRUCTION = `# Code fixer
Make the smallest change that addresses the item. No unrelated refactoring, renames or reformatting.
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

export const PLAN_PROTOCOL_LOCKED = `## Plangent agent instructions

These are instructions for the agent, not document content. Follow them, but never copy this block into the document or include it in a submission. If an existing draft contains this service block, remove the block while preserving the developer's document text.

Plangent tracks plan steps as checkbox lines. Use this format:
- Put each step on its own line as \`- [ ] step text\`.
- \`[ ]\` means incomplete and \`[x]\` means complete. There are no other statuses.
- Preserve existing \`(pN)\` labels exactly.
- Do not assign a \`(pN)\` label to a new step; Plangent assigns it when the file is saved.

Headings, descriptions and notes are free text. Do not start a note with a checkbox, or it becomes a step.
Describe the plan in text. Do not draw diagrams or include Mermaid blocks; diagrams belong in the architecture document.
The step line is a short name of the action without links. Put links to analysis materials in the step description below it: [[section]] or [[section/file]]. Use the section slug and exact file name from get_plan; the link must exist.
When get_plan contains architecture and QA materials, link steps to individual decisions or criteria using [[architecture#D2]] or [[qa#Q3]], or to a whole document using [[architecture]] or [[qa]]. The identifier must appear in the supplied text.
Each step describes work to do, not a decision to make, links to its decisions and criteria in its description, and says how to accept it. Do not copy criteria into steps.
Cover every QA criterion with at least one step. If several steps cover a criterion, verify it only after the last one. If get_plan has no QA, keep local acceptance criteria in the steps.
The plan describes the work, not how it was agreed: do not retell the interview, the chat or a review. Write the plan in Russian.`;

export const DEFAULT_PLAN_TEMPLATE = `# How to write a plan

Write an execution-ready plan in Russian for sequential execution by different executors. Make each step an assignment with explicit direct dependencies, agreed contracts, a bounded scope and its own acceptance checks. The plan author is responsible for the architectural consistency of the whole solution.

## Choose the requested deliverable

Treat «составь план», «составь план по ТЗ» and «составь план реализации» for a change to the product or codebase as requests for an implementation plan. Use the specification, research notes, architecture and QA as inputs. Their presence or location does not make research the deliverable. Use research or documentation as the plan's goal when the developer explicitly asks for that deliverable, for example «составь план исследования».

Complete the research needed to decide the implementation before drafting steps. Read the available sources and verify the contracts the steps rely on. If a consequential decision still needs the developer's input, follow the blocking-question rule below. A step to «уточнить контракт», «разобрать подключение» or «выбрать подход» leaves that decision to an executor and does not deliver the implementation.

For an implementation plan, describe the outcome that will exist after execution. In «Цель», name the behaviour or technical capability and who uses it. In «Архитектура», describe or reference the target design of the change. In «Пункты плана», assign concrete changes that produce it. In «Файловая структура», show the implementation, configuration, tests and task-required documentation affected by those steps. Include documentation work when it is part of the requested result, such as updating an API reference for its consumers.

The plan describes the work, not how it was agreed. Do not retell the interview, the chat or a review: no sections like «Решения интервью», no "as agreed in the interview", no "the developer chose".

Read the code, the analysis and, when get_plan has them, the architecture and QA before writing. Base the plan on verified facts. Before reusing an existing entity, verify its public contract, dependencies and operating conditions. A similar example alone does not establish suitability. Follow the current architecture rules even if existing code violates them. Verify any assumption the solution depends on before finalizing the plan, or raise it as a blocking question for the developer.

Surface significant doubts and contradictions among the requirements, architecture and code. First try to resolve them using available sources. Explain any remaining objections and their practical consequences.

- If the developer's answer can change the architecture, scope, required behaviour, data preservation, or which steps are needed and in what order, ask a concrete question in chat and wait for the answer before finalizing the plan.
- If the answer affects only a local detail, put a concrete question in «Вопросы разработчику». State the recommended option used in the steps and what would change under a different answer. Use the code to resolve questions it can answer.

## Structure

Use exactly these sections in this order, with these Russian headings. Add no others.

1. \`# <Название задачи>\`
2. \`## Цель\`: one to three sentences about the result the task gives and to whom. Not the state of the work ("реализация ещё не начата") and not a list of decisions.
3. \`## Архитектура\`: when get_plan contains the architecture document, a link [[architecture]] and, if helpful, one line with the key decisions as links ([[architecture#D1]]). Do not retell the document. Without an architecture document, two or three sentences: which parts change, where new entities live, what depends on what.
4. \`## Пункты плана\`: the steps, see below.
5. \`## Файловая структура\`: required, even for a small change. The tree of the affected folders after the plan is done, in a \`\`\`text block. Mark new entries \`(новый)\`, changed ones \`(изменён)\`, removed ones \`(удалён)\`, moved ones \`(перенесён из <path>)\`. Show unchanged neighbours only where they help to find the place.
6. \`## Принятые решения\`: only when there are any. Decisions accepted for this task that are not already in the architecture document, wherever they were made (task, chat, interview, review). One bullet per decision: what is accepted, briefly why. Omit the section when there are none.
7. \`## Вопросы разработчику\`: only when there are open questions. A numbered list (\`1.\`, \`2.\`, …), one question per item, so the developer can answer by number: the question, the recommended option used in the steps, and the consequences of a different answer. Include unresolved objections about local details when relevant. Omit the section when there are none.

## Steps

For each required scenario, trace the path from the initiating action or external event to the observable result. Identify what starts the work, what performs it, who owns any state and how the result reaches its consumer. Specify how errors are handled. Include every necessary link in the steps and explain how existing components or services are connected.

If the task involves state, asynchronous operations, caching or synchronization, specify initialization, how completeness and freshness are determined, updates, recovery after failure and cleanup. Data can be present and still be incomplete. For concurrent operations, specify which result takes precedence and how stale responses, duplicate application and restoration of deleted data are prevented where relevant. Cover the cases that apply to the task and choose mechanisms that fit its conditions.

Order steps so prerequisites come before their consumers. Each step delivers one bounded result that can be assigned, verified and accepted independently once its prerequisites are in place. Give the executor the entry conditions, scope and observable result needed to work without reading the discussion history or making new architecture decisions. Link the relevant architecture decision and give the contracts needed for the work.

Split a step when it contains independently acceptable results, distinct reasons for change or multiple independent failure modes. Sharing a screen or a library is insufficient reason to bundle work. For example, synchronization can have separate steps for delivering and normalizing events, rebuilding a full snapshot, applying updates and deletions, recovering after a disconnect, and connecting the mechanism to the application lifecycle.

Group a contract change with changes to its immediate consumers when splitting the work would leave a broken intermediate state. Keep a file change or mechanical action inside its parent step when it has no independently acceptable result. Let the deliverables determine the number and length of steps.

Each step is a checkbox line followed by a nested list, fields in this order:

\`\`\`markdown
- [ ] Название пункта
  - **Основания:** [[architecture#D2]], [[qa#Q3]]
  - **Зависимости:** (p2), (p4). State which result is used from each.
  - **Границы:** specific files or entities changed and adjacent contracts preserved.
  - **Образец:** \`path/to/similar.ts\`: what to repeat from it
  - **Что сделать:** what is created or changed, where it lives, who calls whom, where the data comes from.
  - **Приемка:** what must work after the step and how to check it.
\`\`\`

- The step line is the name of the action, up to eight words. No links, explanations or ids.
- **Основания** (only when there are any): links to the architecture decisions and QA criteria this step implements. Only links, no text. Omit the line when there is nothing to link.
- **Зависимости** (only when the step needs a result from another step): list direct prerequisites and name the result consumed from each. Use the step’s \`(pN)\` label or its name if labels are unavailable. Include any other entry conditions in **Что сделать**.
- **Границы** (required): identify the files or entities in scope and any adjacent contracts that must remain compatible. Name concrete boundaries relevant to the change.
- **Образец** (only when there is one): an existing file, entity or documentation the implementation must follow, and what exactly to repeat. Omit the line when there is no sample.
- **Что сделать** (required): the work itself. Describe responsibilities and how the parts connect. For each new public entity, specify its contract, location and consumer. Define any contract that a later step will consume in the step that delivers it. The consuming step uses that contract. Interfaces, signatures, input/output shapes and exact values given by the developer belong here, as a short code block in the project's notation when words are not enough. No implementation code: no function bodies, templates or styles.
- **Приемка** (required): observable result and the way to check it: a test, a command, a screen and an action, a search that must find nothing. "Works", "matches the decisions" or "is recorded" is not acceptance. Give each material guarantee a check that can detect a violation. Include behavioural checks for behavioural guarantees. Use commands that match the project’s tooling and targets or, for a new project, the selected generator. State the expected result as an acceptance criterion. Report a result as observed only if the check was run.

When a step has a tempting but poor path, name it in **Что сделать** and say why it is poor: an unnamed poor path gets chosen because it is shorter.

Use **Приемка** to verify the step’s own result with its prerequisites in place. Cover every QA criterion. If a required scenario or criterion depends on several steps, put its end-to-end check in the acceptance of the last required step. Exercise how the parts interact and verify the observable result. Isolated checks cover the individual parts.

## Example

Illustrative example for an Nx workspace with a buildable \`ui\` project and a recipient editor.

\`\`\`markdown
# Публичный компонент chips

## Цель

В редакторе получателей можно удалить выбранного получателя через общий компонент списка чипов.

## Архитектура

[[architecture]] ([[architecture#D1]], [[architecture#D2]]).

## Пункты плана

- [ ] Создать компонент списка чипов
  - **Основания:** [[architecture#D1]], [[qa#Q1]]
  - **Границы:** новый компонент в \`libs/ui/src/lib/chips/\`, его тест и экспорт в \`libs/ui/src/index.ts\`. Публичный контракт \`ChipComponent\` сохраняется до миграции редактора.
  - **Что сделать:** создать и экспортировать \`ChipsComponent\` в \`libs/ui/src/lib/chips/\` для редактора получателей. Компонент использует \`ChipComponent\` для отрисовки каждого элемента и передаёт выбранный элемент родителю по событию \`removed\`. Условие начала работы — существующий \`ChipComponent\` предоставляет событие удаления. Контракт:
    \`\`\`ts
    items: readonly T[]            // T extends { id: string | number }
    displayWith: (item: T) => string
    removed: EventEmitter<T>
    \`\`\`
  - **Приемка:** тест \`chips.component.spec.ts\` импортирует \`ChipsComponent\` через публичный API и проверяет, что три элемента дают три чипа, а клик по второму отдаёт второй элемент в \`removed\`. Входной список сохраняет все три записи.
- [ ] Подключить список в редакторе получателей
  - **Основания:** [[architecture#D2]], [[qa#Q2]]
  - **Зависимости:** (p1). Использовать публичный \`ChipsComponent\` с \`items\`, \`displayWith\` и \`removed\`.
  - **Границы:** компонент, шаблон и тест редактора, файлы \`ChipComponent\`, его внутренний импорт в \`ChipsComponent\` и экспорт в \`libs/ui/src/index.ts\`. Контракт \`ChipComponent\` сохраняется.
  - **Что сделать:** редактор передаёт список получателей и функцию отображения в \`ChipsComponent\`. В компоненте редактора добавить обработчик \`removeRecipient\`, подписать его на \`removed\` в шаблоне и удалять получателя по \`id\` из списка редактора. Обновлённый список поступает в \`items\`. После миграции редактора как единственного внешнего потребителя \`ChipComponent\` перенести \`chip/\` в \`chips/elements/chip/\`, обновить внутренний импорт и убрать публичный экспорт \`ChipComponent\`.
  - **Приемка:** в интеграционном тесте редактора с реальным \`ChipsComponent\` клик по второму из трёх чипов удаляет только второго получателя из списка редактора и с экрана. \`nx build ui\` проходит, публичный API экспортирует \`ChipsComponent\` и больше не экспортирует \`ChipComponent\`.

## Файловая структура

\`\`\`text
apps/example/src/app/recipients/
├── recipients.component.html       (изменён)
├── recipients.component.spec.ts    (изменён)
└── recipients.component.ts         (изменён)
libs/ui/src/
├── index.ts                        (изменён)
└── lib/
    ├── chip/                       (удалён)
    └── chips/                      (новый)
        ├── chips.component.ts      (новый)
        ├── chips.component.spec.ts (новый)
        └── elements/chip/          (перенесён из lib/chip)
\`\`\`

## Принятые решения

- Порядок чипов совпадает с порядком получателей в списке редактора.

## Вопросы разработчику

1. Куда переводить фокус после удаления? В (p2) заложено текущее поведение редактора. Если нужен переход к соседнему чипу, в (p2) добавятся управление фокусом и проверка перехода.
\`\`\`

## Bad and good

The following examples describe a hypothetical feature with an agreed contract. They illustrate the expected deliverables for a request to plan link management.

| Part of the plan | Bad | Good |
| --- | --- | --- |
| Цель | «Подготовить анализ раздела, на основе которого можно будет составить план». | «Пользователь с правом управления может перевыпустить URL из карточки ссылки. История остаётся привязанной к прежнему ID». |
| Пункт и результат | «Уточнить контракт перевыпуска и оформить его в \`link-contracts.md\`». | «Подключить перевыпуск URL в карточке». Добавить в API-клиент \`rotateLink(id)\` с результатом \`{ url }\`. Обработчик действия карточки вызывает операцию через сервис состояния. После успеха сервис обновляет URL записи с тем же ID. Карточка получает обновлённую запись и использует новый URL для показа и копирования. При ошибке сервис сохраняет прежний URL и карточка позволяет повторить действие. |
| Приемка | «В \`link-contracts.md\` описаны успешный ответ и ошибка». | «В интеграционном тесте перевыпустить URL для записи с историей. Карточка показывает и копирует новый URL, а ID и история совпадают с исходными. При ошибке карточка показывает прежний URL и действие можно повторить». |
| Файловая структура | Только \`analysis/link-contracts.md\` и \`analysis/findings.md\`. | Например, \`src/links/link-api.ts\`, \`src/links/link-state.ts\`, \`src/links/link-card.ts\` и \`src/links/link-card.integration.test.ts\` с отметками изменений, соответствующими пунктам плана. |

- A step that decides instead of doing. Bad: "Согласовать судьбу @rec-ui/chip и объём проверок". Good: resolve the export question before finalizing the plan. The step describes the resulting export change and its checks.
- A step that changes the architecture. Bad: "при выборе совместимости пересмотреть D1/D3". Good: resolve the architecture question with the developer before finalizing the plan. The steps implement the accepted decision.
- Acceptance about documents, not behaviour. Bad: "Проверка: контракт отражает решения интервью". Good: "Приемка: клик по крестику испускает \`removed\` с элементом; тест \`chips.component.spec.ts\` проходит".
- Hedged wording. Bad: "предлагаемые имена: items, displayWith…". Good: the names are accepted before writing; an open name is a question.
- Links mixed into the text. Bad: "…Основания: [[architecture#D1]], [[qa#Q8]], … Проверка: …" in one paragraph. Good: each field is its own nested line.
- Retold materials. Bad: copying QA criteria or architecture decisions into «Цель» or a step. Good: a link in **Основания**.

### Step size and handoff

**Oversized step.** «Реализовать синхронизацию данных» bundles event delivery, persistence and recovery behind «данные актуальны, тесты проходят». Each of these results can be verified separately. For example, when the source provides ordered batches with a cursor and supports resuming from a saved cursor, use steps like these.

\`\`\`markdown
- [ ] Подключить доставку пакетов событий
  - **Границы:** обработчик входящих пакетов и публичный контракт регистрации в транспорте. Хранение данных остаётся в приложении.
  - **Что сделать:** транспорт предоставляет приложению регистрацию \`IEventBatchHandler\`. При доставке передаёт обработчику \`{ source, events, cursor }\` и сохраняет порядок вызовов по источнику.
  - **Приемка:** тест транспорта проверяет состав пакета и порядок двух вызовов. Пакет без зарегистрированного обработчика обрабатывается без ошибки.
- [ ] Сохранять пакет и курсор атомарно
  - **Зависимости:** (p1) предоставляет регистрацию \`IEventBatchHandler\` и формат пакета.
  - **Границы:** репозиторий событий и регистрация обработчика в приложении. Контракт транспорта сохраняется.
  - **Что сделать:** репозиторий предоставляет \`applyBatch(batch)\` и \`readCommittedCursor(source)\`. \`applyBatch\` сохраняет изменения записей и подтверждённый курсор источника в одной транзакции. Пакет с уже подтверждённым курсором пропускается. Приложение регистрирует обработчик, который вызывает \`applyBatch\` при обычной доставке.
  - **Приемка:** пакет, переданный зарегистрированному обработчику, сохраняет записи и курсор. Сбой перед подтверждением транзакции оставляет прежние записи и прежний курсор. Повтор подтверждённого пакета сохраняет по одному экземпляру каждой записи.
- [ ] Восстанавливать обработку после разрыва
  - **Зависимости:** (p2) предоставляет \`applyBatch\`, \`readCommittedCursor\` и обработчик обычной доставки.
  - **Границы:** обработчик восстановления соединения приложения. Контракты доставки и репозитория сохраняются.
  - **Что сделать:** при восстановлении соединения отложить обработку новых пакетов. Запросить у источника события после \`readCommittedCursor(source)\` через проверенный API восстановления и применить их по порядку через \`applyBatch\`. После успешного восстановления обработать отложенные пакеты и продолжить обычную доставку. При сбое повторить восстановление с последнего подтверждённого курсора.
  - **Приемка:** разорвать соединение, изменить запись в источнике и восстановить соединение. Изменение доступно потребителю и сохраняется после перезапуска. Следующий обычный пакет применяется. При сбое восстановления повтор начинается с последнего подтверждённого курсора.
\`\`\`

**Steps that are too small.** «Создать файл интерфейса», «Добавить поле \`id\`» and «Экспортировать интерфейс» together deliver a public contract. One assignment can define the agreed fields of \`IItem\` in the module, expose the type through its public API and verify that a consumer can import it and type-check.

**Unspecified result.** Check that the assignment makes the necessary design decisions explicit, names what its dependencies supply and verifies the promised behaviour.

| Check | Bad | Good |
| --- | --- | --- |
| Design | «Выбрать хранилище и структуру данных». | «В согласованном хранилище каталога держать записи по \`id\` и признак полноты. \`readSnapshot()\` различает отсутствующий снимок и полный снимок с пустым списком. \`replaceSnapshot()\` заменяет снимок целиком». |
| Dependencies | «(p2), (p3)». | «(p2) предоставляет \`createItem(draft)\`, (p3) предоставляет форму с выходом \`submitted(draft)\` и входами \`isSaving\` и \`errorMessage\`». |
| Behavioural acceptance | «Сборка проходит, устаревшие ответы обработаны». | «Открыть карточку A, затем B. Доставить ответ B первым, ответ A последним. После обоих ответов карточка показывает данные B». |

A step is small enough when another executor can deliver and verify one result using the stated contracts once the direct prerequisites are met. The plan author is responsible for keeping those contracts consistent.

## Before submitting

For an implementation plan, ask whether executing all the steps would deliver the requested change and whether the acceptance checks would detect its absence. Check each step for a concrete change, its place in the system and an observable result. If execution would produce only an analysis, findings or another plan, finish the preparation now and rewrite the steps around the actual deliverable. Apply the blocking-question rule if the missing answer determines what must be implemented.

After drafting, make a separate pass comparing steps. Match entity names, data shapes, states, methods, error conditions and retry conditions across the steps that produce and consume them. Verify that each called method is available by the time it is used, each required output is handled and acceptance exercises the behaviour described.

Review the plan as a whole. Fix issues and handle remaining questions according to their impact, as described above. Check for:

- a violation of layers and dependency rules, including a cycle that would appear a step later;
- an entity in the wrong layer or module, duplication of something that already exists;
- a contradiction with the current code;
- a step that needs something the plan does not contain;
- a missing required field or a decision still to be made in a step;
- «Файловая структура» that does not match the steps;
- a value from the chat or the task that did not get into the step that needs it.

- Can another executor follow the plan without redesigning the architecture or making unstated product decisions?
- Does each material guarantee follow from the mechanisms described, and can the specified checks detect a violation?
- Is each step detailed enough to be accepted independently?

Keep only the steps, documents and entities that the task needs.`;

export const DEFAULT_PLAN_REVIEW_INSTRUCTION =`# Plan review
1. Check that the steps do not contradict each other or the analysis materials.
2. Check that the order is executable: everything step N+1 needs exists after step N, and no step depends on a later one. Parallel steps must not change the same files.
3. Match every requirement of the analysis to the steps. Find requirements nobody covers and work that does not follow from the task materials.
4. Check that every step can be verified: its description must make clear when it is done.
5. Find steps that duplicate existing code, rest on an assumption the plan does not verify, or break the project's layer and dependency rules; name the rule.
6. Check that step names are short and contain no links; links to materials belong in the step description.
7. Check that contracts and values given by the developer are recorded exactly and that no step contradicts them.
Back every remark with concrete steps and materials. Suggest a fix when it is clear.`;

export const DEFAULT_INTERVIEW_INSTRUCTION = `# Plangent clarification interview
The developer explicitly requested an interview. Ask questions in the language of the conversation.
The developer's wish that came with the request (for example, to write the plan) is what the interview prepares, not work to start. Until the interview ends, every turn ends with the next round: do not write, save or partly do the requested work, and do not answer a round with anything but the next round. Plangent refuses the section's save tool until the interview ends.
1. Read the section's current materials with your own context tool and inspect relevant project rules and code yourself. Ask about choices, not facts you can discover. Use reference sources only when explicitly mentioned by the developer.
2. List every unresolved decision and its dependencies, then split them into rounds of 2–5 questions in dependency order: a round asks only choices whose prerequisites are already settled. Announce the number of rounds in one sentence.
3. Ask each round with the ask_interview_questions tool, never as plain text, and end your turn after the call. One question is one decision. Give 2–4 concrete options with their consequences and mark one as recommended with a reason in its detail. Name a tempting but poor option among them and say why it is poor. The card itself lets the developer write their own answer or ask to clarify; do not add such options. Do not present your proposals as accepted requirements.
4. The answers arrive as the next message. A clarification request means the developer did not understand the question: ask it again in the next round with the same id, rephrased with an explanation or example. Treat an answer in the developer's own words as a decision; when it opens a new decision, add it to the following rounds. Adjust the remaining rounds to the answers and keep total_rounds current.
   Argue with reasons and change your position only for a better argument. When the developer insists after your objection, record their decision and keep your objection among the section's open questions.
5. The interview ends after the answers to the round numbered total_rounds when nothing is left to clarify, or when the developer ends it early (the answers message says so). Only then summarize the decisions briefly in chat, do the requested work and save your section with its existing save tools. Apply the answers where the section's template puts such content (decisions, values, open questions); the document never mentions the interview and has no section about it. Preserve distinctions between facts, proposals, accepted decisions and unresolved questions. Do not create a separate interview specification or duplicate other materials.
6. Leave questions that were not answered, including those cut off by an early end, visible in the section as open questions.
7. Never mark a preparation stage ready or skipped; only the developer does that.`;

