export class DecisionRequiredError extends Error {
  public constructor(
    message: string,
    public readonly reason:
      | 'secret'
      | 'scope'
      | 'destructive'
      | 'dependency'
      | 'network'
      | 'external_write'
      | 'incomplete_tool'
      | 'non_git',
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DecisionRequiredError';
  }
}
