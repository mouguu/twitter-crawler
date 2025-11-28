# University of Toronto (r/UofT) Reddit Dataset - Data Dictionary

## 📊 Dataset Overview

This dataset contains **6,000+ posts** and their associated comments from the r/UofT subreddit, spanning multiple years of University of Toronto student discussions. The data has been professionally cleaned, standardized, and enriched with quality metrics for research and analysis purposes.

## 📋 Column Definitions

### Core Identifiers
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `post_id` | String | Unique Reddit post identifier | `1m3ml6v` |
| `title` | String | Fully cleaned post title (HTML decoded, placeholders removed) | `Uoft summer hangout gc ? (first yrs preferred but honestly im open to anyone)` |
| `content` | String | Fully cleaned post content/body text | `Just wanna have fun w ppl and try to make uoft not hell` |
| `author` | String | Reddit username (may be `[deleted]` for removed accounts) | `Queasy-Fix4776` |
| `subreddit` | String | Source subreddit (always `UofT` for this dataset) | `UofT` |

### Timestamps
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `created_utc` | Integer | Post creation timestamp (Unix timestamp) | `1752897204` |
| `created_date` | String | Human-readable creation date | `2025-07-19 11:53:24` |

### Reddit Metrics
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `score` | Integer | Net score (upvotes - downvotes) from Reddit API | `1` |
| `upvote_ratio` | Float | Ratio of upvotes to total votes (0.0-1.0) | `0.85` |
| `num_comments` | Integer | Total comment count reported by Reddit API | `2` |

### Comment Data
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `comments_json` | String | Complete structured JSON array of comment tree with full metadata | `[{"id": "n3xu465", "author": "wdcmaxy", "body": "cleaned text", "body_original": "original text with 😊", "score": 1, "level": 0, "created_utc": 0, "quality_score": 8.0}]` |

**Note:** Each comment object contains:
- `id`: Comment identifier
- `author`: Username
- `body`: **Fully cleaned text** (HTML decoded, emojis removed, placeholders removed, whitespace normalized)
- `body_original`: **Original uncleaned text** (preserves emojis, formatting, line breaks, HTML entities)
- `score`: Comment score (upvotes - downvotes)
- `level`: Reply depth (0=top-level, 1=first reply, 2=reply to reply, etc.)
- `created_utc`: Timestamp (may be 0 if unavailable)
- `quality_score`: Algorithmic quality assessment (0-10 scale)

### Quality Metrics (0-10 Scale)
| Column | Type | Description | Calculation Method |
|--------|------|-------------|-------------------|
| `quality_title` | Float | Title quality score | Based on length, clarity, grammar |
| `quality_content` | Float | Content quality score | Based on length, substance, readability |
| `quality_engagement` | Float | Engagement quality score | Based on votes and comment activity |
| `quality_overall` | Float | Composite quality score | Weighted average: 30% title + 40% content + 30% engagement |
| `quality_recommendation` | String | Quality category | `high_quality` (≥7.0), `medium_quality` (5.0-6.9), `low_quality` (3.0-4.9), `exclude` (<3.0) |

### Boolean Flags
| Column | Type | Description | Logic |
|--------|------|-------------|-------|
| `include_in_dataset` | Boolean | Whether post meets minimum quality threshold | `quality_recommendation != 'exclude'` |
| `has_discussion` | Boolean | Whether post has meaningful discussion | `True if ≥3 comments scraped` |

### Content Classification
| Column | Type | Description | Logic |
|--------|------|-------------|-------|
| `content_type` | String | Content classification | `'text'` if content exists, `'link'` if content is empty |

### Additional Fields
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `url` | String | Direct URL to Reddit post | `https://www.reddit.com/r/UofT/comments/1m3ml6v/` |
| `engagement_score` | Integer | Calculated engagement metric | `score + (scraped_comments * 2)` |

## 🧮 Calculated Fields & Formulas

### Engagement Score
```
engagement_score = score + (scraped_comment_count * 2)
```
**Rationale:** Comments represent deeper engagement than votes, so they receive double weight. Uses actual scraped comments, not Reddit API count.

**Example:** If `score=1` and scraped 2 comments, then `engagement_score = 1 + (2 * 2) = 5`

