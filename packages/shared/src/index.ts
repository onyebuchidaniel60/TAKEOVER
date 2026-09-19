// placeholder: shared contract surface only, no business logic yet.
// Later phases will add the stable API envelope, error codes, and shared
// validation schemas here (see ARCHITECTURE.md sections 12 and 15).

export const SHARED_PACKAGE_VERSION = '0.1.0' as const;

export const HEALTH_STATUS_OK = 'ok' as const;
export type HealthStatus = typeof HEALTH_STATUS_OK;

export interface AppInfo {
  name: 'TAKEOVER';
  phase: 1;
}
