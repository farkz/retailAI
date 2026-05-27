import { ApiClient } from './apiClient';
import { RaceCache } from './raceCache';
import { generateFingerprint, generateUUIDv7, formatDateTime } from './utils';
import { config } from '../config/env';

export interface SingleTicketResult {
  roundId: string;
  roundNumber: number;
  payinMode: 'Standard' | 'PerBet';
  betCount: number;
  picks: Array<{
    price: number;
    betType: string;
    betContent: string;
    roundId: string;
    roundNumber: number;
  }>;
  payinAmount: number;
  actionIds: string[];
  linkedId: string | null;
}

export interface TerminalPayinResult {
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  deposit1Amount: number;
  deposit2Amount: number;
  balanceAfterDeposit: number;
  creditTicketId?: string;
  tickets: SingleTicketResult[];
}

/**
 * Create a single race ticket using the terminal token and current round from cache.
 */
export async function createSingleTicket(
  apiClient: ApiClient,
  terminalToken: string,
  fingerprint: string,
  raceCache: RaceCache,
  currency: string
): Promise<SingleTicketResult> {
  const raceData = raceCache.getCurrentRound();

  const payinMode = Math.random() > 0.5 ? 'PerBet' : 'Standard';
  let betCount = Math.floor(Math.random() * 10) + 1;
  if (payinMode === 'PerBet' && betCount < 2) betCount = 2;
  if (payinMode === 'Standard' && betCount > 1) betCount = 1;

  const selectedPicks: Array<{
    Price: number;
    BetType: string;
    BetContent: string;
    RoundId: string;
    RoundNumber: number;
  }> = [];

  for (let i = 0; i < betCount; i++) {
    const randomIndex = Math.floor(Math.random() * raceData.picks.length);
    const pick = raceData.picks[randomIndex];
    selectedPicks.push({
      Price: pick.Price,
      BetType: pick.PickType,
      BetContent: pick.Result,
      RoundId: raceData.roundId,
      RoundNumber: raceData.roundNumber,
    });
  }

  let payinAmount = (Math.random() * 9) + 1;
  if (betCount > payinAmount) payinAmount = betCount * payinAmount;
  payinAmount = Math.round(payinAmount * 100) / 100;

  const actionIds: string[] = [];
  for (let i = 0; i < selectedPicks.length; i++) {
    actionIds.push(generateUUIDv7());
  }

  const linkedId = payinMode === 'PerBet' ? crypto.randomUUID() : null;

  const datetimePayin = formatDateTime();
  await apiClient.payin(terminalToken, fingerprint, {
    OfferGroupId: raceData.offerGroupId,
    Amount: payinAmount,
    CurrencyId: currency,
    ActionIds: actionIds,
    ActionCreatedDatetime: datetimePayin,
    TicketBets: selectedPicks,
    PayinType: 'None',
    PayinMode: payinMode,
  });

  return {
    roundId: raceData.roundId,
    roundNumber: raceData.roundNumber,
    payinMode,
    betCount,
    picks: selectedPicks.map(p => ({
      price: p.Price,
      betType: p.BetType,
      betContent: p.BetContent,
      roundId: p.RoundId,
      roundNumber: p.RoundNumber,
    })),
    payinAmount,
    actionIds,
    linkedId,
  };
}

/**
 * Full terminal flow: login, deposit, create N tickets.
 * Returns one result object per ticket created.
 */
export async function perTerminalMultiTicketFlow(
  apiClient: ApiClient,
  terminalId: string,
  raceCache: RaceCache,
  currency: string,
  ticketCount: number
): Promise<TerminalPayinResult> {
  const loginPin = await apiClient.addTerminalLoginPin(terminalId);
  const fingerprint = generateFingerprint();
  const terminalToken = await apiClient.terminalLogin(terminalId, fingerprint, loginPin);

  const idempotentKey1 = crypto.randomUUID();
  const datetime1 = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 100, idempotentKey1, datetime1);

  const state = await apiClient.getTerminalState(terminalToken, fingerprint);
  const balance = state.balance.accounts.find(
    (a: any) => a.creditType === 'VirtualMoney'
  )?.spendableAmount ?? 0;

  let creditTicketId: string | undefined;
  if (!config.phase2.skipCreditTicket) {
    try {
      const idempotentKeyCT = crypto.randomUUID();
      const datetimeCT = formatDateTime();
      await apiClient.createCreditTicketReservation(
        terminalToken, fingerprint, balance, idempotentKeyCT, currency, datetimeCT
      );
      await apiClient.createCreditTicketConfirmation(terminalToken, fingerprint, idempotentKeyCT);
      creditTicketId = idempotentKeyCT;
    } catch (e: any) {
      console.warn(`[CreditTicket] Skipped (endpoint unavailable): ${e?.message ?? e}`);
    }
  }

  const idempotentKey2 = crypto.randomUUID();
  const datetime2 = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 1000, idempotentKey2, datetime2);

  const tickets: SingleTicketResult[] = [];
  for (let i = 0; i < ticketCount; i++) {
    const ticket = await createSingleTicket(apiClient, terminalToken, fingerprint, raceCache, currency);
    tickets.push(ticket);
  }

  return {
    terminalId,
    loginSuccess: true,
    fingerprint,
    deposit1Amount: 100,
    deposit2Amount: 1000,
    balanceAfterDeposit: balance,
    creditTicketId,
    tickets,
  };
}
