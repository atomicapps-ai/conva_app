//! Pure parsing and conservative matching for pre-generated Q&A documents.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::bm25::tokenize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreparedQaEntry {
    pub question: String,
    pub answer: String,
    pub document_id: String,
    pub file_name: String,
    pub location: String,
}

#[derive(Debug, Clone, Copy)]
pub struct PreparedQaMatch<'a> {
    pub entry: &'a PreparedQaEntry,
    pub confidence: f32,
}

fn clean(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Parse the canonical `Q: ...` / `A: ...` formats emitted by Context
/// preparation and accepted by the UI's Q&A importer.
pub fn parse_prepared_qa(text: &str, document_id: &str, file_name: &str) -> Vec<PreparedQaEntry> {
    let lines: Vec<&str> = text.lines().collect();
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut heading = String::new();
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index].trim();
        if let Some(value) = line.strip_prefix('#') {
            heading = value.trim_start_matches('#').trim().to_string();
            index += 1;
            continue;
        }

        let body = line.trim_start_matches(['-', '*', '+', '•']).trim();
        let (question, inline_answer) = if let Some(rest) = body
            .strip_prefix("**Q:")
            .or_else(|| body.strip_prefix("**Q."))
        {
            if let Some(end) = rest.find("**") {
                let after = rest[end + 2..].trim();
                (
                    rest[..end].trim(),
                    after
                        .strip_prefix("A:")
                        .or_else(|| after.strip_prefix("A."))
                        .unwrap_or(after)
                        .trim(),
                )
            } else {
                index += 1;
                continue;
            }
        } else if let Some(rest) = body.strip_prefix("Q:").or_else(|| body.strip_prefix("Q.")) {
            (rest.trim(), "")
        } else {
            index += 1;
            continue;
        };

        index += 1;
        let mut answer = inline_answer.to_string();
        while index < lines.len() {
            let next = lines[index].trim();
            let next_body = next.trim_start_matches(['-', '*', '+', '•']).trim();
            if next.starts_with('#')
                || next_body.starts_with("**Q:")
                || next_body.starts_with("**Q.")
                || next_body.starts_with("Q:")
                || next_body.starts_with("Q.")
            {
                break;
            }
            let part = if answer.is_empty() {
                next_body
                    .strip_prefix("A:")
                    .or_else(|| next_body.strip_prefix("A."))
                    .unwrap_or(next_body)
            } else {
                next
            };
            if !part.is_empty() {
                if !answer.is_empty() {
                    answer.push(' ');
                }
                answer.push_str(part);
            }
            index += 1;
        }

        let question = clean(question);
        let answer = clean(&answer);
        let key = question.to_lowercase();
        if !question.is_empty() && !answer.is_empty() && seen.insert(key) {
            entries.push(PreparedQaEntry {
                question,
                answer,
                document_id: document_id.to_string(),
                file_name: file_name.to_string(),
                location: heading.clone(),
            });
        }
    }
    entries
}

fn terms(value: &str) -> HashSet<String> {
    tokenize(value)
        .into_iter()
        .filter(|term| term.len() > 2)
        .collect()
}

/// Return only exact or near-exact prepared-question matches. The deliberately
/// high threshold protects the no-LLM path from confidently answering the
/// wrong question; broader semantic matching belongs behind evaluated data.
pub fn match_prepared_qa<'a>(
    query: &str,
    entries: &'a [PreparedQaEntry],
) -> Option<PreparedQaMatch<'a>> {
    let normalized = clean(query).to_lowercase();
    let query_terms = terms(query);
    entries
        .iter()
        .filter_map(|entry| {
            let candidate = clean(&entry.question).to_lowercase();
            if candidate == normalized {
                return Some(PreparedQaMatch {
                    entry,
                    confidence: 1.0,
                });
            }
            let candidate_terms = terms(&entry.question);
            if query_terms.len() < 3 || candidate_terms.len() < 3 {
                return None;
            }
            let overlap = query_terms.intersection(&candidate_terms).count();
            let confidence = overlap as f32 / query_terms.len().max(candidate_terms.len()) as f32;
            (confidence >= 0.85).then_some(PreparedQaMatch { entry, confidence })
        })
        .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_generated_and_loose_pairs() {
        let entries = parse_prepared_qa(
            "## Behavioral\n- **Q: Tell me about a difficult launch** A: I stabilized the rollout.\n\nQ: Why this role?\nA: It combines systems and product work.",
            "qa-1",
            "Interview Q&A.md",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].location, "Behavioral");
        assert!(entries[1].answer.contains("systems and product"));
    }

    #[test]
    fn exact_and_near_exact_matches_are_safe() {
        let entries = parse_prepared_qa(
            "Q: How did you handle the difficult database migration?\nA: I used a staged rollout.",
            "qa-1",
            "Prep.txt",
        );
        assert_eq!(
            match_prepared_qa(
                "How did you handle the difficult database migration?",
                &entries
            )
            .unwrap()
            .confidence,
            1.0
        );
        assert!(match_prepared_qa(
            "How did you handle that difficult database migration?",
            &entries
        )
        .is_some());
        assert!(match_prepared_qa("How do database indexes work?", &entries).is_none());
    }
}
