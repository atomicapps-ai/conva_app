# Conva Desktop Live Claim Testing

This guide tests the desktop FANER claim workflow from app launch through a
saved Conversation review. It is written for the current feature branch and
does not require automatic web verification.

## 1. Prepare the checkout

Open PowerShell and run:

```powershell
$expectedBranch = "codex/faner-claim-intelligence-ui"
Set-Location "C:\Projects\atomicapps\conva\conva_app"
$currentBranch = git branch --show-current
if ($currentBranch -ne $expectedBranch -and (git status --porcelain)) {
    throw "Uncommitted work exists on $currentBranch. Stop and review it before switching branches."
}
git fetch origin
git switch $expectedBranch
if ((git branch --show-current) -ne $expectedBranch) {
    throw "The required branch is not active."
}
git pull --ff-only origin $expectedBranch
npm install
```

`npm install` can be skipped when dependencies are already current.

## 2. Start the desktop app

On Windows, run:

```powershell
npm run tauri:gpu
```

Keep the terminal open. The first GPU build can take several minutes. Do not
use `npm run dev`: that opens the browser-only UI without the Tauri audio or
desktop claim producer.

## 3. Check the startup splash

After pulling the splash sequencing fix, fully stop any older development app
with `Ctrl+C`, start it again with `npm run tauri:gpu`, and confirm this visible
order:

1. The artwork appears fully rendered at 0% with **Starting…**.
2. The bar advances to 35% with **Loading your library…**.
3. It advances to 60% with **Preparing your workspace…**.
4. It advances to 85% with **Almost ready…**.
5. It reaches 100% with **Ready**.
6. After a brief completion beat, the splash crossfades into the main app.

On a slow launch, the bar may pause at a real milestone. It must never move
backward, appear first at 85%, disappear without reaching Ready, show a blank
native window, or reveal the main app before initialization completes.

Record whether the run was a cold launch (first launch after a rebuild) or a
warm launch.

## 4. Configure Conversation Intelligence

1. Open **Settings**.
2. Select **Ally**.
3. Select the Fast provider and model you intend to test.
4. Store its API key if the provider requires one, then select **Test**.
5. Confirm the provider test succeeds.
6. Enable **Conversation intelligence — claim, commitment & entity
   extraction during sessions**.
7. Return to **Live**.

The setting applies on the next session start. If you changed it while a
session was active, end that session and start a new one.

## 5. Activate a test Context

For the first run, use a prepared Live Stream Context with:

- Title: `Nolan Wells case`
- Purpose: `Cover the Nolan Wells case accurately`
- Role: `Live host`
- Key terms: `Nolan Wells`, `Matt`, `boat`, `Arizona crash`, `ABC News`

From Live:

1. Select **Select context** at the top.
2. Check the Nolan Wells Context.
3. Select **Select** in the picker.
4. Confirm its title appears in the Live header before starting.

The producer also works with General conversation, but references are more
likely to remain unresolved without an active Context.

## 6. Generate and inspect Context resources

Before the live claim test, open the Nolan Wells Context and select **Generate
resources**. Confirm:

1. The button changes to a busy state while work is running.
2. **Context Intelligence Pack** finishes Ready.
3. **Prepared Q&A** finishes Ready even when web research is switched off or
   no Tavily key is configured.
4. With research enabled and a working Tavily key, **Research findings** is a
   separate cited resource. Without a key, the status clearly says Blocked.
5. The Q&A tab contains question-and-answer pairs appropriate for a Live Stream,
   not interview questions.
6. Briefing and Research open as formatted documents: headings, lists, bold
   terms, and links are visually styled. Select **Raw** and confirm the exact
   Markdown remains available, then switch back to **Formatted**.
7. The Context's attached source files still appear in its Knowledge base and
   Context resources folder after generation.

The separate Research and Q&A resources are for review. Context Intelligence is
the one generated document in the live retrieval scope, and its provenance
section must distinguish user-provided files from Ally web research.

## 7. Test attributed claim B

1. Select **Start listening**.
2. Speak clearly:

   > ABC News is reporting that both people died in that car crash in Arizona.

3. Confirm the sentence appears as a finalized transcript line.
4. Wait for the configured Fast model to respond; allow several seconds after
   transcription finalizes.
5. Open **Tracking** in the Ally panel.

Expected result:

- a claim about both people dying appears;
- `ABC News` remains an attribution and is not presented as proof;
- consequence is **High**;
- `that car crash` is resolved only if Conva has a deterministic Context
  target; otherwise the state is **Needs context**;
- the expanded row says **No admitted evidence yet**;
- no web search or automatic verification starts.

## 8. Test compound statement A

While the same session is active, speak:

> I can see in the video by his friend Matt that the boat had 7 people in it.

Expected result:

- the valuable proposition about the boat having seven people appears in
  Tracking;
- the quantity `7 people` is retained;
- `Matt`, `the video`, and `the boat` remain contextual or unresolved rather
  than being silently bound to invented identities;
- repeated processing does not add duplicate copies of the same claim.

## 9. Test another supported Context

Repeat with one existing Interview, Company Meeting, Sales Call, or Other
Context. Suggested statements:

- Interview: `I increased monthly close accuracy by 18 percent last quarter.`
- Company Meeting: `Revenue increased 12 percent in the second quarter.`
- Sales Call: `The renewal price is fixed at twenty-four thousand dollars.`
- Other: `The clinic changed the appointment to Thursday at 9 AM.`

Confirm the same Tracking UI is used and that the Context role/policy changes
interpretation without creating a separate product mode.

## 10. Test persistence and Claim Review

1. Select **End**.
2. Save the conversation in the offered save dialog.
3. Open **Conversations**.
4. Select the saved Conversation.
5. Select **Review Claims**.

Expected result:

- claims belong to this saved transcript;
- exact speech, attribution, references, state, consequence, and policy are
  retained;
- superseded claims are preserved for audit but omitted from active Tracking;
- reopening the app and Conversation does not lose the review.

## 11. What is intentionally unavailable

- **Check claim** does not yet execute a verification provider.
- No automatic web research is enabled by claim detection.
- No claim-confidence conclusion is created without admitted evidence.
- Browser-hosted sessions do not yet produce semantic claim snapshots.

## 12. If no claim appears

Check, in order:

1. The transcript line is final rather than an interim line.
2. Conversation Intelligence was enabled before the session started.
3. The Fast provider test succeeded.
4. The app was started with `npm run tauri:gpu`.
5. Tracking is expanded.
6. Several seconds have passed after transcription finalized.
7. The terminal has not reported a provider or FANER semantic-worker error.

End the session, correct the setting/provider, and start a fresh session before
retrying.

## 13. Issue report template

For each problem, record:

```text
Build/commit:
Cold or warm launch:
Active Context and role:
Fast provider/model:
Exact words spoken:
Final transcript text:
Expected result:
Actual result:
Approximate delay:
Screenshot or recording:
Relevant terminal error (do not include API keys):
```

Stop the development app with `Ctrl+C` in the PowerShell window.
