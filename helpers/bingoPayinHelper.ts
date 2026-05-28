import { ApiClient } from './apiClient';
import { BingoCache } from './bingoCache';
import dbClient from './dbClient';
import { generateFingerprint, generateUUIDv7, formatDateTime } from './utils';
import { config } from '../config/env';

const BET_TYPES = [
  'BallNumbers',
  'FirstBallUnderOver',
  'LastBallUnderOver',
  'FirstBallEvenOdd',
  'LastBallEvenOdd',
  'SumOfFirstFiveUnderOver',
  'FirstBallColor',
  'LastBallColor',
  'FirstDrawnNumber',
  'LastDrawnNumber',
  'FirstOrLastDrawnNumber',
] as const;

type BetType = typeof BET_TYPES[number];

const COLORS = ['red', 'blue', 'green', 'yellow', 'brown', 'orange', 'black', 'purple'];

function getNumbers(): number[] {
  const nums: number[] = [];
  for (let i = 1; i <= 48; i++) nums.push(i);
  return nums;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSome<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function generateBetContent(betType: BetType): string {
  switch (betType) {
    case 'BallNumbers':
      return pickSome(getNumbers(), 6).join(',');
    case 'FirstBallUnderOver':
    case 'LastBallUnderOver':
    case 'SumOfFirstFiveUnderOver':
      return pickOne(['under', 'over']);
    case 'FirstBallEvenOdd':
    case 'LastBallEvenOdd':
      return pickOne(['even', 'odd']);
    case 'FirstBallColor':
    case 'LastBallColor':
      return pickSome(COLORS, 4).join(',');
    case 'FirstDrawnNumber':
    case 'LastDrawnNumber':
    case 'FirstOrLastDrawnNumber':
      return String(pickOne(getNumbers()));
    default:
      return '';
  }
}

export interface SingleBingoTicketResult {
  roundId: string;
  roundNumber: number;
  payinMode: string;
  betType: string;
  betContent: string;
  amount: number;
  actionId: string;
  linkedId: string;
  status: 'confirmed' | 'failed' | 'timeout';
  failReason: string | null;
  pollingAttempts: number;
}

export interface TerminalBingoResult {
  terminalId: string;
  locationId: string;
  loginSuccess: boolean;
  fingerprint: string;
  depositAmount: number;
  tickets: SingleBingoTicketResult[];
}

async function pollBingoTicket(
  apiClient: ApiClient,
  terminalToken: string,
  fingerprint: string,
  actionId: string,
  pollTimeoutMs: number
): Promise<{ success: boolean; failReason: string | null; attempts: number }> {
  const deadline = Date.now() + pollTimeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    let resp: any;
    try {
      resp = await apiClient.getBingoTicketByActionId(terminalToken, fingerprint, actionId);
    } catch (e: any) {
      console.warn(`[BingoPoll] GetByActionId error (attempt ${attempts}): ${e?.message ?? e}`);
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const responseAction: string | undefined =
      resp?.ResponseAction ?? resp?.responseAction;

    if (!responseAction || responseAction === 'RepeatRequest') {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    if (responseAction === 'DeleteRequest') {
      return { success: false, failReason: 'DeleteRequest', attempts };
    }

    if (responseAction === 'StartPrinting') {
      const ticket = resp?.Ticket ?? resp?.ticket;
      const status: string | undefined = ticket?.Status ?? ticket?.status;
      if (status !== 'BillingPending') {
        return { success: false, failReason: `WrongStatus:${status ?? 'unknown'}`, attempts };
      }
      return { success: true, failReason: null, attempts };
    }

    return { success: false, failReason: `UnknownAction:${responseAction}`, attempts };
  }

  return { success: false, failReason: 'Timeout', attempts };
}

export async function createSingleBingoTicket(
  apiClient: ApiClient,
  terminalToken: string,
  fingerprint: string,
  bingoCache: BingoCache,
  locationId: string,
  currency: string,
  minPayin: number
): Promise<SingleBingoTicketResult> {
  // Refresh round from DB immediately before each payin so we always
  // use the currently active round, not a cached stale one.
  await bingoCache.refresh();
  const bingoData = bingoCache.getCurrentRound();
  const payinMode = config.phase4.payinMode;
  const pollTimeoutMs = config.phase4.pollTimeoutMs;

  const betType = pickOne([...BET_TYPES]) as BetType;
  const betContent = generateBetContent(betType);

  const actionId = generateUUIDv7();
  const linkedId = crypto.randomUUID();

  const rawAmount = (Math.random() * 9) + 1.5;
  const amount = Math.max(Math.round(rawAmount * 100) / 100, minPayin);

  const payinPayload = {
    Amount: amount,
    LocationId: locationId,
    CurrencyId: currency,
    ActionCreatedDatetime: formatDateTime(),
    TicketBets: [
      {
        BetType: betType,
        BetContent: betContent,
        RoundId: bingoData.roundId,
        RoundNumber: bingoData.roundNumber,
      },
    ],
    ClientId: locationId,
    ClientType: 'TerminalConsumer',
    OfferGroupId: bingoData.offerGroupId,
    PayInType: 'None',
    PayinMode: payinMode,
    LinkedId: linkedId,
    ActionIds: [actionId],
  };

  console.log(`[BingoPayin] BetType=${betType} BetContent=${betContent} Amount=${amount} Round=${bingoData.roundNumber}`);
  await apiClient.bingoPayin(terminalToken, fingerprint, payinPayload);

  console.log(`[BingoPoll] Polling for actionId=${actionId}…`);
  const pollResult = await pollBingoTicket(
    apiClient, terminalToken, fingerprint, actionId, pollTimeoutMs
  );

  console.log(`[BingoPoll] done — success=${pollResult.success} reason=${pollResult.failReason ?? 'OK'} attempts=${pollResult.attempts}`);

  if (!pollResult.success) {
    return {
      roundId: bingoData.roundId,
      roundNumber: bingoData.roundNumber,
      payinMode,
      betType,
      betContent,
      amount,
      actionId,
      linkedId,
      status: pollResult.failReason === 'Timeout' ? 'timeout' : 'failed',
      failReason: pollResult.failReason,
      pollingAttempts: pollResult.attempts,
    };
  }

  await new Promise(r => setTimeout(r, 2000));

  const confirmDatetime = formatDateTime();
  console.log(`[BingoConfirm] ConfirmTicketPurchase actionId=${actionId}`);
  await apiClient.confirmBingoTicket(terminalToken, fingerprint, actionId, linkedId, confirmDatetime);

  return {
    roundId: bingoData.roundId,
    roundNumber: bingoData.roundNumber,
    payinMode,
    betType,
    betContent,
    amount,
    actionId,
    linkedId,
    status: 'confirmed',
    failReason: null,
    pollingAttempts: pollResult.attempts,
  };
}

export async function perTerminalBingoFlow(
  apiClient: ApiClient,
  terminalId: string,
  costCenterId: string,
  bingoCache: BingoCache,
  currency: string,
  ticketCount: number,
  minPayin: number
): Promise<TerminalBingoResult> {
  const loginPin = await apiClient.addTerminalLoginPin(terminalId);
  const fingerprint = generateFingerprint();
  const terminalToken = await apiClient.terminalLogin(terminalId, fingerprint, loginPin);

  const idempotentKey = crypto.randomUUID();
  const datetime = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 100, idempotentKey, datetime);

  await new Promise(r => setTimeout(r, 2000));

  const tickets: SingleBingoTicketResult[] = [];
  for (let i = 0; i < ticketCount; i++) {
    console.log(`\n[BingoFlow] Terminal ${terminalId} — ticket ${i + 1}/${ticketCount}`);
    try {
      const ticket = await createSingleBingoTicket(
        apiClient, terminalToken, fingerprint, bingoCache,
        costCenterId, currency, minPayin
      );
      tickets.push(ticket);
    } catch (e: any) {
      console.warn(`[BingoFlow] Ticket ${i + 1} threw: ${e?.message ?? e}`);
      tickets.push({
        roundId: '',
        roundNumber: 0,
        payinMode: config.phase4.payinMode,
        betType: '',
        betContent: '',
        amount: 0,
        actionId: '',
        linkedId: '',
        status: 'failed',
        failReason: e?.message ?? String(e),
        pollingAttempts: 0,
      });
    }
  }

  return {
    terminalId,
    locationId: costCenterId,
    loginSuccess: true,
    fingerprint,
    depositAmount: 100,
    tickets,
  };
}
