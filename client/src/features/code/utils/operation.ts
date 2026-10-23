import type { GitOperationState } from '../git-types'

const short = (sha: string) => sha.slice(0, 7)
/** «Rebase ветки feature/x на origin/develop · коммит 3 из 7» */
export function operationTitle(o: GitOperationState): string {
  const branch = o.branch ? ' ветки ' + o.branch : ''
  if (o.kind === 'rebase') {
    const onto = o.onto ? ' на ' + (o.onto.name ?? short(o.onto.sha)) : ''
    return 'Rebase' + branch + onto + (o.step ? ` · коммит ${o.step.done} из ${o.step.total}` : '')
  }
  if (o.kind === 'merge') return 'Merge ' + (o.commit ? (o.commit.name ?? short(o.commit.sha)) : '') + (o.branch ? ' в ' + o.branch : '')
  return (o.kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert') + (o.commit ? ' ' + short(o.commit.sha) : '') + (o.branch ? ' в ' + o.branch : '')
}