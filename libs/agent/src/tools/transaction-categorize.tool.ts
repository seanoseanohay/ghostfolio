import { OrderService } from '@ghostfolio/api/app/order/order.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { Type as ActivityType } from '@prisma/client';
import { format, parseISO } from 'date-fns';
import { groupBy } from 'lodash';

import {
  TransactionCategorizeInput,
  TransactionCategorizeInputSchema,
  TransactionCategorizeOutput
} from '../schemas/transaction-categorize.schema';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

async function categorizeTransactions(
  input: TransactionCategorizeInput,
  orderService: OrderService,
  userId: string
): Promise<TransactionCategorizeOutput> {
  const warnings: string[] = [];

  const startDate = input.startDate ? parseISO(input.startDate) : undefined;
  const endDate = input.endDate ? parseISO(input.endDate) : undefined;

  const types = input.types ? (input.types as ActivityType[]) : undefined;

  const { activities, count } = await orderService.getOrders({
    endDate,
    startDate,
    take: input.limit ?? 50,
    types,
    userCurrency: 'USD',
    userId
  });

  if (count > (input.limit ?? 50)) {
    warnings.push(
      `There are ${count} total transactions matching the filter, but only ${input.limit ?? 50} are shown. Use startDate/endDate or a higher limit to refine.`
    );
  }

  const grouped = groupBy(activities, (a) => a.type);

  const summary = Object.entries(grouped).map(([type, items]) => ({
    type,
    count: items.length,
    totalValueInBaseCurrency: items.reduce(
      (sum, a) => sum + (a.valueInBaseCurrency ?? 0),
      0
    ),
    totalFeeInBaseCurrency: items.reduce(
      (sum, a) => sum + (a.feeInBaseCurrency ?? 0),
      0
    )
  }));

  const transactions = activities.map((a) => ({
    date: format(new Date(a.date), 'yyyy-MM-dd'),
    type: a.type,
    symbol: a.SymbolProfile?.symbol ?? 'N/A',
    quantity: a.quantity ?? 0,
    unitPrice: a.unitPrice ?? 0,
    fee: a.fee ?? 0,
    currency: a.currency ?? 'USD',
    valueInBaseCurrency: a.valueInBaseCurrency ?? 0,
    accountName: a.account?.name
  }));

  return {
    asOf: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    totalCount: count,
    summary,
    transactions,
    warnings
  };
}

export function createTransactionCategorizeTool(
  orderService: OrderService,
  userId: string
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    description:
      "Retrieve and categorize the user's transactions (buy, sell, dividend, fee, etc.). Returns a summary grouped by activity type and a list of individual transactions. Use this to answer questions about trading history, dividend income, fees paid, or spending patterns.",
    func: async (input: TransactionCategorizeInput): Promise<string> => {
      const result = await executeWithRetry(() =>
        categorizeTransactions(input, orderService, userId)
      );

      return JSON.stringify(result);
    },
    name: 'transaction_categorize',
    schema: TransactionCategorizeInputSchema as any
  });
}
