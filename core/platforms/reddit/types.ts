/**
 * Reddit API Type Definitions
 *
 * Types for Reddit's public JSON API responses.
 * Ref: https://www.reddit.com/dev/api/
 */

/**
 * Base Reddit Thing wrapper
 */
export interface RedditThing<T = any> {
  kind: string; // e.g., "t1" (comment), "t3" (post), "Listing", "more"
  data: T;
}

/**
 * Reddit Listing (paginated response)
 */
export interface RedditListing {
  kind: 'Listing';
  data: {
    modhash: string;
    dist: number | null;
    after: string | null;
    before: string | null;
    children: RedditThing[];
  };
}

/**
 * Reddit Post (Link/Submission) - t3
 */
export interface RedditPost {
  id: string;
  name: string; // Fullname (t3_xxxxx)
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  subreddit_name_prefixed: string; // e.g., "r/javascript"
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url: string;
  permalink: string;
  is_self: boolean;
  link_flair_text?: string;
  gilded: number;
  over_18: boolean;
  thumbnail?: string;
  media?: any;
  preview?: any;
}

/**
 * Reddit Comment - t1
 */
export interface RedditComment {
  id: string;
  name: string; // Fullname (t1_xxxxx)
  author: string;
  body: string;
  body_html: string;
  score: number;
  created_utc: number;
  parent_id: string;
  permalink: string;
  depth?: number;
  is_submitter: boolean;
  gilded: number;
  controversiality: number;
  replies: RedditListing | ''; // Empty string if no replies
}

/**
 * "Load more comments" continuation marker
 */
export interface RedditMore {
  count: number;
  name: string;
  id: string;
  parent_id: string;
  depth: number;
  children: string[]; // IDs of hidden comments
}

/**
 * Flattened comment structure (post-parsing)
 */
export interface FlattenedComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  depth: number;
  parent_id: string | null;
  permalink: string;
  is_submitter: boolean;
  gilded: number;
  controversiality: number;
}

/**
 * Scraper configuration options
 */
export interface RedditScraperConfig {
  subreddit?: string;
  postUrl?: string;
  limit?: number;
  sortType?: 'hot' | 'new' | 'top' | 'best' | 'rising';
  timeFilter?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
}

/**
 * Scraper result
 */
export interface RedditScraperResult {
  status: 'success' | 'error';
  message?: string;
  post?: RedditPost;
  comments?: FlattenedComment[];
  posts?: Array<{ post: RedditPost; comments: FlattenedComment[] }>;
  filePath?: string;
  scrapedCount?: number;
  totalPosts?: number;
}
