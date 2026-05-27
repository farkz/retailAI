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
        this.picks = JSON.parse(round.details).Picks;
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
    if (!this.offerGroupId || !this.roundId) {
      throw new Error('RaceCache not initialized - call init() first');
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
