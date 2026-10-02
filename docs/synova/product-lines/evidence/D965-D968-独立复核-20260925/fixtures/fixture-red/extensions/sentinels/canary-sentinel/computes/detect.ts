export const canarySentinel = {
  async check(_store: unknown, _teamId: string): Promise<never> {
    throw new Error('CANARY-RED-D965');
  },
};
