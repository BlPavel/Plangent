import type { MaterialType } from './index';
import type { LibraryItemType } from '../../../models';

/** Texts and library types of a preparation section; kept free of imports from the library to avoid cycles. */
export interface MaterialKind {
  templateType: LibraryItemType; reviewInstructionType: LibraryItemType; reviewSkillType: LibraryItemType;
  idPrefix: 'D' | 'Q'; title: string; defaultTemplate: string; protocol: string;
  defaultReviewInstruction: string; reviewSkillAuthoring: string;
}

const COMMON_PROTOCOL = (id: 'D' | 'Q', noun: string) => `## Plangent agent instructions

These are instructions for the agent, not document content. Follow them, but never copy this block into the document or include it in a submission. If an existing draft contains this service block, remove the block while preserving the developer's document text.

The document is free-form Markdown. Read it with get_material and save its complete text only with submit_material, passing the version from get_material. If a developer edit causes a version conflict, read it again and reapply your changes without overwriting theirs.

- The developer's text and request take precedence over the template. The template is a suggestion for an empty document; do not restructure an existing draft to fit it. Sections can be combined, omitted, or changed.
- If asked only to format text, preserve its meaning, decisions, and wording.
- Mention contradictions and gaps in chat; do not silently fix them.
- A ${noun} may have a stable identifier: bold \`**${id}1**\` at the start of a line or heading, then \`**${id}2**\`, and so on. Never renumber or reuse existing identifiers; plan steps and review remarks refer to them.
- Link analysis materials using [[section]] or [[section/file]]; the section and file must exist.
- Only the developer marks a section ready. Do not mark it ready or treat stopping work as readiness.
- Write preparation documents in Russian.`;

