import { ApiClient } from './apiClient';
import dbClient from './dbClient';

export class BingoCache {
  private offerGroupId: string | null = null;
  private roundId: string | null = null;
  private roundNumber: number = 0;
  private refreshTimer: NodeJS.Timeout | null = null;
  private waitForNewRoundDurationMs: number = 60000;

  constructor(
    private apiClient: ApiClient,
    private franchiseId: string,
    private boToken: string
  ) {}

  async init(): Promise<void> {
    this.offerGroupId = await this.apiClient.getBingoOfferGroupId(this.franchiseId, this.boToken);

    const og = await dbClient.getVirtualBingoOfferGroup(this.offerGroupId);
    this.waitForNewRoundDurationMs = (og?.wait_for_new_round_duration ?? 60) * 1000;

    await this.refreshRound();

    const intervalMs = Math.max(this.waitForNewRoundDurationMs - 5000, 10000);
    this.refreshTimer = setInterval(() => this.refreshRound(), intervalMs);
  }

  private async refreshRound(): Promise<void> {
    try {
      const round = await dbClient.getNextUnprocessedBingoRound(this.offerGroupId!);
      if (round && round.id !== this.roundId) {
        this.roundId = round.id;
        this.roundNumber = round.number;
        console.log(`[BingoCache] New round: ${this.roundId} (#${this.roundNumber})`);
      }
    } catch (e: any) {
      console.warn('[BingoCache] Round refresh failed:', e?.message ?? e);
    }
  }

  getCurrentRound(): {
    offerGroupId: string;
    roundId: string;
    roundNumber: number;
  } {
    if (!this.offerGroupId) {
      throw new Error('BingoCache not initialized — call init() first');
    }
    if (!this.roundId) {
      throw new Error(
        `BingoCache has no current round for offerGroup ${this.offerGroupId}. ` +
        `Check DATABASE_URL is set and virtualbingo.round has unprocessed rows.`
      );
    }
    return {
      offerGroupId: this.offerGroupId,
      roundId: this.roundId,
      roundNumber: this.roundNumber,
    };
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
