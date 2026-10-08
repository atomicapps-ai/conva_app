//! Domain lexicon — highlight vocabulary any LLM already knows.
//!
//! Design: `conva_core/docs/technical/faner-domain-lexicon.md`. A **pack** is a
//! curated phrase list for one domain (`data/lexicons/<id>.lex`, compiled in);
//! [`Lexicon`] matches a pack's entries — and their spoken *variants* — against
//! a transcript message through the same word tokenizer / gap policy as
//! [`crate::phrase`], with light stemming applied to lexicon lookups only, so
//! `models`/`modeled`/`modeling` all meet `model`.
//!
//! Pure and deterministic: no filesystem, no network, no clock. Packs are data;
//! regenerating one never needs a code change. Every shipped pack must pass
//! [`lint_pack`] (enforced by a test) — a 4k-term list that highlights `data`
//! or `system` would make the transcript unreadable.
//!
//! ## Pack format (`.lex`)
//!
//! ```text
//! # comment
//! @pack software-engineering
//! @version 2026.09.1
//! @anchors kubernetes, microservice, database
//! [core]
//! data modeling | modeling data | model data
//! Kubernetes !
//! [extended]
//! eventual consistency
//! ```
//!
//! * `[core]` / `[extended]` switch the tier for the entries below.
//! * An entry is `term` optionally followed by `| variant` spoken forms.
//! * A trailing `!` marks a single-word entry **standalone** (allowed to match
//!   on its own). Unflagged single words are rejected by the lint.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::phrase::{self, Gap, PhraseToken, Span};

/// How central a term is to its domain. Drives the score weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tier {
    /// Expected in any conversation of the domain.
    Core,
    /// Specialised vocabulary.
    Extended,
}

/// One authored entry: a canonical term plus its spoken variants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackEntry {
    pub term: String,
    pub variants: Vec<String>,
    pub tier: Tier,
    /// A single-word term that may match on its own (`Kubernetes`).
    pub standalone: bool,
    /// 1-based source line, for lint messages.
    pub line: usize,
}

/// A parsed pack file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackFile {
    pub id: String,
    pub version: String,
    /// Lowercase words whose presence in a Context's text suggests this pack
    /// applies (see [`select_packs`]).
    pub anchors: Vec<String>,
    pub entries: Vec<PackEntry>,
}

/// Parse a `.lex` source. Errors carry line numbers; a pack must declare
/// `@pack` and at least one anchor.
pub fn parse_pack(src: &str) -> Result<PackFile, Vec<String>> {
    let mut id = String::new();
    let mut version = String::new();
    let mut anchors: Vec<String> = Vec::new();
    let mut entries: Vec<PackEntry> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut tier: Option<Tier> = None;

    for (i, raw) in src.lines().enumerate() {
        let line_no = i + 1;
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix('@') {
            let (key, value) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
            let value = value.trim();
            match key {
                "pack" => id = value.to_string(),
                "version" => version = value.to_string(),
                "anchors" => {
                    anchors = value
                        .split(',')
                        .map(|a| a.trim().to_lowercase())
                        .filter(|a| !a.is_empty())
                        .collect();
                }
                other => errors.push(format!("line {line_no}: unknown directive @{other}")),
            }
            continue;
        }
        if line.starts_with('[') {
            match line {
                "[core]" => tier = Some(Tier::Core),
                "[extended]" => tier = Some(Tier::Extended),
                other => errors.push(format!("line {line_no}: unknown section {other}")),
            }
            continue;
        }
        let Some(tier) = tier else {
            errors.push(format!(
                "line {line_no}: entry before any [core]/[extended]"
            ));
            continue;
        };
        let mut parts = line.split('|').map(str::trim);
        let mut term = parts.next().unwrap_or("").to_string();
        let mut standalone = false;
        if let Some(stripped) = term.strip_suffix('!') {
            term = stripped.trim().to_string();
            standalone = true;
        }
        if term.is_empty() {
            errors.push(format!("line {line_no}: empty term"));
            continue;
        }
        let variants: Vec<String> = parts.filter(|v| !v.is_empty()).map(String::from).collect();
        entries.push(PackEntry {
            term,
            variants,
            tier,
            standalone,
            line: line_no,
        });
    }
    if id.is_empty() {
        errors.push("missing @pack".into());
    }
    if anchors.is_empty() {
        errors.push("missing @anchors".into());
    }
    if errors.is_empty() {
        Ok(PackFile {
            id,
            version,
            anchors,
            entries,
        })
    } else {
        Err(errors)
    }
}

