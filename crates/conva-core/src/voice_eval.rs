//! Pure evaluation metrics for voice-system validation.
//!
//! These functions do not perform recognition, speaker diarization, pitch
//! tracking, or intonation classification. They score the output of those
//! separate systems against human-labeled references so product accuracy can
//! be measured instead of inferred from plumbing tests.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AsrMetrics {
    pub reference_words: usize,
    pub substitutions: usize,
    pub deletions: usize,
    pub insertions: usize,
    pub word_error_rate: f64,
}

#[derive(Debug, Clone, Copy, Default)]
struct EditCell {
    substitutions: usize,
    deletions: usize,
    insertions: usize,
}

impl EditCell {
    fn errors(self) -> usize {
        self.substitutions + self.deletions + self.insertions
    }
}

fn normalized_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|word| {
            word.trim_matches(|character: char| !character.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

/// Word error rate with substitution, deletion, and insertion counts.
pub fn evaluate_asr(reference: &str, hypothesis: &str) -> AsrMetrics {
    let reference = normalized_words(reference);
    let hypothesis = normalized_words(hypothesis);
    let mut cells = vec![vec![EditCell::default(); hypothesis.len() + 1]; reference.len() + 1];

    for (index, row) in cells.iter_mut().enumerate().skip(1) {
        row[0].deletions = index;
    }
    for (index, cell) in cells[0].iter_mut().enumerate().skip(1) {
        cell.insertions = index;
    }

    for row in 1..=reference.len() {
        for column in 1..=hypothesis.len() {
            if reference[row - 1] == hypothesis[column - 1] {
                cells[row][column] = cells[row - 1][column - 1];
                continue;
            }

            let mut substitution = cells[row - 1][column - 1];
            substitution.substitutions += 1;
            let mut deletion = cells[row - 1][column];
            deletion.deletions += 1;
            let mut insertion = cells[row][column - 1];
            insertion.insertions += 1;
            cells[row][column] = [substitution, deletion, insertion]
                .into_iter()
                .min_by_key(|candidate| candidate.errors())
                .expect("the edit candidate set is non-empty");
        }
    }

    let result = cells[reference.len()][hypothesis.len()];
    let denominator = reference.len().max(1) as f64;
    AsrMetrics {
        reference_words: reference.len(),
        substitutions: result.substitutions,
        deletions: result.deletions,
        insertions: result.insertions,
        word_error_rate: result.errors() as f64 / denominator,
    }
}

/// One already time-aligned scoring interval. Speaker labels must be mapped to
/// the same canonical identities before calling [`evaluate_diarization`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiarizationInterval {
    pub duration_ms: u64,
    pub reference_speaker: Option<String>,
    pub hypothesis_speaker: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DiarizationMetrics {
    pub reference_speech_ms: u64,
    pub missed_speech_ms: u64,
    pub false_alarm_ms: u64,
    pub speaker_confusion_ms: u64,
    pub diarization_error_rate: f64,
}

/// Duration-weighted diarization error rate over pre-aligned intervals.
pub fn evaluate_diarization(intervals: &[DiarizationInterval]) -> DiarizationMetrics {
    let mut reference_speech_ms = 0;
    let mut missed_speech_ms = 0;
    let mut false_alarm_ms = 0;
    let mut speaker_confusion_ms = 0;

    for interval in intervals {
        if interval.reference_speaker.is_some() {
            reference_speech_ms += interval.duration_ms;
        }
        match (&interval.reference_speaker, &interval.hypothesis_speaker) {
            (Some(_), None) => missed_speech_ms += interval.duration_ms,
            (None, Some(_)) => false_alarm_ms += interval.duration_ms,
            (Some(reference), Some(hypothesis)) if reference != hypothesis => {
                speaker_confusion_ms += interval.duration_ms;
            }
            _ => {}
        }
    }

    let errors = missed_speech_ms + false_alarm_ms + speaker_confusion_ms;
    DiarizationMetrics {
        reference_speech_ms,
        missed_speech_ms,
        false_alarm_ms,
        speaker_confusion_ms,
        diarization_error_rate: errors as f64 / reference_speech_ms.max(1) as f64,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProsodyMetrics {
    pub frames: usize,
    pub jointly_voiced_frames: usize,
    pub voicing_accuracy: f64,
    pub f0_rmse_hz: Option<f64>,
}

/// Compare reference and detected fundamental frequency per aligned frame.
/// `None` means the frame is unvoiced.
pub fn evaluate_f0(
    reference: &[Option<f32>],
    hypothesis: &[Option<f32>],
) -> Option<ProsodyMetrics> {
    if reference.len() != hypothesis.len() {
        return None;
    }

    let mut voicing_matches = 0usize;
    let mut squared_error = 0.0f64;
    let mut jointly_voiced_frames = 0usize;
    for (reference_f0, hypothesis_f0) in reference.iter().zip(hypothesis) {
        if reference_f0.is_some() == hypothesis_f0.is_some() {
            voicing_matches += 1;
        }
        if let (Some(reference_f0), Some(hypothesis_f0)) = (reference_f0, hypothesis_f0) {
            let error = f64::from(*reference_f0) - f64::from(*hypothesis_f0);
            squared_error += error * error;
            jointly_voiced_frames += 1;
        }
    }

    Some(ProsodyMetrics {
        frames: reference.len(),
        jointly_voiced_frames,
        voicing_accuracy: voicing_matches as f64 / reference.len().max(1) as f64,
        f0_rmse_hz: (jointly_voiced_frames > 0)
            .then(|| (squared_error / jointly_voiced_frames as f64).sqrt()),
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IntonationMetrics {
    pub true_positives: usize,
    pub false_positives: usize,
    pub false_negatives: usize,
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
}

/// Binary scoring for a prosody classifier such as rising-question intonation.
pub fn evaluate_intonation(
    reference_positive: &[bool],
    hypothesis_positive: &[bool],
) -> Option<IntonationMetrics> {
    if reference_positive.len() != hypothesis_positive.len() {
        return None;
    }
    let mut true_positives = 0;
    let mut false_positives = 0;
    let mut false_negatives = 0;
    for (&reference, &hypothesis) in reference_positive.iter().zip(hypothesis_positive) {
        match (reference, hypothesis) {
            (true, true) => true_positives += 1,
            (false, true) => false_positives += 1,
            (true, false) => false_negatives += 1,
            (false, false) => {}
        }
    }
    let precision = true_positives as f64 / (true_positives + false_positives).max(1) as f64;
    let recall = true_positives as f64 / (true_positives + false_negatives).max(1) as f64;
    let f1 = if precision + recall == 0.0 {
        0.0
    } else {
        2.0 * precision * recall / (precision + recall)
    };
    Some(IntonationMetrics {
        true_positives,
        false_positives,
        false_negatives,
        precision,
        recall,
        f1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asr_metrics_count_word_edits() {
        let metrics = evaluate_asr("the quick brown fox", "the fast fox jumps");
        assert_eq!(metrics.reference_words, 4);
        assert_eq!(
            metrics.substitutions + metrics.deletions + metrics.insertions,
            3
        );
        assert!((metrics.word_error_rate - 0.75).abs() < f64::EPSILON);
        assert_eq!(
            evaluate_asr("Hello, WORLD!", "hello world").word_error_rate,
            0.0
        );
    }

    #[test]
    fn diarization_metrics_separate_error_types() {
        let intervals = vec![
            DiarizationInterval {
                duration_ms: 500,
                reference_speaker: Some("speaker-a".into()),
                hypothesis_speaker: Some("speaker-a".into()),
            },
            DiarizationInterval {
                duration_ms: 100,
                reference_speaker: Some("speaker-a".into()),
                hypothesis_speaker: None,
            },
            DiarizationInterval {
                duration_ms: 200,
                reference_speaker: None,
                hypothesis_speaker: Some("speaker-b".into()),
            },
            DiarizationInterval {
                duration_ms: 300,
                reference_speaker: Some("speaker-a".into()),
                hypothesis_speaker: Some("speaker-b".into()),
            },
        ];
        let metrics = evaluate_diarization(&intervals);
        assert_eq!(metrics.reference_speech_ms, 900);
        assert_eq!(metrics.missed_speech_ms, 100);
        assert_eq!(metrics.false_alarm_ms, 200);
        assert_eq!(metrics.speaker_confusion_ms, 300);
        assert!((metrics.diarization_error_rate - (600.0 / 900.0)).abs() < 1e-9);
    }

    #[test]
    fn prosody_metrics_score_voicing_and_pitch_separately() {
        let metrics = evaluate_f0(
            &[Some(100.0), Some(120.0), None, None],
            &[Some(110.0), Some(120.0), None, Some(90.0)],
        )
        .unwrap();
        assert_eq!(metrics.jointly_voiced_frames, 2);
        assert_eq!(metrics.voicing_accuracy, 0.75);
        assert!((metrics.f0_rmse_hz.unwrap() - 50.0f64.sqrt()).abs() < 1e-9);
    }

    #[test]
    fn intonation_metrics_score_question_rise_classification() {
        let metrics =
            evaluate_intonation(&[true, true, false, false], &[true, false, true, false]).unwrap();
        assert_eq!(metrics.true_positives, 1);
        assert_eq!(metrics.false_positives, 1);
        assert_eq!(metrics.false_negatives, 1);
        assert_eq!(metrics.precision, 0.5);
        assert_eq!(metrics.recall, 0.5);
        assert_eq!(metrics.f1, 0.5);
    }
}
