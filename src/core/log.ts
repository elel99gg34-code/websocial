const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY === true && !process.env["NO_COLOR"];
const paint = (code: string, s: string) =>
  useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s;

/** 웹 UI 로 로그를 흘려보내기 위한 구독자 목록 */
type Sink = (level: "step" | "info" | "ok" | "warn" | "error" | "plain", message: string) => void;
const sinks = new Set<Sink>();

export function addLogSink(sink: Sink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

const emit = (level: Parameters<Sink>[0], message: string) => {
  for (const sink of sinks) sink(level, message);
};

export const log = {
  step(msg: string): void {
    console.log(paint("36;1", `> ${msg}`));
    emit("step", msg);
  },
  info(msg: string): void {
    console.log(`  ${msg}`);
    emit("info", msg);
  },
  ok(msg: string): void {
    console.log(paint("32", `  OK ${msg}`));
    emit("ok", msg);
  },
  warn(msg: string): void {
    console.warn(paint("33", `  ! ${msg}`));
    emit("warn", msg);
  },
  error(msg: string): void {
    console.error(paint("31;1", `X ${msg}`));
    emit("error", msg);
  },
  plain(msg: string): void {
    console.log(msg);
    emit("plain", msg);
  },
};

/** 사용자에게 그대로 보여줄 수 있는 예상된 오류 */
export class UserError extends Error {
  readonly hint: string;
  constructor(message: string, hint = "") {
    super(message);
    this.name = "UserError";
    this.hint = hint;
  }
}
