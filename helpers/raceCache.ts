import { ApiClient } from './apiClient';
import dbClient from './dbClient';
import { config } from '../config/env';

/**
 * Live cache for race data. Offer group is fetched once permanently.
 * Round refreshes in background based on WaitForNewRoundDuration.
 */
export class RaceCache {
  private offerGroupId: string | null = null;
  private roundId: string | null = null;
  private roundNumber: number = 0;
  private picks: Array<{ Price: number; PickType: string; Result: string }> = [];
  private refreshTimer: NodeJS.Timeout | null = null;
  private waitForNewRoundDurationMs: number = 60000;

  constructor(
    private apiClient: ApiClient,
    private franchiseId: string,
    private boToken: string
  ) {}

  async init(): Promise<void> {
    this.offerGroupId = await this.apiClient.getOfferGroups(this.franchiseId, this.boToken);

    const og = await dbClient.getVirtualRaceOfferGroup(this.offerGroupId);
    this.waitForNewRoundDurationMs = (og?.waitForNewRoundDuration ?? 60) * 1000;

    await this.refreshRound();

    const intervalMs = Math.max(this.waitForNewRoundDurationMs - 5000, 10000);
    this.refreshTimer = setInterval(() => this.refreshRound(), intervalMs);
  }

  private async refreshRound(): Promise<void> {
    try {
      const round = await dbClient.getNextUnprocessedRound(
        this.offerGroupId!,
        config.tenantId
      );
      if (round && round.id !== this.roundId) {
        this.roundId = round.id;
        this.roundNumber = round.number;
        const details = typeof round.details === 'string' ? JSON.parse(round.details) : round.details;
        this.picks = details?.Picks ?? details?.picks ?? [];
        console.log(`[RaceCache] New round: ${this.roundId} (#${this.roundNumber})`);
      }
    } catch (e: any) {
      console.warn('[RaceCache] Round refresh failed:', e?.message ?? e);
    }
  }

  getCurrentRound(): {
    offerGroupId: string;
    roundId: string;
    roundNumber: number;
    picks: Array<{ Price: number; PickType: string; Result: string }>;
  } {
    if (!this.offerGroupId) {
      throw new Error('RaceCache not initialized - call init() first');
    }
    if (!this.roundId) {
      throw new Error(
        `RaceCache has no current round for offerGroup ${this.offerGroupId}. ` +
        `This means the DB is unavailable or has no unprocessed rounds in virtualrace.round. ` +
        `Check DATABASE_URL is set and the DB has pending rounds.`
      );
    }
    return {
      offerGroupId: this.offerGroupId,
      roundId: this.roundId,
      roundNumber: this.roundNumber,
      picks: this.picks,
    };
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
