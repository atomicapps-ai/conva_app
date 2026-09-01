//! In-memory BM25 retrieval (design §4.4 R3 — the lexical half of hybrid
//! search; the vector half joins it via reciprocal-rank fusion in a later
//! milestone behind the same `RagStore` seam).
//!
//! Scale check: a reference library is dozens of documents → thousands of
//! chunks. BM25 over that is microseconds — far inside the <15 ms retrieval
//! budget (§2.5).

use std::collections::HashMap;

const K1: f32 = 1.2;
const B: f32 = 0.75;

/// Lowercased alphanumeric tokens; everything else is a separator.
pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 1)
        .map(|t| t.to_string())
        .collect()
}

pub struct Bm25Index {
    /// term → [(doc_index, term_frequency)]
    postings: HashMap<String, Vec<(usize, u32)>>,
    doc_lengths: Vec<u32>,
}

impl Bm25Index {
    pub fn build<'a>(documents: impl Iterator<Item = &'a str>) -> Self {
        let mut postings: HashMap<String, Vec<(usize, u32)>> = HashMap::new();
        let mut doc_lengths = Vec::new();

        for (index, text) in documents.enumerate() {
            let tokens = tokenize(text);
            doc_lengths.push(tokens.len() as u32);
            let mut frequencies: HashMap<String, u32> = HashMap::new();
            for token in tokens {
                *frequencies.entry(token).or_insert(0) += 1;
            }
            for (term, tf) in frequencies {
                postings.entry(term).or_default().push((index, tf));
            }
        }

        Self {
            postings,
            doc_lengths,
        }
    }

    pub fn len(&self) -> usize {
        self.doc_lengths.len()
    }

    pub fn is_empty(&self) -> bool {
        self.doc_lengths.is_empty()
    }

    /// Plain corpus IDF `ln(N/df)` for a token — higher means rarer across the
    /// indexed documents. Used by the highlighter's rarity signal. Returns 0.0
    /// for a token absent from the corpus (unknown, not "rare") or an empty
    /// index. `term` must be lowercased (as [`tokenize`] produces).
    pub fn token_idf(&self, term: &str) -> f32 {
        let n = self.doc_lengths.len();
        if n == 0 {
            return 0.0;
        }
        match self.postings.get(term) {
            Some(posting) if !posting.is_empty() => (n as f32 / posting.len() as f32).ln(),
            _ => 0.0,
        }
    }

    /// Top-k `(doc_index, score)` for the query, best first. Documents with
    /// zero overlap are never returned.
    pub fn search(&self, query: &str, k: usize) -> Vec<(usize, f32)> {
        self.search_filtered(query, k, |_| true)
    }

    /// Top-k `(doc_index, score)` restricted to documents accepted by
    /// `include`. Filtering happens **before** document frequency, average
    /// length, scoring, and ranking are calculated. This matters for an active
    /// conversation Context: searching the global top-k and filtering it after
    /// the fact can return no result even when the scoped corpus contains an
    /// exact match.
    pub fn search_filtered(
        &self,
        query: &str,
        k: usize,
        include: impl FnMut(usize) -> bool,
    ) -> Vec<(usize, f32)> {
        let included: Vec<bool> = (0..self.doc_lengths.len()).map(include).collect();
        let n = included.iter().filter(|&&keep| keep).count() as f32;
        if n == 0.0 {
            return Vec::new();
        }
        let average_length = self
            .doc_lengths
            .iter()
            .zip(&included)
            .filter_map(|(&len, &keep)| keep.then_some(len))
            .sum::<u32>() as f32
            / n;
        let mut scores: HashMap<usize, f32> = HashMap::new();

        for term in tokenize(query) {
            let Some(posting) = self.postings.get(&term) else {
                continue;
            };
            let df = posting
                .iter()
                .filter(|(doc, _)| included.get(*doc).copied().unwrap_or(false))
                .count() as f32;
            if df == 0.0 {
                continue;
            }
            let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
            for &(doc, tf) in posting {
                if !included.get(doc).copied().unwrap_or(false) {
                    continue;
                }
                let len_norm =
                    1.0 - B + B * (self.doc_lengths[doc] as f32 / average_length.max(1.0));
                let tf = tf as f32;
                let term_score = idf * (tf * (K1 + 1.0)) / (tf + K1 * len_norm);
                *scores.entry(doc).or_insert(0.0) += term_score;
            }
        }

        let mut ranked: Vec<(usize, f32)> = scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(k);
        ranked
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(docs: &[&str]) -> Bm25Index {
        Bm25Index::build(docs.iter().copied())
    }

    #[test]
    fn finds_the_relevant_document() {
        let idx = index(&[
            "The furnace maintenance plan costs ninety dollars yearly",
            "Air conditioning repair pricing depends on refrigerant type",
            "Our office is open monday through friday",
        ]);
        let hits = idx.search("how much does the maintenance plan cost", 2);
        assert_eq!(hits[0].0, 0, "furnace plan doc should rank first");
    }

    #[test]
    fn rare_terms_outweigh_common_ones() {
        let idx = index(&[
            "pricing pricing pricing common words",
            "the unique refrigerant certification requirement",
            "pricing and common words again",
        ]);
        let hits = idx.search("refrigerant certification", 3);
        assert_eq!(hits[0].0, 1);
    }

    #[test]
    fn no_overlap_returns_empty() {
        let idx = index(&["alpha beta gamma"]);
        assert!(idx.search("zzz qqq", 5).is_empty());
    }

    #[test]
    fn empty_index_is_safe() {
        let idx = index(&[]);
        assert!(idx.search("anything", 5).is_empty());
        assert!(idx.is_empty());
    }

    #[test]
    fn k_bounds_results() {
        let idx = index(&["cat dog", "cat mouse", "cat bird"]);
        assert_eq!(idx.search("cat", 2).len(), 2);
    }

    #[test]
    fn token_idf_ranks_rare_above_common() {
        // "cat" is in all 3 docs (df=3 → idf 0); "mouse" in 1 (df=1 → idf ln3).
        let idx = index(&["cat dog", "cat mouse", "cat bird"]);
        assert!(idx.token_idf("mouse") > idx.token_idf("cat"));
        assert_eq!(idx.token_idf("cat"), 0.0, "present everywhere → not rare");
        assert_eq!(idx.token_idf("absent"), 0.0, "unknown token → 0, not rare");
        assert_eq!(index(&[]).token_idf("cat"), 0.0, "empty index is safe");
    }

    #[test]
    fn filtered_search_ranks_inside_the_scope_before_truncating() {
        let docs: Vec<String> = (0..40)
            .map(|i| format!("global maintenance plan result {i} repeated repeated"))
            .chain(std::iter::once(
                "scoped maintenance plan answer with the verified warranty".to_string(),
            ))
            .collect();
        let idx = Bm25Index::build(docs.iter().map(String::as_str));

        // A post-filtered global top-3 has no reason to contain the last doc.
        assert!(!idx
            .search("maintenance plan", 3)
            .iter()
            .any(|(doc, _)| *doc == 40));

        // A real scoped search scores/ranks the allowed corpus itself.
        let scoped = idx.search_filtered("maintenance plan", 3, |doc| doc == 40);
        assert_eq!(scoped.first().map(|(doc, _)| *doc), Some(40));
    }
}
