import type { AppSettings } from "../app/types";

export function manualOverageValue(settings: AppSettings): number | null {
  return settings.unbilledOverageCredits === null || settings.pricePerCredit === null
    ? null : settings.unbilledOverageCredits * settings.pricePerCredit;
}
