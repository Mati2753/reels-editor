import { z } from "zod";

export const SettingsSchema = z.object({
  format: z.string().default("cinematic"),
  target: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]).default(30),
  cuts: z.boolean().default(true),
  motion: z.boolean().default(true),
  captions: z.boolean().default(true),
  sound: z.boolean().default(true),
  director: z.enum(["local", "claude"]).default("local"),
  brief: z.string().max(500).default(""),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = SettingsSchema.parse({});
