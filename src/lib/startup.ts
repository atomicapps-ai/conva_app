/** Ordered desktop startup gate. This keeps AppState-dependent initialization
 * behind the Rust readiness command and the splash open until init completes. */
export async function runStartup({
  wait,
  ready,
  init,
  finish,
  canContinue = () => true,
}: {
  wait: () => Promise<void>;
  ready: () => void;
  init: () => Promise<void>;
  finish: () => Promise<void>;
  canContinue?: () => boolean;
}): Promise<void> {
  await wait();
  if (!canContinue()) return;
  ready();
  await init();
  if (!canContinue()) return;
  await finish();
}