// ── Stemming (lexicon lookups only) ──────────────────────────────────────────

/// Light, deterministic stemmer. Consistency matters, not linguistics: the same
/// function runs over pack entries and transcript tokens, so any two inflections
/// of a word collapse to the same key. Words with digits or symbols (`s3`,
/// `k8s`, `c++`) and words of ≤ 3 letters (`api`, `orm`, `vpc`) pass through.
pub fn stem(word: &str) -> String {
    let w = word.to_lowercase();
    if w.chars().count() <= 3 || !w.chars().all(char::is_alphabetic) {
        return w;
    }
    let mut s = w.clone();
    let len = s.len();
    if len > 4 && s.ends_with("ies") {
        s.truncate(len - 3);
        s.push('y');
    } else if len > 5 && s.ends_with("ing") {
        s.truncate(len - 3);
    } else if len > 4 && (s.ends_with("ed") || s.ends_with("es")) {
        s.truncate(len - 2);
    } else if len > 3
        && s.ends_with('s')
        && !s.ends_with("ss")
        && !s.ends_with("us")
        && !s.ends_with("is")
    {
        s.pop();
    }
    if s.len() > 3 && s.ends_with('e') {
        s.pop();
    }
    // Doubled final consonant (`modell`, `runn`, `cal`): collapse, except `ss`.
    let bytes = s.as_bytes();
    if bytes.len() > 3 {
        let (a, b) = (bytes[bytes.len() - 2], bytes[bytes.len() - 1]);
        if a == b && !matches!(a, b'a' | b'e' | b'i' | b'o' | b'u' | b's') {
            s.pop();
        }
    }
    if s.chars().count() < 3 {
        return w;
    }
    s
}

// ── Lint ─────────────────────────────────────────────────────────────────────

/// Single words that are far too generic to highlight alone, even if a pack
/// author flags them standalone. (Multi-word entries containing them are fine:
/// `data modeling` yes, `data` no.)
const GENERIC_SINGLE_WORDS: &[&str] = &[
    "data",
    "model",
    "models",
    "system",
    "systems",
    "service",
    "services",
    "server",
    "client",
    "code",
    "test",
    "tests",
    "tool",
    "tools",
    "process",
    "processes",
    "team",
    "project",
    "application",
    "app",
    "software",
    "hardware",
    "computer",
    "internet",
    "web",
    "network",
    "user",
    "users",
    "file",
    "files",
    "design",
    "development",
    "engineering",
    "function",
    "method",
    "class",
    "object",
    "type",
    "value",
    "state",
    "time",
    "request",
    "response",
    "error",
    "performance",
    "security",
    "cloud",
    "platform",
    "framework",
    "library",
    "language",
    "version",
    "release",
    "build",
    "deploy",
    "feature",
    "product",
    "engineer",
    "developer",
    "program",
    "programming",
    "technology",
    "solution",
    "architecture",
    "infrastructure",
    "interface",
    "module",
    "component",
    "layer",
    "environment",
    "resource",
    "resources",
    "management",
    "storage",
    "memory",
    "query",
    "table",
    "field",
    "record",
    "message",
    "event",
    "job",
    "task",
    "work",
    "pipeline",
    "workflow",
    "testing",
    "monitoring",
    "logging",
];

