import type { DatabaseClient, TransactionClient } from "./types.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const actorRoles = new Set(["administrator", "inspector", "support", "system"]);

export type DatabaseActorRole =
  "administrator" | "inspector" | "support" | "system";

export interface DatabaseActorContext {
  organizationId: string;
  actorId: string;
  actorRole: DatabaseActorRole;
  authSubject: string;
  assuranceLevel: "aal1" | "aal2";
}

function assertContext(context: DatabaseActorContext): void {
  if (
    !uuidPattern.test(context.organizationId) ||
    !uuidPattern.test(context.actorId) ||
    !uuidPattern.test(context.authSubject) ||
    !actorRoles.has(context.actorRole)
  ) {
    throw new Error("Invalid database actor context.");
  }
}

export async function withActorContext<TResult>(
  client: Pick<DatabaseClient, "begin">,
  context: DatabaseActorContext,
  work: (transaction: TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  assertContext(context);
  return client.begin(async (transaction) => {
    const claims = JSON.stringify({
      aal: context.assuranceLevel,
      actor_id: context.actorId,
      organization_id: context.organizationId,
      role: "authenticated",
      sub: context.authSubject,
    });
    await transaction.unsafe(
      `select
        set_config('request.jwt.claim.sub', $1, true),
        set_config('request.jwt.claims', $2, true),
        set_config('app.organization_id', $3, true),
        set_config('app.actor_id', $4, true),
        set_config('app.actor_role', $5, true),
        set_config('app.assurance_level', $6, true)`,
      [
        context.authSubject,
        claims,
        context.organizationId,
        context.actorId,
        context.actorRole,
        context.assuranceLevel,
      ],
    );
    return work(transaction);
  });
}
