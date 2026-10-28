# Branch review

Reviewing a colleague's code. A review is a pair of branches of one project; the code is always read
from local git (diff against the merge base, or against the MR's own base when the review is pinned
to a merge request). Opening an MR from the list fetches origin and reviews `origin/<source>` against
`origin/<target>`; MRs from forks are not supported.

- `mr.ts` — open MRs with approvals (one approvals request per MR, a few at a time), opening an MR,
  colleagues' threads (reply, resolve, own notes) and the approval of exactly the reviewed head.
- `remarks.ts` — draft remarks of the developer and of the agent. A line remark must sit on a line of
  the diff, so its GitLab position can be built. Publication needs confirmation and the MR at the
  reviewed head; every remote step is saved at once and an unclear failure is left for the developer
  to check (the same rules as the former `mr-review`). Without an MR remarks are copied by hand and
  marked sent. Each publication starts the next round (`published_head`).
- `questions.ts` — private questions to the agent, batched like the code review threads.
- `agent.ts` — the review agent: `get_review_brief` (protocol, range, MR, developer context, task,
  review skill, threads, remarks), the overview and draft remarks of «Начать ревью», and the
  round check, which is an ordinary question. The review runs once (`analysis_status`: running →
  done when the agent's turn ends, stopped, failed); «Новое ревью» (`restart`) closes the agents and
  drops the overview and the agent's drafts the developer has not edited.

One agent session per review head, read-only, in a detached worktree; it acts only through the
Plangent tools. Review skills are library items of type `review-skill` (project → group → global),
never synced to agent folders.

Validation: `npx tsx --test server/core/branch-review/*.test.ts`.
