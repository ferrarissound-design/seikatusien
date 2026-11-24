import { runChecklistResets, runTaskRollover } from './actions';
import { checkReminders } from '../notify/notifier';

/**
 * 日付に関わる定期処理。
 * iOS ではバックグラウンド処理が保証されないため、
 * 「起動時」「画面に戻ったとき」「表示中は1分ごと」に実行する。
 * どの処理も何度実行しても結果が同じ（冪等）になるよう実装している。
 */
let running = false;

export async function runDailyMaintenance(now: Date = new Date()) {
  if (running) return;
  running = true;
  try {
    await runChecklistResets(now);
    await runTaskRollover(now);
    await checkReminders(now);
  } catch {
    // 保存失敗は repo 層で利用者に通知済み
  } finally {
    running = false;
  }
}

export function startDailyMaintenance() {
  void runDailyMaintenance();
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') void runDailyMaintenance();
  }, 60_000);
  const onVis = () => {
    if (document.visibilityState === 'visible') void runDailyMaintenance();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVis);
  };
}
