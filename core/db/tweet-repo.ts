import { Tweet } from '../../generated/prisma/client';
import { createEnhancedLogger } from '../../utils/logger';
import { prisma } from './prisma';

const logger = createEnhancedLogger('TweetRepo');

export class TweetRepository {
  /**
   * Validate if a jobId exists in the database
   */
  private static async validateJobId(jobId: string | undefined): Promise<string | undefined> {
    if (!jobId) return undefined;

    try {
      // Relaxed validation: Allow any string ID (BullMQ IDs might be "1", "2", etc.)
      // We will check if it exists in the DB. If the DB schema enforces UUID, the findUnique will simply fail or return null.
      if (!jobId || typeof jobId !== 'string') {
        return undefined;
      }

      // Verify the job exists in the database
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true },
      });

      if (!job) {
        logger.debug(`Job ${jobId} not found in database, saving tweet without job association`);
        return undefined;
      }

      return jobId;
    } catch (error) {
      logger.warn(`Failed to validate jobId ${jobId}`, { error });
      return undefined;
    }
  }

  /**
   * Save a single tweet
   */
  static async saveTweet(data: {
    tweet: any; // Raw tweet object from scraper
    jobId?: string;
  }): Promise<Tweet | null> {
    try {
      const { tweet, jobId } = data;

      // Map scraper tweet format to DB format
      // Assuming tweet matches the Tweet interface in types.ts
      const tweetId = tweet.id || tweet.rest_id;

      if (!tweetId) {
        logger.warn('Cannot save tweet without ID', { tweet });
        return null;
      }

      // Validate jobId exists in DB before using it (prevents FK violations)
      const validatedJobId = await TweetRepository.validateJobId(jobId);

      return await prisma.tweet.upsert({
        where: { id: tweetId },
        update: {
          jobId: validatedJobId, // Only set if job exists in DB
          scrapedAt: new Date(),
          metrics: tweet.metrics || {},
          // Don't overwrite creation time or static data if not needed
        },
        create: {
          id: tweetId,
          jobId: validatedJobId,
          text: tweet.text || tweet.full_text,
          username:
            tweet.username || tweet.core?.user_results?.result?.legacy?.screen_name || 'unknown',
          userId: tweet.userId || tweet.core?.user_results?.result?.rest_id,
          createdAt: tweet.createdAt ? new Date(tweet.createdAt) : new Date(),
          scrapedAt: new Date(),
          metrics: tweet.metrics || {},
          media: tweet.media || [],
          raw: tweet as any,
        },
      });
    } catch (error: any) {
      logger.error(`Failed to save tweet ${data.tweet?.id}`, error);
      return null;
    }
  }

  /**
   * Save multiple tweets in batch
   */
  static async saveTweets(data: { tweets: any[]; jobId?: string }): Promise<number> {
    let savedCount = 0;
    // Prisma doesn't support "upsertMany" natively in a simple way for all DBs,
    // but for Postgres we could use createMany with skipDuplicates,
    // BUT we want to update existing ones (e.g. metrics).
    // So we'll iterate for now, or use a transaction.
    // Given the volume (hundreds), iteration is acceptable for now.
    // Optimization: Use Promise.all with concurrency limit if needed.

    const { tweets, jobId } = data;

    // Process in chunks to avoid overwhelming DB connection pool
    const chunkSize = 50;
    for (let i = 0; i < tweets.length; i += chunkSize) {
      const chunk = tweets.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (tweet) => {
          const result = await TweetRepository.saveTweet({ tweet, jobId });
          if (result) savedCount++;
        }),
      );
    }

    return savedCount;
  }

  /**
   * Check if tweets exist
   */
  static async getExistingIds(ids: string[]): Promise<Set<string>> {
    const found = await prisma.tweet.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(found.map((t) => t.id));
  }
}
