import { describe, expect, it } from 'vitest';
import { isResponse, parseRequest } from '../../src/workers/protocol';

describe('worker protocol validation', () => {
  it('accepts well-formed requests', () => {
    expect(parseRequest({ type: 'control', action: 'pause' })).not.toBeNull();
    expect(parseRequest({ type: 'speed', value: 10 })).not.toBeNull();
    expect(parseRequest({ type: 'input', throttle: 1, brake: 0, steer: -1 })).not.toBeNull();
    expect(parseRequest({ type: 'init', mode: 'train', config: {}, autoplay: true })).not.toBeNull();
  });

  it('rejects malformed or unknown requests', () => {
    expect(parseRequest(null)).toBeNull();
    expect(parseRequest('control')).toBeNull();
    expect(parseRequest({ type: 'control', action: 'selfDestruct' })).toBeNull();
    expect(parseRequest({ type: 'speed', value: 3 })).toBeNull();
    expect(parseRequest({ type: 'input', throttle: NaN, brake: 0, steer: 0 })).toBeNull();
    expect(parseRequest({ type: 'init', mode: 'hack', config: {} })).toBeNull();
    expect(parseRequest({ type: 'eval', code: '1' })).toBeNull();
  });

  it('recognises worker responses', () => {
    expect(isResponse({ type: 'frame' })).toBe(true);
    expect(isResponse({ type: 'nope' })).toBe(false);
  });
});
