export type NagiosAlert = {
  ts: Date;
  type: 'SERVICE' | 'HOST';
  hostname: string;
  service?: string;
  state: string;
  stateType: string;
  attempt: number;
  output: string;
};

/**
 * Parse a line from nagios.log looking for HARD/SOFT state alerts.
 *
 * Supported formats:
 *   [timestamp] SERVICE ALERT: hostname;service;STATE;HARD;attempt;output
 *   [timestamp] HOST ALERT: hostname;STATE;HARD;attempt;output
 */
export function parseLogLine(line: string): NagiosAlert | null {
  line = line.trim();
  if (!line) return null;

  const tsMatch = line.match(/^\[(\d+)\]\s+(.+)$/);
  if (!tsMatch) return null;

  const ts = new Date(parseInt(tsMatch[1], 10) * 1000);
  const rest = tsMatch[2];

  // SERVICE ALERT: host;service;STATE;HARD|SOFT;attempt;output
  const svc = rest.match(/^SERVICE ALERT: ([^;]+);([^;]+);([^;]+);([^;]+);(\d+);(.*)$/);
  if (svc) {
    return {
      ts,
      type: 'SERVICE',
      hostname: svc[1],
      service: svc[2],
      state: svc[3].toUpperCase(),
      stateType: svc[4].toUpperCase(),
      attempt: parseInt(svc[5], 10),
      output: svc[6],
    };
  }

  // HOST ALERT: host;STATE;HARD|SOFT;attempt;output
  const host = rest.match(/^HOST ALERT: ([^;]+);([^;]+);([^;]+);(\d+);(.*)$/);
  if (host) {
    return {
      ts,
      type: 'HOST',
      hostname: host[1],
      state: host[2].toUpperCase(),
      stateType: host[3].toUpperCase(),
      attempt: parseInt(host[4], 10),
      output: host[5],
    };
  }

  return null;
}
