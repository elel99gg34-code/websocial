const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY === true && !process.env["NO_COLOR"];
const paint = (code: string, s: string) =>
  useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s;

export const log = {
  step(msg: string): void {
    console.log(paint("36;1", `> ${msg}`));
  },
  info(msg: string): void {
    console.log(`  ${msg}`);
  },
  ok(msg: string): void {
    console.log(paint("32", `  OK ${msg}`));
  },
  warn(msg: string): void {
    console.warn(paint("33", `  ! ${msg}`));
  },
  error(msg: string): void {
    console.error(paint("31;1", `X ${msg}`));
  },
  plain(msg: string): void {
    console.log(msg);
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
