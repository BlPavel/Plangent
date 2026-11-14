import type { ChatEvent, ChatPayload, InterviewAnswer, InterviewAnswersMeta } from '@contracts'

export type InterviewRound = Required<Pick<ChatPayload, 'round' | 'total_rounds' | 'questions'>> & Pick<ChatPayload, 'topic' | 'upcoming'>

/**
 * The developer's answers to a round: what the agent reads and what the card shows once the message is sent.
 * `finish`: the developer ends the interview early with the answers given so far.
 */
export function answersMessage(seq: number, round: InterviewRound, answers: InterviewAnswer[], finish = false) {
  const lines = [finish
    ? `Разработчик завершил интервью досрочно на раунде ${round.round} из ${round.total_rounds}${round.topic ? ` (${round.topic})` : ''}. Ответы этого раунда:`
    : `Ответы на раунд ${round.round} из ${round.total_rounds} интервью${round.topic ? ` (${round.topic})` : ''}:`]
  round.questions.forEach((question, i) => {
    const answer = answers.find(a => a.question_id === question.id)
    lines.push('', `${i + 1}. [${question.id}] ${question.text}`)
    if (!answer) lines.push('   Без ответа.')
    else if (answer.kind === 'option') {
      const option = question.options[answer.index]
      lines.push(`   Выбран вариант: ${option?.label ?? '?'}${option?.recommended ? ' (рекомендованный)' : ''}`)
    } else if (answer.kind === 'custom') lines.push(`   Свой ответ: ${answer.text}`)
    else lines.push(`   Вопрос непонятен, нужно уточнить в следующем раунде${answer.text ? `: ${answer.text}` : '.'}`)
  })
  lines.push('', finish
    ? 'Интервью окончено. Подведи итог, выполни исходную просьбу и сохрани раздел; вопросы без ответа оставь в нём открытыми.'
    : round.round < round.total_rounds || answers.some(a => a.kind === 'clarify')
      ? 'Интервью продолжается: задай следующий раунд через ask_interview_questions. До конца интервью ничего не сохраняй и не выполняй исходную просьбу.'
      : 'Это был последний раунд, интервью окончено. Подведи итог, выполни исходную просьбу и сохрани раздел.')
  const meta: InterviewAnswersMeta = { plangent_interview: { round_seq: seq, answers, ...(finish ? { finish: true } : {}) } }
  return { type: 'text' as const, text: lines.join('\n'), _meta: { ...meta } }
}

/** Answers already sent, by the seq of the round they answer. */
export function sentAnswers(events: ChatEvent[]) {
  const sent = new Map<number, { userSeq: number; answers: InterviewAnswer[]; finish: boolean }>()
  for (const event of events) {
    if (event.type !== 'user') continue
    const content = (event.payload.content ?? []) as { _meta?: Partial<InterviewAnswersMeta> | null }[]
    const meta = content.find(c => c._meta?.plangent_interview)?._meta?.plangent_interview
    if (meta) sent.set(meta.round_seq, { userSeq: event.seq, answers: meta.answers, finish: !!meta.finish })
  }
  return sent
}

/**
 * Questions a round asks again because the developer asked to clarify them in an earlier round (the agent keeps
 * their id): round seq → question id → what the developer asked ('' when they only marked it unclear).
 */
export function clarifiedQuestions(events: ChatEvent[], sent: ReturnType<typeof sentAnswers>) {
  const asked = new Map<string, string>(), result = new Map<number, Record<string, string>>()
  for (const event of events) {
    if (event.type !== 'interview_questions') continue
    const repeated = Object.fromEntries((event.payload.questions ?? []).filter(q => asked.has(q.id)).map(q => [q.id, asked.get(q.id)!]))
    if (Object.keys(repeated).length) result.set(event.seq, repeated)
    for (const answer of sent.get(event.seq)?.answers ?? []) {
      if (answer.kind === 'clarify') asked.set(answer.question_id, answer.text)
      else asked.delete(answer.question_id)
    }
  }
  return result
}
