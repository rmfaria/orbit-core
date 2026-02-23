export type PerfMetric = {
  label: string;
  value: number;
  unit: string;
  warn?: number;
  crit?: number;
  min?: number;
  max?: number;
};

export type ParsedPerfdata = {
  ts: Date;
  hostname: string;
  service?: string;
  state: string;
  stateType: string;
  metrics: PerfMetric[];
};

/**
 * Parse a single Nagios perfdata value: label=value[UOM][;warn[;crit[;min[;max]]]]
 * Examples: load1=0.5;5;10;0  time=0.123s;5;10  rta=1.2ms;;;0
 */
export function parsePerfValue(raw: string): PerfMetric | null {
  // Handles labels with spaces if quoted: 'My Label'=value
  const eqIdx = raw.lastIndexOf('=');
  if (eqIdx === -1) return null;

  const label = raw.slice(0, eqIdx).trim().replace(/^'|'$/g, '');
  const rest = raw.slice(eqIdx + 1);

  const match = rest.match(/^([0-9.eE+\-]+)([^;]*)?(?:;([^;]*))?(?:;([^;]*))?(?:;([^;]*))?(?:;(.*))?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;

  const toNum = (s: string | undefined) => {
    if (!s || s.trim() === '') return undefined;
    const n = parseFloat(s);
    return isNaN(n) ? undefined : n;
  };

  return {
    label,
    value,
    unit: (match[2] ?? '').trim(),
    warn: toNum(match[3]),
    crit: toNum(match[4]),
    min: toNum(match[5]),
    max: toNum(match[6]),
  };
}

/**
 * Parse a space-separated perfdata string into multiple PerfMetric.
 * Handles quoted labels with spaces.
 */
export function parsePerfString(perfdata: string): PerfMetric[] {
  // Split respecting single-quoted labels
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;

  for (const ch of perfdata) {
    if (ch === "'" ) {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === ' ' && !inQuote) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());

  return tokens.map(parsePerfValue).filter((m): m is PerfMetric => m !== null);
}

/**
 * Parse a line from Nagios service_perfdata_file or host_perfdata_file.
 *
 * The shipper expects the default Nagios template format using tab-separated
 * FIELD::VALUE pairs. Configure nagios.cfg with:
 *
 * service_perfdata_file_template=DATATYPE::SERVICEPERFDATA\tTIMET::$LASTSERVICECHECK$\tHOSTNAME::$HOSTNAME$\tSERVICEDESC::$SERVICEDESC$\tSERVICEPERFDATA::$SERVICEPERFDATA$\tSERVICESTATE::$SERVICESTATE$\tSERVICESTATETYPE::$SERVICESTATETYPE$
 * host_perfdata_file_template=DATATYPE::HOSTPERFDATA\tTIMET::$LASTHOSTCHECK$\tHOSTNAME::$HOSTNAME$\tHOSTPERFDATA::$HOSTPERFDATA$\tHOSTSTATE::$HOSTSTATE$\tHOSTSTATETYPE::$HOSTSTATETYPE$
 */
export function parsePerfline(line: string): ParsedPerfdata | null {
  line = line.trim();
  if (!line) return null;

  const fields: Record<string, string> = {};
  for (const part of line.split('\t')) {
    const idx = part.indexOf('::');
    if (idx === -1) continue;
    fields[part.slice(0, idx)] = part.slice(idx + 2);
  }

  const datatype = fields['DATATYPE'];
  if (!datatype) return null;

  const timet = parseInt(fields['TIMET'] ?? '', 10);
  if (!timet || isNaN(timet)) return null;

  const hostname = fields['HOSTNAME'];
  if (!hostname) return null;

  if (datatype === 'SERVICEPERFDATA') {
    const perfdata = fields['SERVICEPERFDATA'] ?? '';
    return {
      ts: new Date(timet * 1000),
      hostname,
      service: fields['SERVICEDESC'],
      state: fields['SERVICESTATE'] ?? 'UNKNOWN',
      stateType: fields['SERVICESTATETYPE'] ?? 'SOFT',
      metrics: parsePerfString(perfdata),
    };
  }

  if (datatype === 'HOSTPERFDATA') {
    const perfdata = fields['HOSTPERFDATA'] ?? '';
    return {
      ts: new Date(timet * 1000),
      hostname,
      service: undefined,
      state: fields['HOSTSTATE'] ?? 'UNKNOWN',
      stateType: fields['HOSTSTATETYPE'] ?? 'SOFT',
      metrics: parsePerfString(perfdata),
    };
  }

  return null;
}
