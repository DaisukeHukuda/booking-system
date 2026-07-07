// 予約締切: 参加日の deadlineDays 日前の deadlineTime（JST）まで予約可能。
// deadlineDays が null なら締切なし。deadlineTime 省略時は 23:59。
// 代理店ページのみに適用する（管理画面の手入力は締切後も可能）。
export function isBeforeDeadline(
  date: string,
  deadlineDays: number | null,
  deadlineTime: string | null,
  nowMs: number = Date.now()
): boolean {
  if (deadlineDays === null) return true;
  const time = deadlineTime ?? '23:59';
  const deadlineMs = Date.parse(`${date}T${time}:00+09:00`) - deadlineDays * 86_400_000;
  return nowMs <= deadlineMs;
}
