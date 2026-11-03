import type { ReviewTarget } from './types'

/**
 * The words of the review panel for what is reviewed. The panel and its cards are the same for the plan and for the
 * architecture and QA documents; only these phrases differ (who receives the cards, what is frozen, what is fixed).
 */
export interface ReviewLabels {
  title: string
  skill: string
  /** Who gets the accepted cards: dative, nominative, genitive, and the chat to open. */
  recipient: string
  recipientNom: string
  recipientGen: string
  recipientChat: string
  /** What the recipient fixes: accusative, prepositional. */
  subject: string
  subjectIn: string
  whole: string
  frozen: string
  highlight: string
}

export const reviewLabels: Record<ReviewTarget, ReviewLabels> = {
  plan: {
    title: 'Ревью плана', skill: 'Скилл ревью плана', recipient: 'планировщику', recipientNom: 'Планировщик', recipientGen: 'планировщика', recipientChat: 'чат планировщика',
    subject: 'план', subjectIn: 'в плане', whole: 'Весь план', frozen: 'План заморожен на время выполнения очереди.', highlight: 'Подсветить эти шаги в плане',
  },
  architecture: {
    title: 'Ревью архитектуры', skill: 'Скилл ревью архитектуры', recipient: 'автору документа', recipientNom: 'Автор документа', recipientGen: 'автора документа', recipientChat: 'чат автора',
    subject: 'документ', subjectIn: 'в документе', whole: 'Весь документ', frozen: 'Документ заморожен на время выполнения очереди.', highlight: 'Подсветить эти решения в документе',
  },
  qa: {
    title: 'Ревью QA', skill: 'Скилл ревью QA', recipient: 'автору документа', recipientNom: 'Автор документа', recipientGen: 'автора документа', recipientChat: 'чат автора',
    subject: 'документ', subjectIn: 'в документе', whole: 'Весь документ', frozen: 'Документ заморожен на время выполнения очереди.', highlight: 'Подсветить эти критерии в документе',
  },
}

/** Kinds of a card: the plan and the documents share most of them; «Улучшение» is an improvement, not a violation. */
export const remarkKinds = {
  contradiction: 'Противоречие', order: 'Порядок', coverage: 'Покрытие', extra: 'Лишнее', unclear: 'Неясность', risk: 'Риск', suggestion: 'Улучшение',
}
