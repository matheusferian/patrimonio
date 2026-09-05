# Ferian Finance V2

Household financial operating system for variable-income families.

## Product goals

- Separate user accounts for Matheus and Lidyane under one household.
- Live account balances for checking, savings and credit cards.
- Variable-income tracking with conservative and probable forecasts.
- Safe-to-Spend decision engine.
- Credit-card recommendation using balance, utilization, statement close and due dates.
- Installment-plan tracking, including weekly set-asides for monthly charges.
- Planned-purchase decisions.
- Shared household view with scoped personal/business permissions.
- AI interface that can later be exposed through web chat, WhatsApp or other clients.

## Architecture direction

- Next.js web/PWA frontend.
- Supabase Auth + Postgres with tenant/household isolation and RLS.
- Server-side financial data adapters. No direct privileged database access from public browser code.
- Decision Engine as a reusable service independent of UI/channel.
- Existing Work Tracker remains untouched on `main` during migration.

## Core domain model

`households`, `profiles`, `household_members`, `financial_accounts`, `income_events`, `income_models`, `obligations`, `credit_cards`, `installment_plans`, `installment_funding_events`, `planned_purchases`, `decision_requests`, `decision_results`.

## Delivery phases

1. Command Center shell and decision formulas.
2. Auth + household tenancy + RLS.
3. Migrate existing Work Tracker income and bills.
4. Financial account adapter and live balance snapshot layer.
5. Installment plans and weekly funding controls.
6. Safe-to-Spend and purchase decision engine.
7. Lidyane household access.
8. AI chat.
9. WhatsApp channel after core behavior is stable.

## Safety rule

The old production system is preserved in branch `backup-pre-finance-v2-2026-09-05`. Development happens in `finance-v2` until explicitly approved for production.