/// Lint a parsed pack. Returns one message per violation (empty = clean).
/// Rules (design §Noise guard): single words need `!`; a flagged single word must
/// not be generic; ≤ 3-char single words must be ALL CAPS; no entry made only of
/// noise tokens; no duplicates after normalisation + stemming.
pub fn lint_pack(pack: &PackFile) -> Vec<String> {
    let mut issues: Vec<String> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for entry in &pack.entries {
        let forms =
            std::iter::once((&entry.term, true)).chain(entry.variants.iter().map(|v| (v, false)));
        for (text, is_term) in forms {
            let toks = phrase::tokenize(text);
            let at = format!("{}:{} \"{}\"", pack.id, entry.line, text);
            if toks.is_empty() {
                issues.push(format!("{at}: no word tokens"));
                continue;
            }
            if toks
                .iter()
                .all(|t| crate::highlight::is_noise_token(&t.lower))
            {
                issues.push(format!("{at}: only stopword/noise tokens"));
            }
            if toks.len() == 1 {
                let word = &toks[0].lower;
                if is_term && !entry.standalone {
                    issues.push(format!(
                        "{at}: single word without the standalone flag (`!`)"
                    ));
                }
                if GENERIC_SINGLE_WORDS.contains(&word.as_str()) {
                    issues.push(format!("{at}: generic single word"));
                }
                let letters = word.chars().count();
                if letters <= 3 {
                    let original = text.trim();
                    let all_caps = original.chars().any(char::is_alphabetic)
                        && original.chars().all(|c| !c.is_lowercase());
                    if !all_caps {
                        issues.push(format!("{at}: short single word must be ALL CAPS"));
                    }
                }
            }
            let key = stem_key(&toks);
            if let Some(first) = seen.insert(key.clone(), entry.line) {
                issues.push(format!("{at}: duplicate of line {first} (\"{key}\")"));
            }
        }
    }
    issues
}

fn stem_key(toks: &[PhraseToken]) -> String {
    let mut key = String::new();
    for (i, t) in toks.iter().enumerate() {
        if i > 0 {
            match &t.gap {
                Gap::Join => key.push(' '),
                Gap::Symbol(c) => key.push(*c),
                Gap::Hard => key.push_str(" | "),
            }
        }
        key.push_str(&stem(&t.lower));
    }
    key
}

// ── Lexicon (matcher) ────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct EntryTok {
    stem: String,
    gap: Gap,
    gap_text: String,
}

#[derive(Debug, Clone)]
struct Compiled {
    toks: Vec<EntryTok>,
    tier: Tier,
    /// Index into `Lexicon::packs`.
    pack: usize,
}

/// One phrase occurrence found in a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexMatch {
    /// Byte span in the analysed message (the transcript's own text).
    pub span: Span,
    pub tier: Tier,
    /// Id of the pack (or context vocabulary) the entry came from.
    pub pack: String,
}

/// A compiled set of packs, ready to match messages. Cheap to clone-by-ref;
/// build once per Context activation.
#[derive(Debug, Clone, Default)]
pub struct Lexicon {
    packs: Vec<String>,
    /// First-token stem → entries starting with it, longest first.
    by_head: HashMap<String, Vec<Compiled>>,
    len: usize,
}

impl Lexicon {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Build from the bundled packs named in `ids` (unknown ids are skipped).
    pub fn from_pack_ids(ids: &[&str]) -> Self {
        let mut lex = Self::empty();
        for id in ids {
            if let Some(pack) = bundled_pack(id) {
                lex.add_pack(pack);
            }
        }
        lex.finish();
        lex
    }

    /// Compile one pack into this lexicon (call [`Lexicon::finish`] after the
    /// last one).
    pub fn add_pack(&mut self, pack: &PackFile) {
        self.add_entries(&pack.id, &pack.entries);
    }

    /// Compile authored entries under a source label (`pack.id`, or the
    /// Context's own expanded vocabulary).
    pub fn add_entries(&mut self, label: &str, entries: &[PackEntry]) {
        let pack_ix = match self.packs.iter().position(|p| p == label) {
            Some(i) => i,
            None => {
                self.packs.push(label.to_string());
                self.packs.len() - 1
            }
        };
        for entry in entries {
            for text in std::iter::once(&entry.term).chain(entry.variants.iter()) {
                let toks: Vec<EntryTok> = phrase::tokenize(text)
                    .into_iter()
                    .map(|t| EntryTok {
                        stem: stem(&t.lower),
                        gap: t.gap,
                        gap_text: t.gap_text,
                    })
                    .collect();
                if toks.is_empty() {
                    continue;
                }
                self.len += 1;
                self.by_head
                    .entry(toks[0].stem.clone())
                    .or_default()
                    .push(Compiled {
                        toks,
                        tier: entry.tier,
                        pack: pack_ix,
                    });
            }
        }
    }