### Quality Overall Score
```
quality_overall = (quality_title * 0.3) + (quality_content * 0.4) + (quality_engagement * 0.3)
```
**Rationale:** Content quality is weighted highest (40%), with title and engagement equally weighted (30% each).

### Quality Recommendation Categories
```
if quality_overall >= 7.0: "high_quality"
elif quality_overall >= 5.0: "medium_quality"
elif quality_overall >= 3.0: "low_quality"
else: "exclude"
```

## 🧹 Data Cleaning Process

### Text Cleaning Pipeline
1. **HTML Entity Decoding:** `&amp;` → `&`, `&lt;` → `<`, etc.
2. **Placeholder Removal:** All `[URL]`, `[EMOJI]`, `[USER]`, `[SUB]`, `[QUOTE]` placeholders completely removed
3. **Whitespace Normalization:** Multiple spaces/tabs/newlines → single space
4. **Trim:** Leading/trailing whitespace removed

### Comment Processing
- **Nested Structure:** Reddit's tree structure preserved in JSON format with level indicators
- **Metadata Preservation:** Author, score, timestamp, and reply level preserved
- **Dual Text Versions:** Both cleaned (`body`) and original (`body_original`) text provided
- **Quality Assessment:** Each comment receives an individual quality score

## 📈 Data Quality Notes

### Comment Count Discrepancies
- `num_comments`: Reddit API reported count (may include deleted comments)
- Actual scraped comments in `comments_json` may be fewer due to:
  - Deleted/removed comments
  - Blocked users
  - API limitations
  - Private/restricted content

### Content Type Classification
- **Text Posts:** Have substantial content in the `content` field
- **Link Posts:** Have empty `content` field (common for image/video/link posts)
- **Example:** A post sharing a link or image will have a title but no body text

### Empty Comments JSON
- Posts with no comments have `comments_json = []` (empty array)
- This is normal and expected for newer posts or posts with low engagement

### Quality Scoring Methodology

#### Text Quality Algorithm (for title and content)
- **Base Score:** 5.0
- **Length Bonuses:**
  - 50-1000 characters: +2.0 points
  - 20-50 characters: +1.0 point
  - <10 characters: -2.0 points
- **Compression Ratio:** (cleaned_length / original_length)
  - >0.8 (minimal cleaning needed): +1.0 point
  - <0.5 (heavy cleaning required): -1.0 point
- **Final Range:** 0.0-10.0 (clamped)

#### Engagement Quality Algorithm
- **Base Score:** 5.0
- **Score Bonuses:**
  - >50 points: +3.0
  - >10 points: +2.0
  - >0 points: +1.0
  - <-5 points: -2.0
- **Comment Bonuses:**
  - >20 comments: +2.0
  - >5 comments: +1.0

#### Important Notes
- **Algorithmic Assessment:** All quality scores are computed automatically
- **Not Human-Reviewed:** These are algorithmic assessments, not human judgments
- **Purpose:** Designed for dataset curation and filtering, not content evaluation

## 🎯 Usage Examples

### High-Quality Posts Only
```python
df_high_quality = df[df['quality_recommendation'] == 'high_quality']
```

### Posts with Discussion
```python
df_discussion = df[df['has_discussion'] == True]
```

### Text Posts Only
```python
df_text_posts = df[df['content_type'] == 'text']
```

### Top Engaged Posts
```python
df_top_engaged = df.nlargest(100, 'engagement_score')
```

## 📊 Dataset Statistics

- **Total Posts:** 6,000+
- **Time Range:** 2011-2025 (14+ years)
- **Average Quality Score:** ~6.5/10
- **High-Quality Posts:** ~40%
- **Posts with Discussion:** ~60%
- **Text vs Link Posts:** ~70% text, ~30% link

## ⚖️ Ethical Considerations

- **Public Data:** All data was publicly available on Reddit
- **No PII:** Only public Reddit usernames included
- **API Compliant:** Collected using Reddit's official API (PRAW)
- **Research Purpose:** Intended for academic and research use

## 📝 Citation

If you use this dataset in your research, please cite:

```
@dataset{uoft_reddit_2025,
  title={University of Toronto (r/UofT) Student Life Dataset},
  author={BENpen1110},
  year={2025},
  publisher={Kaggle},
  url={https://www.kaggle.com/datasets/benpen1110/university-of-toronto-ruoft-reddit-dataset}
}
```
