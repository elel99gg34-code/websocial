import { addLogSink } from "../core/log.ts";

export type JobLine = { i: number; level: string; message: string };
export type JobStatus = "running" | "done" | "error";

export type Job = {
  id: string;
  slug: string;
  label: string;
  status: JobStatus;
  lines: JobLine[];
  error: string;
  startedAt: string;
  finishedAt: string;
};

/**
 * 웹 UI 가 띄운 작업 하나를 추적한다.
 * 로그는 전역 싱크로 받아 적재하므로 동시에 한 작업만 실행한다.
 */
export class JobManager {
  readonly #jobs = new Map<string, Job>();
  #runningId = "";

  get running(): Job | undefined {
    return this.#runningId === "" ? undefined : this.#jobs.get(this.#runningId);
  }

  get(id: string): Job | undefined {
    return this.#jobs.get(id);
  }

  start(slug: string, label: string, work: () => Promise<void>): Job {
    if (this.running !== undefined) {
      throw new Error("이미 실행 중인 작업이 있습니다. 끝난 뒤에 다시 시도하세요.");
    }

    const job: Job = {
      id: `job-${Date.now().toString(36)}`,
      slug,
      label,
      status: "running",
      lines: [],
      error: "",
      startedAt: new Date().toISOString(),
      finishedAt: "",
    };
    this.#jobs.set(job.id, job);
    this.#runningId = job.id;

    const detach = addLogSink((level, message) => {
      job.lines.push({ i: job.lines.length, level, message });
      if (job.lines.length > 5000) job.lines.splice(0, 1000);
    });

    void work()
      .then(() => {
        job.status = "done";
      })
      .catch((err: unknown) => {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        job.lines.push({ i: job.lines.length, level: "error", message: job.error });
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        detach();
        this.#runningId = "";
      });

    return job;
  }
}
