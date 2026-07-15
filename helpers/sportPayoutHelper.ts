import { ApiClient } from './apiClient';
import { generateFingerprint, generateUUIDv7, formatDateTime } from './utils';
import { config } from '../config/env';
import dbClient from './dbClient';

export interface SingleSportPayoutResult {
  ticketId: string;
  userId: string;
  winAmount: number;
  payinAmount: number;
  winTaxAmount: number;
  pin: string;
  actionId: string;
  success: boolean;
  error?: string;
}

export interface TerminalSportPayoutResult {
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  depositAmount: number;
  cashPayoutEnabled: boolean;
  payouts: SingleSportPayoutResult[];
}

/**
 * Full sport payout flow for one terminal:
 *  1. Login (PIN + fingerprint)
 *  2. Deposit 200
 *  3. SetCashPayoutOption (BO token)
 *  4. For each won ticket:
 *       GetSportTicketPin (BO token) → SportTicketPayout (terminal token) → PlayerWithdraw
 */
export async function perTerminalSportPayoutFlow(
  apiClient: ApiClient,
  terminalId: string,
  wonTickets: Array<{
    id: string;
    user_id: string;
    win_amount: number | null;
    win_tax_amount: number | null;
    amount: number;
  }>
): Promise<TerminalSportPayoutResult> {
  const loginPin = await apiClient.addTerminalLoginPin(terminalId);
  const fingerprint = generateFingerprint();
  const terminalToken = await apiClient.terminalLogin(terminalId, fingerprint, loginPin);

  const idempotentKey = generateUUIDv7();
  const datetime = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 200, idempotentKey, datetime);

  let cashPayoutEnabled = false;
  try {
    await apiClient.setCashPayoutOption(terminalId);
    cashPayoutEnabled = true;
  } catch (e: any) {
    console.warn(`[SportCashPayout] SetCashPayoutOption failed (non-fatal): ${e?.message ?? e}`);
  }

  const payouts: SingleSportPayoutResult[] = [];

  for (const ticket of wonTickets) {
    const winAmount = parseFloat(String(ticket.win_amount ?? ticket.amount ?? 0));
    const payinAmount = parseFloat(String(ticket.amount ?? 0));
    const winTaxAmount = parseFloat(String(ticket.win_tax_amount ?? 0));

    const result: SingleSportPayoutResult = {
      ticketId: ticket.id,
      userId: ticket.user_id,
      winAmount,
      payinAmount,
      winTaxAmount,
      pin: '',
      actionId: '',
      success: false,
    };

    try {
      const pin = await apiClient.getSportTicketPin(ticket.user_id, ticket.id);
      result.pin = pin;

      const actionId = generateUUIDv7();
      result.actionId = actionId;
      const payoutDatetime = formatDateTime();

      await apiClient.sportTicketPayout(terminalToken, fingerprint, {
        actionCreatedDatetime: payoutDatetime,
        actionId,
        ticketId: ticket.id,
        ticketUserId: ticket.user_id,
        context: 'sport',
        validationExtraInfo: {
          payoutAmount: winAmount,
          pin,
          TaxAmount: winTaxAmount,
          cnp: config.phase6.defaultCnp,
          ticketId: ticket.id,
        },
      });
      console.log(`[SportPayout] ticket=${ticket.id} amount=${winAmount} OK`);

      try {
        const withdrawKey = generateUUIDv7();
        await apiClient.playerWithdraw(terminalToken, fingerprint, withdrawKey, ticket.user_id.includes('EUR') ? 'EUR' : 'EUR');
        console.log(`[SportWithdraw] ticket=${ticket.id} cash withdrawn`);
      } catch (e: any) {
        console.warn(`[SportWithdraw] Withdraw failed (non-fatal): ${e?.message ?? e}`);
      }

      result.success = true;
    } catch (e: any) {
      result.error = e?.message ?? String(e);
      console.error(`[SportPayout] Failed for ticket ${ticket.id}: ${result.error}`);
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
