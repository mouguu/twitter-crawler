use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct NormalizedRedditPost {
    id: String,
    title: Option<String>,
    author: Option<String>,
    url: Option<String>,
    self_text: Option<String>,
    subreddit: Option<String>,
    score: Option<i64>,
    upvote_ratio: Option<f64>,
    num_comments: Option<i64>,
    created_utc: Option<f64>,
    permalink: Option<String>,
    flair: Option<String>,
    over_18: Option<bool>,
    stickied: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ParseResult {
    posts: Vec<NormalizedRedditPost>,
    stats: ParseStats,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ParseStats {
    total: usize,
    deduped: usize,
    dropped: usize,
}

#[wasm_bindgen]
pub fn parse_reddit_payload(payload: JsValue) -> Result<JsValue, JsValue> {
    let value: Value =
        serde_wasm_bindgen::from_value(payload).map_err(|e| JsValue::from(e.to_string()))?;

    let mut map: IndexMap<String, NormalizedRedditPost> = IndexMap::new();
    let mut dropped = 0usize;
    let mut deduped = 0usize;

    for post in extract_posts(&value) {
        if post.id.is_empty() {
            dropped += 1;
            continue;
        }
        if map.contains_key(&post.id) {
            deduped += 1;
        }
        map.insert(post.id.clone(), post);
    }

    let posts: Vec<NormalizedRedditPost> = map.into_values().collect();

    let result = ParseResult {
        stats: ParseStats {
            total: posts.len(),
            deduped,
            dropped,
        },
        posts,
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from(e.to_string()))
}

fn extract_posts(root: &Value) -> Vec<NormalizedRedditPost> {
    let mut posts = Vec::new();

    // Common Listing structure: data.children[*].data
    if let Some(children) = root
        .get("data")
        .and_then(|d| d.get("children"))
        .and_then(|c| c.as_array())
    {
        for child in children {
            if let Some(data) = child.get("data") {
                if let Some(post) = normalize_post(data) {
                    posts.push(post);
                }
            }
        }
    }

    // Some APIs may return array of objects directly
    if let Some(arr) = root.as_array() {
        for item in arr {
            if let Some(data) = item.get("data").or_else(|| Some(item)) {
                if let Some(post) = normalize_post(data) {
                    posts.push(post);
                }
            }
        }
    }

    posts
}

fn normalize_post(data: &Value) -> Option<NormalizedRedditPost> {
    let id = data
        .get("id")
        .or_else(|| data.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if id.is_empty() {
        return None;
    }

    let to_string_opt = |k: &str| data.get(k).and_then(Value::as_str).map(|s| s.to_string());
    let to_bool_opt = |k: &str| data.get(k).and_then(Value::as_bool);
    let to_i64_opt = |k: &str| {
        data.get(k)
            .and_then(Value::as_i64)
            .or_else(|| data.get(k).and_then(Value::as_f64).map(|v| v as i64))
    };
    let to_f64_opt = |k: &str| data.get(k).and_then(Value::as_f64);

    Some(NormalizedRedditPost {
        id,
        title: to_string_opt("title"),
        author: to_string_opt("author"),
        url: to_string_opt("url").or_else(|| to_string_opt("permalink")),
        self_text: to_string_opt("selftext"),
        subreddit: to_string_opt("subreddit"),
        score: to_i64_opt("score"),
        upvote_ratio: to_f64_opt("upvote_ratio"),
        num_comments: to_i64_opt("num_comments"),
        created_utc: to_f64_opt("created_utc"),
        permalink: to_string_opt("permalink"),
        flair: to_string_opt("link_flair_text").or_else(|| to_string_opt("author_flair_text")),
        over_18: to_bool_opt("over_18"),
        stickied: to_bool_opt("stickied"),
    })
}