    /// Sort each head's entries longest-first so the first match at a position
    /// is the longest. Idempotent.
    pub fn finish(&mut self) {
        for entries in self.by_head.values_mut() {
            entries.sort_by_key(|entry| std::cmp::Reverse(entry.toks.len()));
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Number of compiled phrase forms (terms + variants).
    pub fn len(&self) -> usize {
        self.len
    }

    /// Source labels compiled into this lexicon, in load order.
    pub fn pack_ids(&self) -> &[String] {
        &self.packs
    }

    /// Longest lexicon phrase starting at each token of `msg_tokens`. Whole
    /// tokens only; multi-word entries never match across a comma, period or
    /// line break (the same gap policy as [`phrase::find_occurrences`]).
    pub fn matches(&self, msg_tokens: &[PhraseToken]) -> Vec<LexMatch> {
        let mut out = Vec::new();
        if self.is_empty() {
            return out;
        }
        let stems: Vec<String> = msg_tokens.iter().map(|t| stem(&t.lower)).collect();
        for i in 0..msg_tokens.len() {
            let Some(entries) = self.by_head.get(&stems[i]) else {
                continue;
            };
            'entry: for entry in entries {
                let n = entry.toks.len();
                if i + n > msg_tokens.len() {
                    continue;
                }
                for k in 0..n {
                    if stems[i + k] != entry.toks[k].stem {
                        continue 'entry;
                    }
                    if k > 0 && !gap_matches(&entry.toks[k], &msg_tokens[i + k]) {
                        continue 'entry;
                    }
                }
                out.push(LexMatch {
                    span: Span {
                        start: msg_tokens[i].start,
                        end: msg_tokens[i + n - 1].end,
                    },
                    tier: entry.tier,
                    pack: self.packs[entry.pack].clone(),
                });
                break; // longest entry at this start wins
            }
        }
        out
    }
}

fn gap_matches(known: &EntryTok, spoken: &PhraseToken) -> bool {
    match (&known.gap, &spoken.gap) {
        (Gap::Join, Gap::Join) => true,
        (Gap::Symbol(a), Gap::Symbol(b)) => a == b,
        (Gap::Hard, Gap::Hard) => known.gap_text == spoken.gap_text,
        _ => false,
    }
}

// ── Bundled packs + selection ────────────────────────────────────────────────

const SOFTWARE_ENGINEERING: &str = include_str!("../data/lexicons/software-engineering.lex");

/// `(id, source)` of every pack compiled into the binary.
const BUNDLED_SOURCES: &[(&str, &str)] = &[("software-engineering", SOFTWARE_ENGINEERING)];

/// Ids of the bundled packs.
pub fn bundled_pack_ids() -> Vec<&'static str> {
    BUNDLED_SOURCES.iter().map(|(id, _)| *id).collect()
}

/// A bundled pack, parsed once. `None` for an unknown id. A bundled pack that
/// fails to parse is a build defect caught by the lint test, never a runtime
/// panic — it is simply unavailable.
pub fn bundled_pack(id: &str) -> Option<&'static PackFile> {
    static CACHE: OnceLock<Vec<PackFile>> = OnceLock::new();
    let packs = CACHE.get_or_init(|| {
        BUNDLED_SOURCES
            .iter()
            .filter_map(|(_, src)| parse_pack(src).ok())
            .collect()
    });
    packs.iter().find(|p| p.id == id)
}

/// Minimum distinct anchor words a Context's text must contain before a pack
/// applies — one stray "API" in a sales call must not switch on a whole pack.
pub const MIN_ANCHOR_HITS: usize = 3;
/// At most this many packs are active at once.
pub const MAX_ACTIVE_PACKS: usize = 2;

/// Text the pack selector reads from the active Context.
#[derive(Debug, Clone, Copy, Default)]
pub struct SelectionInput<'a> {
    pub title: &'a str,
    pub purpose: &'a str,
    pub job_description: Option<&'a str>,
    pub key_terms: &'a [String],
    pub glossary: &'a [String],
}

