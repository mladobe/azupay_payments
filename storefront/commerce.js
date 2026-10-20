/**
 * graphql(query, variables) must use the storefront's existing authenticated
 * Commerce connection and return the raw { data, errors } GraphQL envelope.
 */
export async function attachPaymentMethod({ graphql, cartId, paymentMethod }) {
  const selected = await graphql(
    `mutation AzupaySetPayment($cartId: String!, $method: PaymentMethodInput!) {
      setPaymentMethodOnCart(input: {cart_id: $cartId, payment_method: $method}) {
        cart { selected_payment_method { code } }
      }
    }`,
    { cartId, method: paymentMethod },
  );
  if (selected.errors?.length || !selected.data?.setPaymentMethodOnCart?.cart) {
    throw new Error(
      "Payment is received but could not be attached to the cart. Retry order placement, not payment.",
    );
  }
}

export function checkoutCompletion({ graphql, cartId }) {
  if (typeof graphql !== "function")
    throw new Error("A Commerce GraphQL function is required.");
  return async (paymentMethod) => {
    await attachPaymentMethod({ graphql, cartId, paymentMethod });
    const placed = await graphql(
      `mutation AzupayPlaceOrder($cartId: String!) {
        placeOrder(input: {cart_id: $cartId}) {
          orderV2 { number token }
          errors { code message }
        }
      }`,
      { cartId },
    );
    if (
      placed.errors?.length ||
      placed.data?.placeOrder?.errors?.length ||
      !placed.data?.placeOrder?.orderV2?.number
    ) {
      throw new Error(
        "Payment is received but the order was not confirmed. Retry or contact support; do not pay again.",
      );
    }
    return placed.data.placeOrder.orderV2;
  };
}
