import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default(''),
  // If set, all non-health endpoints require this key via X-Api-Key header or
  // Authorization: Bearer <key>. Leave unset to run without auth (dev mode).
  ORBIT_API_KEY: z.string().optional()
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse({
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    ORBIT_API_KEY: process.env.ORBIT_API_KEY
  });
}
