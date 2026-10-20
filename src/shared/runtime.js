import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import {
  byStoreViewId,
  getConfiguration,
  initialize,
} from "@adobe/aio-commerce-lib-config";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";
import state from "@adobe/aio-lib-state";
import { azupayClient } from "./azupay-client.js";
import { cartContext } from "./cart-context.js";
import { configSchema } from "./config-schema.js";
import {
  normalizePaymentConfig,
  PaymentError,
  requireValue,
} from "./payment.js";
import { paymentService } from "./service.js";

export function logError(code, details = {}) {
  // Never log action params, receipts, cart IDs, provider bodies or credentials.
  console.error(JSON.stringify({ code, ...details }));
}

export function commerceAdapter(client, context) {
  async function json(promise) {
    try {
      return await promise.json();
    } catch {
      throw new PaymentError(
        "COMMERCE_API_ERROR",
        "Commerce could not complete the request. Retry or contact support; do not pay again.",
        502,
      );
    }
  }
  return {
    async storeIdByCode(code) {
      const stores = await json(client.get("store/storeViews"));
      requireValue(
        Array.isArray(stores),
        "COMMERCE_INVALID_RESPONSE",
        "Commerce returned an invalid store-view response.",
        502,
      );
      const matches = stores.filter(
        (store) => store.code === code && Number(store.is_active) === 1,
      );
      requireValue(
        matches.length === 1 &&
          Number.isSafeInteger(Number(matches[0].id)) &&
          Number(matches[0].id) > 0,
        "INVALID_STORE",
        "The configured Commerce store view was not found.",
        404,
      );
      return Number(matches[0].id);
    },
    async getQuote(cartId, request) {
      const quote = await context.getQuote(cartId, request);
      const totals = await json(client.get(`carts/${Number(quote.id)}/totals`));
      return {
        ...quote,
        grand_total: totals.grand_total,
        quote_currency_code: quote.currency?.quote_currency_code,
        shipping_address:
          quote.extension_attributes?.shipping_assignments?.[0]?.shipping
            ?.address,
      };
    },
    async pendingOrders() {
      const orders = [];
      let page = 1;
      let total;
      do {
        const query = new URLSearchParams({
          "searchCriteria[filter_groups][0][filters][0][field]": "status",
          "searchCriteria[filter_groups][0][filters][0][value]": "pending",
          "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
          "searchCriteria[sortOrders][0][field]": "entity_id",
          "searchCriteria[sortOrders][0][direction]": "ASC",
          "searchCriteria[pageSize]": "100",
          "searchCriteria[currentPage]": String(page),
        });
        const result = await json(client.get(`orders?${query}`));
        requireValue(
          Array.isArray(result.items) &&
            Number.isSafeInteger(result.total_count),
          "COMMERCE_INVALID_RESPONSE",
          "Commerce returned an invalid order search response.",
          502,
        );
        total = result.total_count;
        orders.push(...result.items);
        requireValue(
          result.items.length > 0 || orders.length >= total,
          "COMMERCE_PAGINATION_ERROR",
          "The Commerce order scan was incomplete.",
          502,
        );
        requireValue(
          page <= 20,
          "RECONCILIATION_BACKLOG",
          "More than 2000 pending orders require a dedicated reconciliation queue.",
          503,
        );
        page += 1;
      } while (orders.length < total);
      return orders;
    },
    invoice: (orderId) =>
      json(
        client.post(`order/${Number(orderId)}/invoice`, {
          json: {
            capture: false,
            notify: true,
            appendComment: true,
            comment: {
              comment:
                "Azupay settlement verified server-side; offline invoice, no second debit.",
              is_visible_on_front: 0,
            },
          },
        }),
      ),
  };
}

export async function runtimeDependencies(params) {
  await initialize({ schema: configSchema });
  const client = await getCommerceClient(resolveImsAuthParams(params));
  const context = cartContext({
    client,
    getState: () => state.init(),
    logError,
  });
  return {
    params,
    commerce: commerceAdapter(client, context),
    cartContext: context,
    getConfig: async (storeId) => {
      const result = await getConfiguration(byStoreViewId(storeId));
      return normalizePaymentConfig(
        Object.fromEntries(
          result.config.map(({ name, value }) => [name, value]),
        ),
      );
    },
    azupay: azupayClient,
    logError,
  };
}

export async function runtimeService(params) {
  return paymentService(await runtimeDependencies(params));
}
