import { log } from "../core/log.ts";
import { PRESETS } from "../llm/presets.ts";

const TIER_LABEL: Record<string, string> = {
  free: "무료",
  freemium: "무료 티어 있음",
  paid: "유료",
  local: "로컬(완전 무료)",
};

export function cmdProviders(): void {
  log.step("사용 가능한 제공자");
  log.plain("");
  for (const preset of PRESETS) {
    const needsKey = preset.apiKeyEnv !== "";
    const configured = !needsKey || (process.env[preset.apiKeyEnv] ?? "").trim() !== "";
    const mark = configured ? "[사용 가능]" : "[키 없음]  ";
    log.plain(`${mark} ${preset.id.padEnd(11)} ${preset.label}`);
    log.plain(`             유형: ${TIER_LABEL[preset.tier] ?? preset.tier}`);
    log.plain(`             기본 모델: ${preset.defaultModel}`);
    if (needsKey) log.plain(`             환경변수: ${preset.apiKeyEnv}`);
    if (preset.signupUrl !== "") log.plain(`             발급: ${preset.signupUrl}`);
    log.plain(`             ${preset.note}`);
    log.plain("");
  }
  log.info("프로젝트 생성 예:");
  log.info("  novel init my-novel --idea \"...\" --provider gemini   # 전 단계 무료");
  log.info("  novel init my-novel --idea \"...\" --mode mixed        # 집필=Claude, 검수=무료");
  log.info("  novel init my-novel --idea \"...\" --provider ollama   # 로컬 완전 무료");
  log.info("");
  log.info("기존 프로젝트는 project.json 의 llm.profiles / llm.routes 를 고쳐 바꿀 수 있습니다.");
}
