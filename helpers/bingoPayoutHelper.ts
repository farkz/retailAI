import { ApiClient } from './apiClient';
import { generateFingerprint, generateUUIDv7, formatDateTime } from './utils';

export interface SingleBingoPayoutResult {
  ticketId: string;
  userId: string;
  winAmount: number;
  payinAmount: number;
  pin: string;
  taxNumber: string | null;
  actionId: string;
  success: boolean;
  error?: string;
}

export interface TerminalBingoPayoutResult {
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  depositAmount: number;
  cashPayoutEnabled: boolean;
  payouts: SingleBingoPayoutResult[];
}

/**
 * Full bingo payout flow for one terminal:
 *  1. Login (PIN + fingerprint + token)
 *  2. Deposit 200
 *  3. SetCashPayoutOption (enable cash payout via BO token)
 *  4. For each won ticket: GetPin → GetByPin_v2 (TaxNumber) → PayOut
 *
 * All integration API calls target virtualBingoApiUrl (not virtualRaceApiUrl).
 */
export async function perTerminalBingoPayoutFlow(
  apiClient: ApiClient,
  terminalId: string,
  wonTickets: Array<{
    id: string;
    user_id: string;
    win_amount: number;
    amount: number;
  }>
): Promise<TerminalBingoPayoutResult> {
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
    console.warn(`[BingoCashPayout] SetCashPayoutOption failed (non-fatal): ${e?.message ?? e}`);
  }

  const payouts: SingleBingoPayoutResult[] = [];

  for (const ticket of wonTickets) {
    const winAmount   = parseFloat(String(ticket.win_amount ?? 0));
    const payinAmount = parseFloat(String(ticket.amount ?? 0));

    const result: SingleBingoPayoutResult = {
      ticketId: ticket.id,
      userId: ticket.user_id,
      winAmount,
      payinAmount,
      pin: '',
      taxNumber: null,
      actionId: '',
      success: false,
    };

    try {
      const pin = await apiClient.getBingoTicketPin(ticket.user_id, ticket.id);
      result.pin = pin;

      let taxNumber: string | null = null;
      try {
        const byPin = await apiClient.getBingoTicketByPin(pin);
        taxNumber = byPin?.Tickets?.[0]?.GovernmentInfo?.costCenterTaxNumber
          ?? byPin?.Tickets?.GovernmentInfo?.costCenterTaxNumber?.[0]
          ?? null;
      } catch (e: any) {
        console.warn(`[BingoGetByPin] Failed for ticket ${ticket.id} (non-fatal): ${e?.message ?? e}`);
      }
      result.taxNumber = taxNumber;

      const actionId = generateUUIDv7();
      result.actionId = actionId;
      const payoutDatetime = formatDateTime();

      await apiClient.bingoTicketPayout(terminalToken, fingerprint, {
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
      console.error(`[BingoPayout] Failed for ticket ${ticket.id}: ${result.error}`);
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
