import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import { createStripePortalSession, getStripeConfig } from '../../lib/stripe';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface PortalRequestBody {
  returnUrl?: string;
}

async function getStripeCustomerId(db: AppContext['env']['DB'], userId: string): Promise<string | null> {
  try {
    return (
      await db
        .prepare(
          `
            SELECT stripe_customer_id
            FROM stripe_customers
            WHERE user_id = ?
            LIMIT 1
        `,
        )
        .bind(userId)
        .first<{ stripe_customer_id: string }>()
    )?.stripe_customer_id ?? null;
  } catch {
    return null;
  }
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  const user = getCurrentUser(context);
  if (!user) {
    return json(
      {
        error: 'auth_required',
        message: 'Billing portal requires a signed-in user.',
      },
      { status: 401 },
    );
  }

  const stripeConfig = getStripeConfig(context.env);
  if (!stripeConfig) {
    return json(
      {
        error: 'stripe_unavailable',
        message: 'Stripe secret key is missing.',
      },
      { status: 503 },
    );
  }

  const body = (await parseJson<PortalRequestBody>(context.request)) ?? {};
  const customerId = await getStripeCustomerId(context.env.DB, user.id);
  if (!customerId) {
    return json(
      {
        error: 'stripe_customer_missing',
        message: 'No Stripe customer is linked to this account yet.',
      },
      { status: 404 },
    );
  }

  const returnUrl = body.returnUrl?.trim() || new URL(context.request.url).origin;

  try {
    const session = await createStripePortalSession(stripeConfig, {
      customerId,
      returnUrl,
    });

    return json({
      id: session.id,
      portalUrl: session.url,
    });
  } catch (error) {
    return json(
      {
        error: 'stripe_portal_failed',
        message: error instanceof Error ? error.message : 'Stripe billing portal creation failed.',
      },
      { status: 502 },
    );
  }
};
