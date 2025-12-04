import { prisma } from './prisma';
import { Tweet } from '../../generated/prisma/client';
import { createEnhancedLogger } from '../../utils/logger';

const logger = createEnhancedLogger('TweetRepo');

export class TweetRepository {
  /**
   * Validate if a jobId exists in the database
   */
  private static async validateJobId(jobId: string | undefined): Promise<string | undefined> {
    if (!jobId) return undefined;
    
    try {
      // Check if this is a valid UUID (DB job ID) vs a BullMQ queue ID
      // BullMQ IDs typically look like: "profile-1701234567890-abc123"
      // DB UUIDs look like: "550e8400-e29b-41d4-a716-446655440000"
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      if (!uuidRegex.test(jobId)) {
        // Not a UUID, likely a BullMQ queue ID - don't use it for DB
        logger.debug(`Skipping non-UUID jobId for DB: ${jobId}`);
        return undefined;
      }
      
      // Verify the job exists in the database
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true }
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
      const validatedJobId = await this.validateJobId(jobId);

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
          username: tweet.username || tweet.core?.user_results?.result?.legacy?.screen_name || 'unknown',
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
  static async saveTweets(data: {
    tweets: any[];
    jobId?: string;
  }): Promise<number> {
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
          const result = await this.saveTweet({ tweet, jobId });
          if (result) savedCount++;
        })
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
    return new Set(found.map(t => t.id));
  }
}