export const ARCHITECTURE_TEMPLATE = `# How to write an architecture document

Write in Russian for developers who need to understand the design without reading the implementation. Describe the outcome, the current system, how the proposed system behaves, which parts own the work and the data, and which decisions shape the design. Use the level of detail needed to explain boundaries and public contracts. Leave private implementation, tests and the order of work to the implementation plan.

Keep the order below and scale the outline to the change. A narrow change may need one short scenario and a few lines on dependencies. Include sections and diagrams where they answer a question a reader needs answered.

## Цель

In one or two sentences, name who or what starts the operation, what capability the change adds, and what observable result it delivers. State a scope boundary here if it shapes the solution. Link to the analysis or requirements where available.

## Текущая ситуация

Describe the parts of the existing system that matter to the change. Identify available entry points, reusable behavior and public contracts, and the current gap the design must close. Verify facts against code and other sources available for the task. Link to the source of a constraint or contract when it affects a design decision. If a prototype informs the design, identify its branch or revision where known and distinguish its behavior from the current implementation and the target design.

## <Название сценария>

A scenario starts at an entry point of the system being described and ends with an outcome that a caller, user, downstream component or operator can observe. Frame it at the boundary of this change. The same capability can start at a button in a frontend document and at \`POST /links\` in a backend document. In a design that spans both, follow the full path once and expand a component's part of the flow when its contract or failure behavior needs detail.

| Scope | Example trigger | Example observable result |
| --- | --- | --- |
| Frontend | The user selects «Добавить ссылку» | The draft contains the link, or the user sees why it could not be added |
| Backend | A client sends \`POST /links\` | The API returns the URL after saving the link, or returns a documented error |
| Worker or scheduler | A message arrives or a scheduled run starts | The job records a result, publishes an event or leaves work eligible for another attempt, according to its delivery contract |
| Library or CLI | A caller invokes a public method or runs a command | The call returns a value, or the command produces output and an exit status |

Give each major end-to-end scenario a section at the same level as «Цель» and «Зависимости». Name it after the operation, for example «Создание ссылки», «Выбор существующей ссылки» or «Отправка приглашения». An independent operation with its own trigger or result merits a separate section. Keep validation errors, fallback paths and recovery steps with the operation they belong to. If several entry points lead to a shared flow, describe the shared part once and spell out what each entry point changes.

Describe what the reader needs to follow the flow.

1. **Entry point and preconditions.** Name the initiator, the input at the boundary and any prior state the operation depends on.
2. **Main path.** Show which parts act, what moves across each significant boundary, and where the result or side effect is produced. For asynchronous work, say when the caller gets an acknowledgement and what marks completion.
3. **Other material paths.** Explain what the caller observes and what happens to data when a condition changes the path or a step fails. Cover cancellation, retry, duplicate delivery, concurrency, partial success or an unknown outcome when the operation has those guarantees or risks.
4. **Outcome.** Identify the returned value, changed state, published event or other observable result. Include the actor that owns it.

For a technical change with the same public behavior, describe the affected operation where it helps explain the design. State the invariant and show where responsibility, data flow or a guarantee moves. When a change is purely structural and a flow adds no information, use the dependencies section.

## Зависимости

Describe the target parts and what each owns. Identify existing, changed and new parts where that distinction matters. Name the intended location of a new part where it helps explain ownership. Show dependencies and boundaries between the relevant applications, modules, services, data stores or external systems. Make clear who uses whose contract, who owns shared state, and how interactions cross process, runtime or deployment boundaries that affect the design.

### Контракты и состояние

Place a contract used by several scenarios here. A contract specific to one scenario can live under that scenario. For each significant boundary, identify the caller and owner, the operation or event, relevant inputs, outputs and failure behavior. Name actual public methods, endpoints, events, keys or fields when their exact identity matters to consumers. For persisted or shared state, name the owner and describe its lifecycle, scope and relevant consistency guarantees. Include field-level detail where it determines interoperability.

## Архитектурные решения

Record choices that have meaningful alternatives. Give each decision a stable identifier, such as **D1**. State what was chosen, the reason in this system and the consequence for the design. Include an alternative and its trade-off when that explains the choice. Record approved departures from existing boundaries with their rationale when applicable.

## Открытые вопросы

List unresolved questions that could change a scenario, contract, boundary or decision. For each, say what is unknown and what design choice depends on the answer. Include the owner or source of confirmation if known. Omit the section when there are no open questions.

## How to draw the diagrams

Place each diagram next to the section it explains and give it one question. A scenario diagram answers «Что происходит от запуска до результата?». A dependency diagram answers «Кто от кого зависит и через какую границу?».

### Choose the diagram by the question

| What the reader must follow | Mermaid diagram |
| --- | --- |
| Conditional paths, fallback and terminal outcomes | \`flowchart TD\` |
| Order of calls, responses or callbacks, and the timing of acknowledgements or side effects | \`sequenceDiagram\` |
| Stable dependencies, contracts and component boundaries | \`flowchart TB\` or \`flowchart LR\` |

Use the simplest diagram that carries the explanation. When a diagram becomes hard to follow, split it at a real boundary, such as a separately described operation or an independently running process, and name the connection to the main flow. Use a sentence when a diagram would only restate a simple relationship.

### Draw a scenario

- Start with a named trigger. Put the main path in reading order and end it with an observable result. Use the actor and an action verb in a node when ownership matters. Include public operation names or returned data when they anchor the contract.
- In a flowchart, make each decision a question about a specific condition. Label its outgoing arrows with the conditions or results that select each branch. Rejoin paths where they resume the same work. End paths that stop or fail with the relevant outcome.
- In a sequence diagram, make the participants the components that actually exchange messages. Label each message with the operation or data crossing the boundary. Show important responses and state changes, especially when an operation is accepted before it completes.
- Use the prose immediately below a diagram to explain behavior it cannot show economically, such as retry or deduplication policy, the meaning of a partial failure, or what state survives cancellation. Keep common contract details in the contracts section and refer to them by name.

### Draw dependencies

- Draw the relevant participants at a consistent level, such as applications, modules, services, data stores or external systems. Name their responsibilities in prose or add a short label where necessary. Group participants by repository, process or deployment when the boundary changes their interaction.
- For a dependency arrow, point from the component that uses the contract to the component that provides it. Label the relationship with an operation, a contract or a channel, for example «Вызывает API», «Записывает в хранилище» or «Читает сообщения из очереди». Explain whether arrows represent code dependencies, runtime interactions or external exchanges when the distinction matters. Give a dotted line or other special style one meaning and explain it beside the diagram.
- Use the same names for components, operations and data in the diagrams and prose. Numbered steps and success or error branches belong in the scenario.

### Worked example across boundaries

The examples use an illustrative link-creation contract. The frontend describes what the user sees and how the draft changes. The backend describes when the API returns a link and who persists it. A document for a single repository can stop at its public boundary and describe the other part by its contract.

**Frontend scenario «Добавление ссылки в черновик»**

\`\`\`mermaid
flowchart TD
    START["Пользователь нажимает «Добавить ссылку»"]
    REQUEST["Редактор отправляет POST /links с resourceId"]
    CHECK{"Сервис ссылок вернул 201 и url?"}
    INSERT["Редактор добавляет url в черновик"]
    ERROR["Редактор показывает ошибку"]
    DONE["В черновике появилась ссылка"]

    START --> REQUEST --> CHECK
    CHECK -->|Получена ссылка| INSERT --> DONE
    CHECK -->|Не удалось получить ссылку| ERROR
\`\`\`

**Backend scenario «Создание ссылки»**

\`\`\`mermaid
sequenceDiagram
    participant Client as Клиент API
    participant Links as Сервис ссылок
    participant Store as Хранилище ссылок

    Client->>Links: POST /links { resourceId }
    alt Входные данные допустимы
        Links->>Store: Сохранить ссылку
        Store-->>Links: Запись подтверждена
        Links-->>Client: 201 Created { url }
    else Входные данные недопустимы
        Links-->>Client: 422 Unprocessable Content
    end
\`\`\`

In this example the editor is the API client. The service owns link creation and returns the URL after storage confirms the write. The editor owns the draft and updates it after receiving the URL. The examples show the validation branch and a confirmed write.

An asynchronous variant would show two landmarks. The API acknowledges the request when the job is queued, and the worker reports completion after saving the link. State the contract for the job identifier and its status or completion event when consumers depend on it.

**Target dependencies for a design that spans the frontend and backend**

\`\`\`mermaid
flowchart LR
    EDITOR["Редактор"]
    LINKS["Сервис ссылок"]
    STORE["Хранилище ссылок"]

    EDITOR -->|Вызывает POST /links| LINKS
    LINKS -->|Сохраняет ссылки| STORE
\`\`\`

### Check the document

- Each scenario has a trigger within its stated scope and a visible outcome for every material path shown.
- A reader can identify who creates the result, who owns the state, and at what point a response or event makes completion visible.
- The dependency arrows have a clear direction and meaning. Component and contract names match across the document.
- Preview diagrams when a renderer is available. Keep labels short enough to read in the rendered layout.`;

