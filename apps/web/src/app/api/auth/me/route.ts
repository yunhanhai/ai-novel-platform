import { safeGetOrganizationId, safeGetUserId } from "../../../../server/context";
import { getSession } from "../../../../server/auth";
import { unauthorizedResponse } from "../../../../server/api-errors";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return unauthorizedResponse();
  }

  return Response.json({
    success: true,
    data: {
      userId: await safeGetUserId(),
      organizationId: await safeGetOrganizationId(),
      displayName: session.displayName
    }
  });
}
