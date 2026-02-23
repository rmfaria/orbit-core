import { z } from 'zod';

const ConfigSchema = z.object({
  ORBIT_API_URL: z.string().url().default('http://localhost:3000'),
  NAGIOS_PERFDATA_FILE: z.string().optional(),
  NAGIOS_LOG_FILE: z.string().optional(),
  NAGIOS_DEFAULT_NAMESPACE: z.string().default('nagios'),
  SHIPPER_BATCH_SIZE: z.coerce.number().int().positive().max(5000).default(500),
  SHIPPER_STATE_DIR: z.string().default('/tmp/orbit-nagios-shipper'),
  SHIPPER_MODE: z.enum(['once', 'watch']).default('once'),
  SHIPPER_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}
