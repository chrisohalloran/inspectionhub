import { z } from "zod";

export type RuntimeTarget = "web" | "worker";

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]),
  PROVIDER_MODE: z.enum(["fake", "test", "live"]),
});

const webSchema = baseSchema.extend({
  NEXT_PUBLIC_INSPECTION_HUB_HOST: z.string().min(1),
  NEXT_PUBLIC_SEE_IT_HOST: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
});

const workerSchema = baseSchema.extend({
  DATABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  WORKER_ID: z.string().min(1),
});

const schemas = { web: webSchema, worker: workerSchema } as const;

export class EnvironmentConfigurationError extends Error {
  readonly target: RuntimeTarget;
  readonly missingOrInvalid: readonly string[];

  constructor(target: RuntimeTarget, missingOrInvalid: readonly string[]) {
    super(
      `Invalid ${target} environment: ${missingOrInvalid.join(", ")}. Copy .env.example to .env.local and provide the named values.`,
    );
    this.name = "EnvironmentConfigurationError";
    this.target = target;
    this.missingOrInvalid = missingOrInvalid;
  }
}

export function parseEnvironment(
  target: "web",
  input: Record<string, unknown>,
): z.infer<typeof webSchema>;
export function parseEnvironment(
  target: "worker",
  input: Record<string, unknown>,
): z.infer<typeof workerSchema>;
export function parseEnvironment(
  target: RuntimeTarget,
  input: Record<string, unknown>,
) {
  const result = schemas[target].safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ].sort();
    throw new EnvironmentConfigurationError(target, fields);
  }
  return result.data;
}
