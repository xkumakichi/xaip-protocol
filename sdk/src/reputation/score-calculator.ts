/**
 * XAIP Reputation Score Calculator
 *
 * Computes a 0-100 trust score from on-chain evidence.
 * The score is a weighted composite of 5 dimensions:
 *
 *   Trust = 0.30*Reliability + 0.25*Quality + 0.20*Consistency
 *         + 0.15*Volume + 0.10*Longevity
 *
 * All inputs come from verifiable on-chain data.
 * Nothing can be faked. Everything is earned.
 */

import {
  ReputationScore,
  ReputationWeights,
  DEFAULT_REPUTATION_WEIGHTS,
} from "../types";
import { AgentOnChainData } from "./data-collector";

export interface ScoreBreakdown {
  score: ReputationScore;
  explanation: {
    reliability: string;
    quality: string;
    consistency: string;
    volume: string;
    longevity: string;
    overall: string;
  };
}

export class ReputationScoreCalculator {
  private weights: ReputationWeights;

  constructor(weights?: Partial<ReputationWeights>) {
    this.weights = { ...DEFAULT_REPUTATION_WEIGHTS, ...weights };
  }

  /**
   * Calculate the full reputation score from on-chain data
   */
  calculate(data: AgentOnChainData): ScoreBreakdown {
    const reliability = this.calcReliability(data);
    const quality = this.calcQuality(data);
    const consistency = this.calcConsistency(data);
    const volume = this.calcVolume(data);
    const longevity = this.calcLongevity(data);

    const overall = Math.round(
      this.weights.reliability * reliability +
      this.weights.quality * quality +
      this.weights.consistency * consistency +
      this.weights.volume * volume +
      this.weights.longevity * longevity
    );

    const score: ReputationScore = {
      overall: Math.min(100, Math.max(0, overall)),
      reliability,
      quality,
      consistency,
      volume,
      longevity,
      totalTransactions: data.totalTransactions,
      totalEndorsements: data.endorsementsReceived,
      lastUpdated: new Date().toISOString(),
    };

    return {
      score,
      explanation: {
        reliability: this.explainReliability(data, reliability),
        quality: this.explainQuality(data, quality),
        consistency: this.explainConsistency(data, consistency),
        volume: this.explainVolume(data, volume),
        longevity: this.explainLongevity(data, longevity),
        overall: this.explainOverall(score),
      },
    };
  }

  /**
   * Reliability (30%): Does the agent complete what it starts?
   * Based on escrow completion rate.
   */
  private calcReliability(data: AgentOnChainData): number {
    const totalEscrows = data.escrowsFinished + data.escrowsCancelled;
    if (totalEscrows === 0) {
      // No escrow history - neutral score
      // Payment history can give a partial signal
      if (data.paymentsSent + data.paymentsReceived > 0) return 50;
      return 0;
    }

    const completionRate = data.escrowsFinished / totalEscrows;
    return Math.round(completionRate * 100);
  }

  /**
   * Quality (25%): How good is the agent's work?
   * Based on endorsements received relative to transactions.
   */
  private calcQuality(data: AgentOnChainData): number {
    if (data.totalTransactions === 0) return 0;

    // Endorsement rate: what % of interactions led to endorsements?
    const interactionCount = data.escrowsFinished + data.paymentsReceived;
    if (interactionCount === 0) return 0;

    const endorsementRate = Math.min(
      1,
      data.endorsementsReceived / interactionCount
    );

    // Also consider capability credentials as quality signal
    const capabilityBonus = Math.min(20, data.capabilityCredentials.length * 10);

    return Math.min(100, Math.round(endorsementRate * 80 + capabilityBonus));
  }

  /**
   * Consistency (20%): Does the agent behave predictably?
   * Based on activity regularity.
   */
  private calcConsistency(data: AgentOnChainData): number {
    if (data.activeDays <= 1) return 0;
    if (!data.firstActivityDate || !data.lastActivityDate) return 0;

    const totalDays = Math.max(
      1,
      (data.lastActivityDate.getTime() - data.firstActivityDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // What percentage of days was the agent active?
    const activityRatio = data.activeDays / totalDays;

    // Normalize: 50%+ activity rate = 100 consistency
    // This is generous because agents may not need to be active every day
    return Math.min(100, Math.round(activityRatio * 200));
  }

  /**
   * Volume (15%): How much experience does the agent have?
   * Logarithmic scale to prevent gaming by volume.
   */
  private calcVolume(data: AgentOnChainData): number {
    if (data.totalTransactions === 0) return 0;

    // log10 scale: 10 txs = 20, 100 txs = 40, 1000 txs = 60, etc.
    const logScore = Math.log10(data.totalTransactions) * 20;
    return Math.min(100, Math.round(logScore));
  }

  /**
   * Longevity (10%): How long has the agent been active?
   * Caps at 1 year for full score.
   */
  private calcLongevity(data: AgentOnChainData): number {
    if (!data.firstActivityDate) return 0;

    const now = new Date();
    const daysActive =
      (now.getTime() - data.firstActivityDate.getTime()) /
      (1000 * 60 * 60 * 24);

    // 365 days = 100 score
    return Math.min(100, Math.round((daysActive / 365) * 100));
  }

  // Explanation generators

  private explainReliability(data: AgentOnChainData, score: number): string {
    const total = data.escrowsFinished + data.escrowsCancelled;
    if (total === 0) return `No escrow history yet. Score: ${score}/100`;
    return `${data.escrowsFinished}/${total} escrows completed (${score}% success rate)`;
  }

  private explainQuality(data: AgentOnChainData, score: number): string {
    return `${data.endorsementsReceived} endorsements, ${data.capabilityCredentials.length} certified capabilities. Score: ${score}/100`;
  }

  private explainConsistency(data: AgentOnChainData, score: number): string {
    return `Active on ${data.activeDays} days. Score: ${score}/100`;
  }

  private explainVolume(data: AgentOnChainData, score: number): string {
    return `${data.totalTransactions} total transactions (log scale). Score: ${score}/100`;
  }

  private explainLongevity(data: AgentOnChainData, score: number): string {
    if (!data.firstActivityDate) return "No activity yet. Score: 0/100";
    const days = Math.round(
      (Date.now() - data.firstActivityDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return `Active for ${days} days. Score: ${score}/100`;
  }

  private explainOverall(score: ReputationScore): string {
    if (score.overall >= 80) return `Highly trusted agent (${score.overall}/100)`;
    if (score.overall >= 60) return `Trusted agent (${score.overall}/100)`;
    if (score.overall >= 40) return `Building trust (${score.overall}/100)`;
    if (score.overall >= 20) return `New agent (${score.overall}/100)`;
    return `Unverified agent (${score.overall}/100)`;
  }
}
