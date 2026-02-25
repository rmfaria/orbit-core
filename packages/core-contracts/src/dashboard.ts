/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { OrbitQlQuery } from './index.js';

export const WidgetKindSchema = z.enum(['timeseries', 'timeseries_multi', 'events', 'eps', 'kpi', 'gauge']);
export type WidgetKind = z.infer<typeof WidgetKindSchema>;

export const LayoutSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const WidgetSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: WidgetKindSchema,
  layout: LayoutSchema,
  query: z.custom<OrbitQlQuery>(),
  note: z.string().optional(),
});

export type WidgetSpec = z.infer<typeof WidgetSpecSchema>;

export const DashboardSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('v1'),
  time: z.object({
    preset: z.enum(['60m','6h','24h','7d','30d']).default('60m'),
  }).default({ preset: '60m' }),
  tags: z.array(z.string()).default([]),
  widgets: z.array(WidgetSpecSchema).min(1),
});

export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;
