import { ApiClient } from './apiClient';
import { generateFingerprint, generateUUIDv7, formatDateTime } from './utils';
import { config } from '../config/env';
import dbClient from './dbClient';

export interface SportEvent {
  eventId: string;
  linkedId: string;
  providerId: string;
  marketId: string;
  eventMarketBetId: string;
  eventMarketBetName: string | null;
  eventMarketBetPrice: number;
  marketName: string;
  eventMarketBetBaseLine: string | null;
  isLive: boolean;
  leagueId: string;
}

export interface SingleSportTicketResult {
  actionId: string;
  betAmount: number;
  currency: string;
  event: SportEvent;
  status: string;
  settled: boolean;
  settleStatus: string;
  error?: string;
}

export interface TerminalSportPayinResult {
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  deposit1Amount: number;
  deposit2Amount: number;
  tickets: SingleSportTicketResult[];
}

/**
 * Fetch a usable random sport event from the data provider.
 * Retries up to maxAttempts times, filtering out events with bad markets.
 */
async function getValidRandomEvent(
  apiClient: ApiClient,
  terminalToken: string,
  fingerprint: string,
  maxAttempts = 15
): Promise<SportEvent[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const events: SportEvent[] = await apiClient.getSportRandomEvent(terminalToken, fingerprint);

    if (!Array.isArray(events) || events.length === 0) {
      console.warn(`[SportEvent] Attempt ${attempt + 1}: no events returned, retrying...`);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    const firstMarketName = events[0]?.marketName ?? '';
    const firstBetId = events[0]?.eventMarketBetId ?? '';

    if (
      firstMarketName === 'Draw no bet' ||
      firstMarketName.includes('{') ||
      firstBetId === 'NotFoundEventMarketBetId' ||
      !firstBetId
    ) {
      console.warn(`[SportEvent] Attempt ${attempt + 1}: bad market (${firstMarketName}), retrying...`);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    console.log(`[SportEvent] Got ${events.length} event(s), marketName=${firstMarketName}`);
    return events;
  }
  throw new Error(`[SportEvent] Could not get a valid event after ${maxAttempts} attempts`);
}

/**
 * Poll sport.ticket in DB until status is no longer pending.
 * Returns the final status string.
 */
async function pollSportTicketStatus(
  apiClient: ApiClient,
  ticketId: string,
  timeoutMs: number,
  intervalMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await dbClient.getSportTicketStatus(ticketId);
    const status = row?.status ?? 'Unknown';
    console.log(`[SportPoll] ticket=${ticketId} status=${status}`);

    if (status === 'AuthorizationPending') {
      console.log(`[SportPoll] Authorizing ticket ${ticketId}...`);
      try {
        await apiClient.authorizeTicket(ticketId);
      } catch (e: any) {
        console.warn(`[SportPoll] AuthorizeTicket error (non-fatal): ${e?.message ?? e}`);
      }
    }

    if (['Created', 'NotProcessed'].includes(status)) {
      return status;
    }

    if (status === 'Rejected') {
      return 'Rejected';
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
  console.warn(`[SportPoll] Timeout waiting for ticket ${ticketId}`);
  return 'Timeout';
}

/**
 * Create a single sport ticket: fetch event, payin, poll, settle via ManualProcessing.
 */
export async function createSingleSportTicket(
  apiClient: ApiClient,
  terminalToken: string,
  fingerprint: string,
  terminalId: string,
  currency: string
): Promise<SingleSportTicketResult> {
  const { minBetAmount, maxBetAmount, settleStatus, pollTimeoutMs, pollIntervalMs } = config.phase6;

  const betAmount = Math.round((Math.random() * (maxBetAmount - minBetAmount) + minBetAmount) * 100) / 100;
  const actionId = generateUUIDv7();
  const datetimeNow = formatDateTime();
  const datetimePlusOne = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const events = await getValidRandomEvent(apiClient, terminalToken, fingerprint);
  const event = events[Math.floor(Math.random() * events.length)] as SportEvent;

  const result: SingleSportTicketResult = {
    actionId,
    betAmount,
    currency,
    event,
    status: 'Pending',
    settled: false,
    settleStatus,
  };

  try {
    await apiClient.sportPayin(terminalToken, fingerprint, {
      ActionId: actionId,
      Amount: betAmount,
      acceptPriceChanges: true,
      TicketBets: events,
      ClientFingerprint: null,
      Systems: null,
      Currency3LetterId: currency,
      ActionCreatedDatetime: datetimePlusOne,
    });
    console.log(`[SportPayin] Placed ticket actionId=${actionId} amount=${betAmount}`);

    const ticketStatus = await pollSportTicketStatus(apiClient, actionId, pollTimeoutMs, pollIntervalMs);
    result.status = ticketStatus;

    if (ticketStatus === 'Rejected') {
      result.error = 'Ticket was rejected by the system';
      return result;
    }

    if (ticketStatus === 'Timeout') {
      result.error = 'Timed out waiting for ticket status';
      return result;
    }

    await new Promise(r => setTimeout(r, 1000));

    const manualActionId = generateUUIDv7();
    await apiClient.manualProcessSportTicket({
      actionId: manualActionId,
      actionCreatedDatetime: datetimeNow,
      ticketId: actionId,
      userId: terminalId,
      providerId: event.providerId,
      linkedId: event.linkedId,
      marketId: event.marketId,
      marketBetId: event.eventMarketBetId,
      marketBetName: event.eventMarketBetName ?? '',
      oldTicketBetStatus: 'NotProcessed',
      newTicketBetStatus: settleStatus,
      baseLine: event.eventMarketBetBaseLine ?? null,
    });
    console.log(`[SportSettle] ticket=${actionId} → ${settleStatus}`);
    result.settled = true;
    result.status = settleStatus;
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    console.error(`[SportPayin] Failed for actionId=${actionId}: ${result.error}`);
  }

  return result;
}

/**
 * Full terminal flow: login → deposit → N sport tickets.
 */
export async function perTerminalSportPayinFlow(
  apiClient: ApiClient,
  terminalId: string,
  currency: string,
  ticketCount: number
): Promise<TerminalSportPayinResult> {
  const loginPin = await apiClient.addTerminalLoginPin(terminalId);
  const fingerprint = generateFingerprint();
  const terminalToken = await apiClient.terminalLogin(terminalId, fingerprint, loginPin);

  const key1 = generateUUIDv7();
  const dt1 = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 100, key1, dt1);

  const key2 = generateUUIDv7();
  const dt2 = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 1000, key2, dt2);

  const tickets: SingleSportTicketResult[] = [];

  for (let i = 0; i < ticketCount; i++) {
    console.log(`\n[Sport] Terminal ${terminalId} — ticket ${i + 1}/${ticketCount}`);
    const ticket = await createSingleSportTicket(apiClient, terminalToken, fingerprint, terminalId, currency);
    tickets.push(ticket);
    await new Promise(r => setTimeout(r, 500));
  }

  return {
    terminalId,
    loginSuccess: true,
    fingerprint,
    deposit1Amount: 100,
    deposit2Amount: 1000,
    tickets,
  };
}
