export type CashPosition = {
  liquidCash: number;
  protectedReserve: number;
  obligations14d: number;
  conservativeIncome14d: number;
};

export type InstallmentPlan = {
  name: string;
  weeklySetAside: number;
  monthlyCharge: number;
  remainingBalance?: number;
  cardLabel?: string;
};

export function safeToSpend(position: CashPosition) {
  return Math.max(
    0,
    position.liquidCash + position.conservativeIncome14d - position.obligations14d - position.protectedReserve,
  );
}

export function weeklyFundingStatus(plan: InstallmentPlan, weeksFunded: number) {
  const funded = plan.weeklySetAside * weeksFunded;
  return {
    funded,
    monthlyTarget: plan.monthlyCharge,
    covered: funded >= plan.monthlyCharge,
    gap: Math.max(0, plan.monthlyCharge - funded),
  };
}
