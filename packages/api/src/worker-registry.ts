/**
 * orbit-core — Worker heartbeat registry
 *
 * Each background worker calls heartbeat(name) after every successful tick.
 * The /api/v1/system endpoint reads this registry to report worker liveness.
 */

export type WorkerName = 'rollup' | 'correlate' | 'alerts' | 'connectors';

interface WorkerEntry {
  last_beat: number;   // Date.now() of last successful beat
  beats:     number;   // total successful beats since startup
  errors:    number;   // total errors since startup
}

const registry: Record<WorkerName, WorkerEntry> = {
  rollup:     { last_beat: 0, beats: 0, errors: 0 },
  correlate:  { last_beat: 0, beats: 0, errors: 0 },
  alerts:     { last_beat: 0, beats: 0, errors: 0 },
  connectors: { last_beat: 0, beats: 0, errors: 0 },
};

export function heartbeat(name: WorkerName): void {
  registry[name].last_beat = Date.now();
  registry[name].beats++;
}

export function workerError(name: WorkerName): void {
  registry[name].errors++;
}

export function getWorkerRegistry(): Readonly<Record<WorkerName, WorkerEntry>> {
  return registry;
}
