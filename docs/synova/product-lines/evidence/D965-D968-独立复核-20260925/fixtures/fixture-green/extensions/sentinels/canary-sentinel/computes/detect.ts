export const canarySentinel = {
  async check(_store: unknown, _teamId: string) {
    return [{ id: 'canary-green', severity: 'info' as const, title: 'green control', description: 'ok',
      evidence: ['green'], suggestion: 'n/a', detectedAt: new Date().toISOString() }];
  },
};
