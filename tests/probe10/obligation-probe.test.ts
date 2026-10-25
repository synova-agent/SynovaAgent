import { describe, it, expect } from 'vitest';
import { PROBE } from '../../src/probe10/obligation-probe';
describe('probe10', () => {
  it('a', () => expect(PROBE).toBeDefined());
  it('b', () => expect(PROBE.length).toBeGreaterThan(0));
  it('c', () => expect(PROBE).toContain('probe'));
});
