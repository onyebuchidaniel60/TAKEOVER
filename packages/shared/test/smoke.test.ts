import { describe, expect, it } from 'vitest';
import { type AppInfo, HEALTH_STATUS_OK, SHARED_PACKAGE_VERSION } from '../src/index';

describe('shared package', () => {
  it('exposes the placeholder contracts', () => {
    expect(SHARED_PACKAGE_VERSION).toBe('0.1.0');
    expect(HEALTH_STATUS_OK).toBe('ok');
    const info: AppInfo = { name: 'TAKEOVER', phase: 1 };
    expect(info.name).toBe('TAKEOVER');
  });
});
