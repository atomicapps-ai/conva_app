//! On-disk store for typed table artifacts (one per CSV / XLSX document).
//!
//! The prose chunks that make a spreadsheet searchable live in the normal RAG
//! document JSON. The typed dataset that lets us add numbers up exactly lives
//! here, beside it, as `rag/tables/<doc-id>.table`. It is deliberately not a
//! `.json` file in the `rag/` directory, because `RagStore::reload` treats
//! every `*.json` there as a document.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use conva_core::table::TableDataset;
use conva_core::CoreError;

/// Datasets kept parsed in memory. A 100,000-row sheet is a few tens of MB,
/// so the cache is small; a miss costs one file read.
const CACHE_LIMIT: usize = 8;

pub struct TableStore {
    dir: PathBuf,
    cache: Mutex<HashMap<String, Arc<TableDataset>>>,
}

impl TableStore {
    /// Open (creating if needed) the `tables` folder under the RAG directory.
    pub fn open(rag_dir: &Path) -> Result<Self, CoreError> {
        let dir = rag_dir.join("tables");
        fs::create_dir_all(&dir).map_err(|e| CoreError::Rag(e.to_string()))?;
        Ok(Self {
            dir,
            cache: Mutex::new(HashMap::new()),
        })
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.table"))
    }

    /// Persist a dataset (write-then-rename, so a crash never leaves half a file).
    pub fn save(&self, ds: &TableDataset) -> Result<(), CoreError> {
        let json = serde_json::to_vec(ds).map_err(|e| CoreError::Rag(e.to_string()))?;
        let final_path = self.path(&ds.doc_id);
        let tmp = self.dir.join(format!("{}.table.tmp", ds.doc_id));
        fs::write(&tmp, json).map_err(|e| CoreError::Rag(e.to_string()))?;
        fs::rename(&tmp, &final_path).map_err(|e| CoreError::Rag(e.to_string()))?;
        let mut cache = self.cache.lock().expect("table cache");
        cache.remove(&ds.doc_id);
        Ok(())
    }

    /// The dataset for `id`, if the document has one. Unreadable or
    /// out-of-date files read as "none" so a bad sidecar never breaks Ally.
    pub fn load(&self, id: &str) -> Option<Arc<TableDataset>> {
        if let Some(hit) = self.cache.lock().expect("table cache").get(id) {
            return Some(hit.clone());
        }
        let bytes = fs::read(self.path(id)).ok()?;
        let ds: TableDataset = serde_json::from_slice(&bytes).ok()?;
        if ds.schema_version != conva_core::table::TABLE_SCHEMA_VERSION {
            return None;
        }
        let ds = Arc::new(ds);
        let mut cache = self.cache.lock().expect("table cache");
        if cache.len() >= CACHE_LIMIT {
            // Evict one entry, not the lot, so a few busy tables stay resident.
            if let Some(victim) = cache.keys().next().cloned() {
                cache.remove(&victim);
            }
        }
        cache.insert(id.to_string(), ds.clone());
        Some(ds)
    }

    /// Best-effort removal (a missing file is fine).
    pub fn remove(&self, id: &str) {
        let _ = fs::remove_file(self.path(id));
        self.cache.lock().expect("table cache").remove(id);
    }

    /// The datasets among `scope` (an active Context's attached document
    /// ids), in scope order. An empty scope yields nothing: table answers are
    /// only ever computed from documents the Context is explicitly attached to.
    pub fn datasets_for(&self, scope: &[String]) -> Vec<Arc<TableDataset>> {
        scope.iter().filter_map(|id| self.load(id)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use conva_core::table::{build_dataset, BuildOptions, RawCell};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("conva-tables-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn dataset(id: &str) -> TableDataset {
        let grid: Vec<Vec<RawCell>> = [["District", "Amount"], ["North", "10"]]
            .iter()
            .map(|r| r.iter().map(|c| RawCell::text(*c)).collect())
            .collect();
        build_dataset(
            &grid,
            &BuildOptions {
                doc_id: id.into(),
                file_name: format!("{id}.csv"),
                ..Default::default()
            },
        )
    }

    #[test]
    fn saves_loads_and_removes() {
        let dir = temp_dir("roundtrip");
        let store = TableStore::open(&dir).unwrap();
        store.save(&dataset("doc-1")).unwrap();
        let back = store.load("doc-1").expect("stored");
        assert_eq!(back.file_name, "doc-1.csv");
        assert!(store.load("nope").is_none());
        store.remove("doc-1");
        assert!(store.load("doc-1").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scope_limits_which_tables_are_visible() {
        let dir = temp_dir("scope");
        let store = TableStore::open(&dir).unwrap();
        store.save(&dataset("a")).unwrap();
        store.save(&dataset("b")).unwrap();
        assert!(store.datasets_for(&[]).is_empty());
        let got = store.datasets_for(&["b".to_string(), "missing".to_string()]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].doc_id, "b");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_or_newer_file_reads_as_no_table() {
        let dir = temp_dir("corrupt");
        let store = TableStore::open(&dir).unwrap();
        fs::write(dir.join("tables").join("bad.table"), b"{ not json").unwrap();
        assert!(store.load("bad").is_none());
        let mut newer = dataset("new");
        newer.schema_version = 999;
        fs::write(
            dir.join("tables").join("new.table"),
            serde_json::to_vec(&newer).unwrap(),
        )
        .unwrap();
        assert!(store.load("new").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn saving_again_replaces_the_cached_copy() {
        let dir = temp_dir("replace");
        let store = TableStore::open(&dir).unwrap();
        store.save(&dataset("x")).unwrap();
        assert_eq!(store.load("x").unwrap().rows.len(), 1);
        let mut bigger = dataset("x");
        bigger.rows.push(bigger.rows[0].clone());
        store.save(&bigger).unwrap();
        assert_eq!(store.load("x").unwrap().rows.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