export const QA_TEMPLATE = `# QA

A flexible outline for an empty document. Combine, omit, or change sections; completeness does not determine readiness. Write the document in Russian.

QA records what must be true at the level of code and tests and resolves ambiguities of the analysis before the plan.

Look in the analysis for ambiguities and constraints it does not state explicitly: boundary values, empty and invalid input, concurrency, access rights, behavior on failure. Record what you find as a proposed clarification or a question, not as an accepted requirement.

A criterion turns a requirement into behavior verifiable by code and tests: condition, action, expected result, boundary, and basis (a link to analysis). When the way to verify it is not obvious, state it on a separate line under the criterion.

**Q1** Condition -> action -> expected result. Basis: [[section]].

Distinguish explicit requirements, proposed clarifications, and open questions. Do not invent behavior absent from the materials; raise ambiguity as a question. Code structure rules belong in architecture, not QA.`;

const ARCHITECTURE_REVIEW = `# Architecture review
1. Check that the document follows the analysis materials and the current code. QA and the plan are not grounds for this review: they depend on the architecture.
2. Check the project's architectural rules: name the exact rule and the dependency that violates it. Explicit exceptions are allowed.
3. Check responsibility and data ownership of the affected components, error handling and concurrent operations where they matter.
4. Check that the document is technical: decisions are justified rather than requirements retold. Text and diagrams agree, component names are uniform, and existing parts are told apart from proposed ones.
5. Look for needless complication and for details that free interpretation would change.
Back every remark with a place of the document (decision id or quote), the code or the requirement, and the consequence. Keep violations apart from matters of taste.`;

const QA_REVIEW = `# QA review
1. Check that every criterion rests on the analysis materials and that no behaviour is invented. Find requirements without a criterion and criteria without a basis.
2. Check that ambiguities are raised as questions and are not decided silently; a strengthening of a requirement needs a decision.
3. Check that criteria agree with each other and with the ready architecture.
4. Check that boundaries, errors and expected results are exact and observable by code and tests.
5. Find implicit constraints the analysis implies but no criterion covers: boundary, empty and invalid input, failures.
Back every remark with a place of the document (criterion id or quote) and the source it conflicts with. Keep violations apart from suggestions.`;

export const MATERIAL_KINDS: Record<MaterialType, MaterialKind> = {
  architecture: {
    templateType: 'architecture-template', reviewInstructionType: 'architecture-review-instruction',
    reviewSkillType: 'architecture-review-skill', idPrefix: 'D', title: 'Архитектура', defaultTemplate: ARCHITECTURE_TEMPLATE,
    protocol: COMMON_PROTOCOL('D', 'decision') + "\n\n- Write diagrams as Mermaid in a ```mermaid code block. Show only what is described; do not invent components or relationships.", defaultReviewInstruction: ARCHITECTURE_REVIEW,
    reviewSkillAuthoring: 'An architecture-review-skill (type "architecture-review-skill") is the developer\'s rules for reviewing the architecture of a task in this project or group: module boundaries, allowed dependencies, ownership conventions. The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
  qa: {
    templateType: 'qa-template', reviewInstructionType: 'qa-review-instruction', reviewSkillType: 'qa-review-skill',
    idPrefix: 'Q', title: 'QA', defaultTemplate: QA_TEMPLATE, protocol: COMMON_PROTOCOL('Q', 'criterion'),
    defaultReviewInstruction: QA_REVIEW,
    reviewSkillAuthoring: 'A qa-review-skill (type "qa-review-skill") is the developer\'s domain rules for reviewing QA criteria of this project or group (for example "dates and times use the user\'s time zone"). The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
};
