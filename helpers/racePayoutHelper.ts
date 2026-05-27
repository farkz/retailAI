import { ApiClient } from './apiClient';
import { generateFingerprint, generateUUIDv7, formatDateTime } from './utils';
import dbClient from './dbClient';

export interface SinglePayoutResult {
  ticketId: string;
  userId: string;
  winAmount: number;
  pin: string;
  taxNumber: string | null;
  actionId: string;
  success: boolean;
  error?: string;
}

export interface TerminalPayoutResult {
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  depositAmount: number;
  cashPayoutEnabled: boolean;
  payouts: SinglePayoutResult[];
}

/**
 * Full payout flow for one terminal:
 *  1. Login (PIN + fingerprint + token)
 *  2. Deposit 200
 *  3. SetCashPayoutOption (enable cash payout via BO token)
 *  4. For each won ticket: GetPin → GetByPin_v2 (TaxNumber) → PayOut
 */
export async function perTerminalPayoutFlow(
  apiClient: ApiClient,
  terminalId: string,
  wonTickets: Array<{ id: string; user_id: string; win_amount: number; jackpot_win_amount: number }>
): Promise<TerminalPayoutResult> {
  const loginPin = await apiClient.addTerminalLoginPin(terminalId);
  const fingerprint = generateFingerprint();
  const terminalToken = await apiClient.terminalLogin(terminalId, fingerprint, loginPin);

  const idempotentKey = crypto.randomUUID();
  const datetime = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 200, idempotentKey, datetime);

  let cashPayoutEnabled = false;
  try {
    await apiClient.setCashPayoutOption(terminalId);
    cashPayoutEnabled = true;
  } catch (e: any) {
    console.warn(`[CashPayout] SetCashPayoutOption failed (non-fatal): ${e?.message ?? e}`);
  }

  const payouts: SinglePayoutResult[] = [];

  for (const ticket of wonTickets) {
    const winAmount = parseFloat(String(
      ticket.win_amount > 0 ? ticket.win_amount : ticket.jackpot_win_amount
    ));
    const result: SinglePayoutResult = {
      ticketId: ticket.id,
      userId: ticket.user_id,
      winAmount,
      pin: '',
      taxNumber: null,
      actionId: '',
      success: false,
    };

    try {
      const pin = await apiClient.getTicketPin(ticket.user_id, ticket.id);
      result.pin = pin;

      let taxNumber: string | null = null;
      try {
        const byPin = await apiClient.getTicketByPin(pin);
        taxNumber = byPin?.Tickets?.[0]?.GovernmentInfo?.costCenterTaxNumber
          ?? byPin?.Tickets?.GovernmentInfo?.costCenterTaxNumber?.[0]
          ?? null;
      } catch (e: any) {
        console.warn(`[GetByPin] Failed for ticket ${ticket.id} (non-fatal): ${e?.message ?? e}`);
      }
      result.taxNumber = taxNumber;

      const actionId = generateUUIDv7();
      result.actionId = actionId;
      const payoutDatetime = formatDateTime();

      await apiClient.payout(terminalToken, fingerprint, {
        ActionCreatedDatetime: payoutDatetime,
        ActionId: actionId,
        TicketId: ticket.id,
        TicketUserId: ticket.user_id,
        ValidationExtraInfo: {
          PayoutAmount: winAmount,
          Pin: pin,
          TaxAmount: 0,
          TaxNumber: taxNumber,
          Context: 'virtualrace',
          TicketId: ticket.id,
          UserId: ticket.user_id,
          PaidOutByClientId: ticket.user_id,
        },
      });

      result.success = true;
    } catch (e: any) {
      result.error = e?.message ?? String(e);
      console.error(`[Payout] Failed for ticket ${ticket.id}: ${result.error}`);
    }

    payouts.push(result);
  }

  return {
    terminalId,
    loginSuccess: true,
    fingerprint,
    depositAmount: 200,
    cashPayoutEnabled,
    payouts,
  };
}
