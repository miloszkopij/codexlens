import type { AppSettings, Currency } from "../../types";
import { getAppSettings, saveAppSettings } from "../../../db/store";

export const dynamic = "force-dynamic";

function currency(value: unknown): Currency | null {
  return value === "USD" || value === "PLN" || value === "EUR" ? value : null;
}

export async function GET() {
  try {
    return Response.json(await getAppSettings());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const nextCurrency = currency(body.currency);
    if (!nextCurrency) return Response.json({ error: "Choose USD, PLN, or EUR." }, { status: 400 });
    const rawPrice = body.pricePerCredit;
    const pricePerCredit = rawPrice === null || rawPrice === "" ? null : Number(rawPrice);
    if (pricePerCredit !== null && (!Number.isFinite(pricePerCredit) || pricePerCredit < 0)) {
      return Response.json({ error: "Price per credit must be a non-negative number." }, { status: 400 });
    }
    const nullableNumber = (value: unknown) => value === null || value === "" || value === undefined ? null : Number(value);
    const currentCreditBalance = nullableNumber(body.currentCreditBalance);
    const unbilledOverageCredits = nullableNumber(body.unbilledOverageCredits);
    const workspaceOverageLimitCredits = nullableNumber(body.workspaceOverageLimitCredits);
    const billingBudgetAmount = nullableNumber(body.billingBudgetAmount);
    const budgetAlertPercent = body.budgetAlertPercent === undefined || body.budgetAlertPercent === "" ? 80 : Number(body.budgetAlertPercent);
    if ([currentCreditBalance, unbilledOverageCredits, workspaceOverageLimitCredits, billingBudgetAmount]
      .some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
      return Response.json({ error: "Billing and budget values must be non-negative numbers." }, { status: 400 });
    }
    if (!Number.isFinite(budgetAlertPercent) || budgetAlertPercent < 1 || budgetAlertPercent > 100) {
      return Response.json({ error: "Budget alert threshold must be between 1 and 100 percent." }, { status: 400 });
    }
    const nullableDate = (value: unknown) => typeof value === "string" && value !== "" ? value : null;
    const billingPeriodStart = nullableDate(body.billingPeriodStart);
    const billingPeriodEnd = nullableDate(body.billingPeriodEnd);
    if ([billingPeriodStart, billingPeriodEnd].some((value) => value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      return Response.json({ error: "Billing period dates must use YYYY-MM-DD." }, { status: 400 });
    }
    if (billingPeriodStart && billingPeriodEnd && billingPeriodStart > billingPeriodEnd) {
      return Response.json({ error: "Billing period start must not be after its end." }, { status: 400 });
    }
    const settings: AppSettings = {
      pricePerCredit, currency: nextCurrency, currentCreditBalance, unbilledOverageCredits,
      workspaceOverageLimitCredits, billingBudgetAmount, budgetAlertPercent,
      billingPeriodStart, billingPeriodEnd,
    };
    return Response.json(await saveAppSettings(settings));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save settings." }, { status: 500 });
  }
}
