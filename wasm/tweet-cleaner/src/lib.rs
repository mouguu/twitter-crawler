use indexmap::IndexMap;
use js_sys::Date;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(untagged)]
enum NumberLike {
    Int(i64),
    Float(f64),
    Str(String),
}

impl NumberLike {
    fn as_i64(&self) -> Option<i64> {
        match self {
            NumberLike::Int(v) => Some(*v),
            NumberLike::Float(v) => Some((*v).round() as i64),
            NumberLike::Str(v) => v.trim().parse::<f64>().ok().map(|n| n.round() as i64),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(untagged)]
enum Timestamp {
    Str(String),
    Float(f64),
    Int(i64),
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct IncomingTweet {
    #[serde(default, alias = "id", alias = "tweet_id", alias = "rest_id")]
    id: Option<String>,
    #[serde(default, alias = "url", alias = "tweetUrl")]
    url: Option<String>,
    #[serde(default, alias = "text", alias = "full_text", alias = "content")]
    text: Option<String>,
    #[serde(default, alias = "time", alias = "created_at")]
    time: Option<Timestamp>,
    #[serde(default, alias = "likes", alias = "favorite_count")]
    likes: Option<NumberLike>,
    #[serde(default, alias = "retweets", alias = "retweet_count")]
    retweets: Option<NumberLike>,
    #[serde(default, alias = "replies", alias = "reply_count")]
    replies: Option<NumberLike>,
    #[serde(default, alias = "views", alias = "view_count")]
    views: Option<serde_json::Value>,
    #[serde(default, alias = "hasMedia", alias = "has_media")]
    has_media: Option<bool>,
    #[serde(default, alias = "isReply", alias = "is_reply")]
    is_reply: Option<bool>,
    #[serde(default, alias = "quotedContent", alias = "quoted_content")]
    quoted_content: Option<String>,
    #[serde(default, alias = "username", alias = "author", alias = "screen_name")]
    username: Option<String>,
    #[serde(default, alias = "userId", alias = "user_id", alias = "author_id")]
    user_id: Option<String>,
    #[serde(default, alias = "userDisplayName", alias = "user_display_name")]
    user_display_name: Option<String>,
    #[serde(default, alias = "userAvatar", alias = "user_avatar")]
    user_avatar: Option<String>,
    #[serde(default, alias = "lang", alias = "language")]
    lang: Option<String>,
    #[serde(default, alias = "isLiked", alias = "is_liked")]
    is_liked: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct NormalizedTweet {
    id: String,
    url: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    likes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retweets: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replies: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_media: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_avatar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    views: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_reply: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quoted_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_liked: Option<bool>,
}

#[derive(Clone, Debug)]
struct NormalizedRecord {
    tweet: NormalizedTweet,
    ts_ms: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct CleanStats {
    added: usize,
    deduped: usize,
    dropped: usize,
    truncated: usize,
    total: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct CleanResult {
    tweets: Vec<NormalizedTweet>,
    stats: CleanStats,
}

#[wasm_bindgen]
pub fn clean_and_merge(
    existing: JsValue,
    incoming: JsValue,
    limit: Option<u32>,
) -> Result<JsValue, JsValue> {
    let existing: Vec<IncomingTweet> =
        serde_wasm_bindgen::from_value(existing).map_err(|e| JsValue::from(e.to_string()))?;
    let incoming: Vec<IncomingTweet> =
        serde_wasm_bindgen::from_value(incoming).map_err(|e| JsValue::from(e.to_string()))?;

    let mut seen_existing = std::collections::HashSet::new();
    let mut records: IndexMap<String, NormalizedRecord> = IndexMap::new();
    let mut dropped = 0usize;
    let mut deduped = 0usize;
    let mut added = 0usize;

    for item in existing.iter() {
        if let Some(normalized) = normalize_tweet(item) {
            seen_existing.insert(normalized.tweet.id.clone());
            records.insert(normalized.tweet.id.clone(), normalized);
        } else {
            dropped += 1;
        }
    }

    for item in incoming.iter() {
        if let Some(normalized) = normalize_tweet(item) {
            if records.contains_key(&normalized.tweet.id) {
                deduped += 1;
            } else if seen_existing.contains(&normalized.tweet.id) {
                deduped += 1;
            } else {
                added += 1;
            }
            records.insert(normalized.tweet.id.clone(), normalized);
        } else {
            dropped += 1;
        }
    }

    let mut normalized: Vec<NormalizedRecord> = records.into_values().collect();
    normalized.sort_by(|a, b| b.ts_ms.partial_cmp(&a.ts_ms).unwrap_or(std::cmp::Ordering::Equal));

    let mut truncated = 0usize;
    if let Some(limit) = limit {
        let limit = limit as usize;
        if normalized.len() > limit {
            truncated = normalized.len() - limit;
            normalized.truncate(limit);
        }
    }

    let tweets: Vec<NormalizedTweet> = normalized.into_iter().map(|r| r.tweet).collect();
    let total = tweets.len();
    let result = CleanResult {
        tweets,
        stats: CleanStats {
            added,
            deduped,
            dropped,
            truncated,
            total,
        },
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from(e.to_string()))
}

fn normalize_tweet(raw: &IncomingTweet) -> Option<NormalizedRecord> {
    let id = pick_first(&[raw.id.as_deref()])?;
    let url = pick_first(&[raw.url.as_deref()])?;
    let text = pick_first(&[raw.text.as_deref()])?;
    if id.is_empty() || url.is_empty() || text.is_empty() {
        return None;
    }

    let (time_iso, ts_ms) = normalize_time(raw);

    Some(NormalizedRecord {
        ts_ms,
        tweet: NormalizedTweet {
            id: id,
            url,
            text,
            time: time_iso,
            likes: raw.likes.as_ref().and_then(NumberLike::as_i64),
            retweets: raw.retweets.as_ref().and_then(NumberLike::as_i64),
            replies: raw.replies.as_ref().and_then(NumberLike::as_i64),
            has_media: raw.has_media,
            username: raw.username.clone().map(trim_owned),
            user_id: raw.user_id.clone().map(trim_owned),
            user_display_name: raw.user_display_name.clone().map(trim_owned),
            user_avatar: raw.user_avatar.clone().map(trim_owned),
            lang: raw.lang.clone().map(trim_owned),
            views: raw.views.clone(),
            is_reply: raw.is_reply,
            quoted_content: raw.quoted_content.clone().map(trim_owned),
            is_liked: raw.is_liked,
        },
    })
}

fn normalize_time(raw: &IncomingTweet) -> (Option<String>, Option<f64>) {
    let ts_ms = raw.time.as_ref().and_then(timestamp_to_ms);
    let iso = ts_ms.map(|ms| Date::new(&JsValue::from_f64(ms)).to_iso_string().into());
    (iso, ts_ms)
}

fn timestamp_to_ms(ts: &Timestamp) -> Option<f64> {
    match ts {
        Timestamp::Float(v) => Some(normalize_numeric_time(*v)),
        Timestamp::Int(v) => Some(normalize_numeric_time(*v as f64)),
        Timestamp::Str(v) => {
            let date = Date::new(&JsValue::from_str(v));
            let ms = date.get_time();
            if ms.is_nan() {
                None
            } else {
                Some(ms)
            }
        }
    }
}

fn normalize_numeric_time(value: f64) -> f64 {
    if value > 1_000_000_000_000.0 {
        value
    } else if value > 1_000_000_000.0 {
        value
    } else {
        value * 1000.0
    }
}

fn pick_first(options: &[Option<&str>]) -> Option<String> {
    for opt in options {
        if let Some(v) = opt {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn trim_owned(value: String) -> String {
    value.trim().to_string()
}
