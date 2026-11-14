export class IntegrationError extends Error {
  constructor(message: string, public readonly code = 'validation', public readonly status = 400) { super(message); }
}
