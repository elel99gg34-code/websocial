import { z } from "zod";
import { JudgeSchema } from "../core/types.ts";
import type { Judge } from "../core/types.ts";
import type { Metric, MetricReport } from "./metrics.ts";

export const MetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  level: z.enum(["error", "warn", "info"]),
  ok: z.boolean(),
  value: z.string(),
  detail: z.string(),
});

export const QaReportSchema = z.object({
  episode: z.number().int(),
  checkedAt: z.string(),
  verdict: z.enum(["pass", "revise"]),
  charCount: z.number().int(),
  reasons: z.array(z.string()),
  revisionNotes: z.array(z.string()),
  metrics: z.array(MetricSchema),
  judge: JudgeSchema.nullable(),
});
export type QaReport = z.infer<typeof QaReportSchema>;

/** warn 이 이 개수 이상이면 하드 에러가 없어도 퇴고시킨다 */
const WARN_LIMIT = 4;

const describe = (m: Metric): string =>
  `${m.label}: ${m.value}${m.detail === "" ? "" : ` (${m.detail})`}`;

export function buildQaReport(
  episode: number,
  report: MetricReport,
  judge: Judge | null,
): QaReport {
  const reasons: string[] = [];
  const revisionNotes: string[] = [];

  for (const m of report.errors) reasons.push(`[검사 실패] ${describe(m)}`);
  if (report.warnings.length >= WARN_LIMIT) {
    reasons.push(`[경고 누적] 경고 ${report.warnings.length}건`);
  }
  for (const m of report.warnings) revisionNotes.push(`${describe(m)} — 개선할 것`);

  if (judge !== null) {
    for (const violation of judge.continuityViolations) {
      reasons.push(`[설정 모순] ${violation}`);
      revisionNotes.push(`설정 모순 수정: ${violation}`);
    }
    if (judge.verdict === "revise") {
      reasons.push("[AI 심사] 퇴고 필요 판정");
    }
    for (const note of judge.revisionNotes) revisionNotes.push(note);
    for (const issue of judge.issues) {
      if (issue.severity.includes("치명")) {
        reasons.push(`[치명] ${issue.problem}`);
      }
      revisionNotes.push(`${issue.where} → ${issue.fix}`);
    }
  }

  return {
    episode,
    checkedAt: new Date().toISOString(),
    verdict: reasons.length === 0 ? "pass" : "revise",
    charCount: report.charCount,
    reasons,
    revisionNotes: [...new Set(revisionNotes)].filter((n) => n.trim() !== ""),
    metrics: report.metrics,
    judge,
  };
}

/** CLI 출력을 위한 요약 라인 */
export function summarizeQa(report: QaReport): string[] {
  return report.metrics
    .filter((m) => m.level !== "info")
    .map((m) => `${m.ok ? "OK  " : m.level === "error" ? "FAIL" : "WARN"} ${describe(m)}`);
}