/// Which bundled packs apply to a Context: those whose anchors appear (as
/// stems) at least [`MIN_ANCHOR_HITS`] times among the Context's own words,
/// best first (ties by pack id), at most [`MAX_ACTIVE_PACKS`]. No Context text
/// → no pack: a casual call never lights up technical terms.
pub fn select_packs(input: &SelectionInput) -> Vec<&'static str> {
    let mut words: HashSet<String> = HashSet::new();
    let mut take = |text: &str| {
        for t in phrase::tokenize(text) {
            words.insert(stem(&t.lower));
        }
    };
    take(input.title);
    take(input.purpose);
    if let Some(jd) = input.job_description {
        take(jd);
    }
    for t in input.key_terms.iter().chain(input.glossary) {
        take(t);
    }
    let mut scored: Vec<(usize, &'static str)> = BUNDLED_SOURCES
        .iter()
        .filter_map(|(id, _)| bundled_pack(id))
        .map(|pack| {
            let hits = pack
                .anchors
                .iter()
                .map(|a| stem(a))
                .collect::<HashSet<_>>()
                .iter()
                .filter(|a| words.contains(*a))
                .count();
            (hits, pack.id.as_str())
        })
        .filter(|(hits, _)| *hits >= MIN_ANCHOR_HITS)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
    scored
        .into_iter()
        .take(MAX_ACTIVE_PACKS)
        .map(|(_, id)| id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lex_from(src: &str) -> Lexicon {
        let pack = parse_pack(src).expect("parse");
        let mut lex = Lexicon::empty();
        lex.add_pack(&pack);
        lex.finish();
        lex
    }

    const MINI: &str = "@pack mini\n@anchors data\n[core]\ndata modeling | modeling data | model data\nKubernetes !\n[extended]\nvpc peering\n";

    fn spoken<'a>(lex: &Lexicon, text: &'a str) -> Vec<&'a str> {
        lex.matches(&phrase::tokenize(text))
            .into_iter()
            .map(|m| &text[m.span.start..m.span.end])
            .collect()
    }

    #[test]
    fn stem_collapses_inflections() {
        for w in ["model", "models", "modeled", "modeling", "modelling"] {
            assert_eq!(stem(w), "model", "{w}");
        }
        assert_eq!(stem("queries"), stem("query"));
        assert_eq!(stem("caches"), stem("caching"));
        assert_eq!(stem("cache"), stem("caching"));
        // Short words, digits and symbols pass through untouched.
        assert_eq!(stem("api"), "api");
        assert_eq!(stem("s3"), "s3");
        assert_eq!(stem("k8s"), "k8s");
        assert_eq!(stem("class"), "class");
    }

    #[test]
    fn parse_reads_header_sections_variants_and_standalone() {
        let pack = parse_pack(MINI).unwrap();
        assert_eq!(pack.id, "mini");
        assert_eq!(pack.anchors, vec!["data"]);
        assert_eq!(pack.entries.len(), 3);
        assert_eq!(
            pack.entries[0].variants,
            vec!["modeling data", "model data"]
        );
        assert!(pack.entries[1].standalone);
        assert_eq!(pack.entries[2].tier, Tier::Extended);
    }

    #[test]
    fn parse_reports_line_numbers() {
        let errs = parse_pack("@pack x\n@anchors a\nfoo\n").unwrap_err();
        assert!(errs.iter().any(|e| e.starts_with("line 3")), "{errs:?}");
        let errs = parse_pack("[core]\nfoo\n").unwrap_err();
        assert!(errs.iter().any(|e| e.contains("missing @pack")), "{errs:?}");
    }

    #[test]
    fn matches_spoken_variant_and_inflection() {
        let lex = lex_from(MINI);
        assert_eq!(
            spoken(&lex, "When did you use an ORM for modeling data?"),
            vec!["modeling data"]
        );
        assert_eq!(
            spoken(&lex, "We did data modeling last year."),
            vec!["data modeling"]
        );
        // Inflection: models / modeled meet model.
        assert_eq!(spoken(&lex, "She modeled data well."), vec!["modeled data"]);
        assert_eq!(spoken(&lex, "kubernetes is hard"), vec!["kubernetes"]);
    }

    #[test]
    fn does_not_match_across_hard_gaps_or_partial_words() {
        let lex = lex_from(MINI);
        assert!(spoken(&lex, "We modeled. Data came later.").is_empty());
        assert!(spoken(&lex, "We modeled, data mostly.").is_empty());
        assert!(spoken(&lex, "datamodeling is one word").is_empty());
        // A lone generic word never matches by itself.
        assert!(spoken(&lex, "The data was fine.").is_empty());
    }

    #[test]
    fn longest_entry_wins_at_a_start_position() {
        let lex = lex_from("@pack p\n@anchors a\n[core]\ndata modeling !\ndata modeling tool\n");
        assert_eq!(
            spoken(&lex, "an in-house data modeling tool"),
            vec!["data modeling tool"]
        );
    }

    #[test]
    fn symbol_gaps_are_respected() {
        let lex = lex_from("@pack p\n@anchors a\n[core]\nCI/CD !\nNode.js !\n");
        assert_eq!(
            spoken(&lex, "we run CI/CD on Node.js"),
            vec!["CI/CD", "Node.js"]
        );
        assert!(spoken(&lex, "we run CI CD").is_empty());
    }

    #[test]
    fn lint_flags_noise_generic_short_and_duplicates() {
        let bad = parse_pack(
            "@pack b\n@anchors a\n[core]\nKubernetes\ndata !\norm !\nVPC !\nthe !\ndata modeling\nData Models\n",
        )
        .unwrap();
        let issues = lint_pack(&bad).join("\n");
        assert!(
            issues.contains("\"Kubernetes\": single word without"),
            "{issues}"
        );
        assert!(issues.contains("\"data\": generic single word"), "{issues}");
        assert!(
            issues.contains("\"orm\": short single word must be ALL CAPS"),
            "{issues}"
        );
        assert!(issues.contains("only stopword/noise"), "{issues}");
        assert!(issues.contains("duplicate"), "{issues}");
        assert!(!issues.contains("\"VPC\""), "{issues}");
    }

    #[test]
    fn every_bundled_pack_parses_and_lints_clean() {
        for (id, src) in BUNDLED_SOURCES {
            let pack = parse_pack(src).unwrap_or_else(|e| panic!("{id}: {e:?}"));
            assert_eq!(&pack.id, id);
            let issues = lint_pack(&pack);
            assert!(issues.is_empty(), "{id} lint:\n{}", issues.join("\n"));
        }
    }

    #[test]
    fn bundled_pack_matches_a_realistic_message_within_budget() {
        let lex = Lexicon::from_pack_ids(&["software-engineering"]);
        assert!(lex.len() > 500, "pack unexpectedly small: {}", lex.len());
        let text = "Can you explain how API gateway integrates with Lambda, and when did you use an ORM for modeling data on the VPC of AWS with Kubernetes and CI/CD pipelines?";
        let toks = phrase::tokenize(text);
        let t0 = std::time::Instant::now();
        for _ in 0..200 {
            let _ = lex.matches(&toks);
        }
        let per = t0.elapsed() / 200;
        // Generous bound (debug builds, loaded CI): the real cost is microseconds.
        assert!(per.as_millis() < 20, "matching too slow: {per:?}");
    }

    #[test]
    fn select_packs_needs_enough_anchor_hits_and_no_context_means_none() {
        assert!(select_packs(&SelectionInput::default()).is_empty());
        // One stray anchor is not enough.
        let weak = SelectionInput {
            title: "Sales call about our API",
            ..Default::default()
        };
        assert!(select_packs(&weak).is_empty());
        let jd = "Senior backend engineer: microservices on Kubernetes, AWS Lambda, SQL databases, REST APIs.";
        let strong = SelectionInput {
            title: "Amazon SDE interview",
            job_description: Some(jd),
            ..Default::default()
        };
        assert_eq!(select_packs(&strong), vec!["software-engineering"]);
        // An accounting interview matches nothing yet.
        let acct = SelectionInput {
            title: "Senior Accountant interview",
            purpose: "GAAP, month-end close, audit readiness",
            ..Default::default()
        };
        assert!(select_packs(&acct).is_empty());
    }
}
