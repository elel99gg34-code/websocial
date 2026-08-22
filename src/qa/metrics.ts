import type { QaThresholds } from "../core/types.ts";

export type MetricLevel = "error" | "warn" | "info";

export type Metric = {
  id: string;
  label: string;
  level: MetricLevel;
  ok: boolean;
  value: string;
  detail: string;
};

export type MetricReport = {
  charCount: number;
  charCountNoSpace: number;
  paragraphs: number;
  sentences: number;
  dialogueRatio: number;
  avgSentenceLength: number;
  metrics: Metric[];
  errors: Metric[];
  warnings: Metric[];
};

/** 어느 작품에나 공통으로 걸리는 AI 상투구 */
export const DEFAULT_BANNED_PHRASES = [
  "묘한 이질감",
  "알 수 없는 감정",
  "복잡한 심경",
  "말로 표현할 수 없는",
  "형언할 수 없는",
  "무언가 잘못되었다는 것을 직감했다",
  "그것은 시작에 불과했다",
];

const META_PATTERNS: { re: RegExp; what: string }[] = [
  { re: /제\s*\d+\s*화/, what: "회차 번호 표기" },
  { re: /다음\s*화에\s*계속/, what: "연재 안내 문구" },
  { re: /작가의\s*말/, what: "작가의 말" },
  { re: /^\s*#{1,6}\s+\S/m, what: "마크다운 헤딩" },
  { re: /^\s*\*{3,}\s*$/m, what: "구분선" },
];

/** 조사 앞의 2~4글자 한글 덩어리 중 고유명사 후보를 걸러내기 위한 흔한 낱말 */
const COMMON_WORDS = new Set([
  "그것", "이것", "저것", "사람", "시간", "생각", "이야기", "목소리", "마음", "얼굴",
  "자신", "여자", "남자", "아이", "순간", "상황", "문제", "눈빛", "어깨", "머리",
  "가슴", "표정", "공기", "소리", "바람", "하늘", "세상", "세계", "회사", "사무실",
  "자리", "자기", "우리", "당신", "지금", "오늘", "내일", "어제", "이번", "다음",
  "처음", "마지막", "전부", "모두", "아무", "누구", "무엇", "이유", "결과", "방법",
  "정도", "사실", "대답", "질문", "눈물", "웃음", "사이", "안색", "손끝", "발끝",
  "휴대폰", "서류", "계약서", "명함", "우산", "커피잔", "창밖", "손목시계", "버튼",
  "노인", "사내", "비서", "형사", "점원", "기사", "청년", "지배인", "봉투", "풍경",
  "그녀", "그들", "이제", "아직", "결국", "물론", "정말", "역시", "혹시", "설마",
  "말투", "대화", "분위기", "기억", "약속", "선택", "기회", "위치", "장소", "방향",
  "한참", "이름", "증거", "여유", "생각", "얘기", "말씀", "행동", "표현", "느낌",
  "시선", "숨결", "온도", "냄새", "그림자", "발소리", "정적", "침묵", "고개", "손등",
]);

/* 조사 후보. "도/만" 은 용언 뒤에도 붙어 오탐이 많아 제외한다 */
const PARTICLE = /(은|는|이|가|을|를|의|와|과|에게|에서|께서)/;
/* 사람·고유명사에 주로 붙는 조사. 하나라도 동반해야 후보로 인정한다 */
const ANIMATE_PARTICLE = new Set(["은", "는", "이", "가", "께서", "에게"]);

export function countChars(text: string): number {
  return [...text].length;
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function splitSentences(text: string): string[] {
  return splitParagraphs(text)
    .flatMap((p) => p.split(/(?<=[.!?…])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function dialogueRatio(text: string): number {
  const total = countChars(text.replace(/\s/g, ""));
  if (total === 0) return 0;
  const matches = text.match(/"[^"]{1,400}"|'[^']{1,400}'|「[^」]{1,400}」/g) ?? [];
  const inside = matches.reduce(
    (sum, m) => sum + countChars(m.replace(/\s/g, "")),
    0,
  );
  return inside / total;
}

/** 문장 종결부 2글자 (리듬 단조로움 검사용) */
function endingOf(sentence: string): string {
  const stripped = sentence.replace(/["'」\s]+$/, "").replace(/[.!?…]+$/, "");
  return stripped.slice(-2);
}

export function longestEndingRun(sentences: string[]): { run: number; ending: string } {
  let best = { run: 0, ending: "" };
  let current = "";
  let length = 0;
  for (const sentence of sentences) {
    const ending = endingOf(sentence);
    if (ending === current && ending !== "") {
      length += 1;
    } else {
      current = ending;
      length = 1;
    }
    if (length > best.run) best = { run: length, ending };
  }
  return best;
}

export function repeatedPhrases(text: string, n = 4): Map<string, number> {
  const tokens = text
    .replace(/["'「」]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[.,!?…]+$/, ""))
    .filter((t) => t.length > 0);
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i += 1) {
    const gram = tokens.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

export function properNounCandidates(text: string, known: string[]): string[] {
  const knownSet = new Set(known.flatMap((k) => [k, ...k.split(/\s+/)]));
  const counts = new Map<string, number>();
  const animate = new Set<string>();
  const re = new RegExp(`(?<![가-힣])([가-힣]{2,4})${PARTICLE.source}(?![가-힣])`, "g");
  for (const match of text.matchAll(re)) {
    const word = match[1] ?? "";
    if (word === "" || COMMON_WORDS.has(word) || knownSet.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
    if (ANIMATE_PARTICLE.has(match[2] ?? "")) animate.add(word);
  }
  return [...counts.entries()]
    .filter(([word, count]) => count >= 3 && animate.has(word))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => `${word}(${count}회)`);
}

const metric = (
  id: string,
  label: string,
  level: MetricLevel,
  ok: boolean,
  value: string,
  detail = "",
): Metric => ({ id, label, level, ok, value, detail });

/**
 * 규칙 기반 원고 검사. LLM 없이 즉시 실행되며 비용이 0이다.
 * error 는 자동 퇴고를 강제하는 하드 게이트, warn 은 퇴고 지시에 참고로 넘긴다.
 */
export function analyzeDraft(
  text: string,
  qa: QaThresholds,
  knownNames: string[] = [],
): MetricReport {
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);
  const charCount = countChars(text);
  const charCountNoSpace = countChars(text.replace(/\s/g, ""));
  const min = Math.round(qa.charTarget * (1 - qa.charTolerance));
  const max = Math.round(qa.charTarget * (1 + qa.charTolerance));

  const ratio = dialogueRatio(text);
  const avgSentence =
    sentences.length === 0
      ? 0
      : sentences.reduce((sum, s) => sum + countChars(s), 0) / sentences.length;
  const longParagraphs = paragraphs.filter((p) => countChars(p) > 120).length;
  const longRatio = paragraphs.length === 0 ? 0 : longParagraphs / paragraphs.length;
  const endingRun = longestEndingRun(sentences);

  const repeats = [...repeatedPhrases(text).entries()]
    .filter(([, count]) => count > qa.repeatedPhraseMax)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const banned = [...new Set([...DEFAULT_BANNED_PHRASES, ...qa.bannedPhrases])].filter(
    (phrase) => phrase.trim() !== "" && text.includes(phrase),
  );

  const meta = META_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.what);
  const unknownNouns = properNounCandidates(text, knownNames);
  const lastParagraph = paragraphs.at(-1) ?? "";

  const metrics: Metric[] = [
    metric(
      "charCount",
      "분량(공백 포함)",
      "error",
      charCount >= min && charCount <= max,
      `${charCount}자`,
      `허용 범위 ${min}~${max}자 (목표 ${qa.charTarget}자)`,
    ),
    metric(
      "bannedPhrases",
      "금칙 표현",
      "error",
      banned.length === 0,
      banned.length === 0 ? "없음" : `${banned.length}건`,
      banned.join(" / "),
    ),
    metric(
      "metaText",
      "본문 오염(메타 텍스트)",
      "error",
      meta.length === 0,
      meta.length === 0 ? "없음" : `${meta.length}건`,
      meta.join(" / "),
    ),
    metric(
      "dialogueRatio",
      "대사 비율",
      "warn",
      ratio >= qa.dialogueRatioMin && ratio <= qa.dialogueRatioMax,
      `${(ratio * 100).toFixed(1)}%`,
      `권장 ${(qa.dialogueRatioMin * 100).toFixed(0)}~${(qa.dialogueRatioMax * 100).toFixed(0)}%`,
    ),
    metric(
      "avgSentence",
      "평균 문장 길이",
      "warn",
      avgSentence <= qa.avgSentenceMax,
      `${avgSentence.toFixed(1)}자`,
      `권장 ${qa.avgSentenceMax}자 이하`,
    ),
    metric(
      "longParagraph",
      "긴 문단 비율",
      "warn",
      longRatio <= qa.longParagraphRatioMax,
      `${(longRatio * 100).toFixed(1)}%`,
      `120자 초과 문단 ${longParagraphs}/${paragraphs.length}개, 권장 ${(qa.longParagraphRatioMax * 100).toFixed(0)}% 이하`,
    ),
    metric(
      "repeatedPhrase",
      "반복 표현",
      "warn",
      repeats.length === 0,
      repeats.length === 0 ? "없음" : `${repeats.length}종`,
      repeats.map(([gram, count]) => `"${gram}" ${count}회`).join(" / "),
    ),
    metric(
      "endingRun",
      "종결어미 연속",
      "warn",
      endingRun.run <= qa.endingRunMax,
      `${endingRun.run}연속`,
      endingRun.run > qa.endingRunMax ? `"...${endingRun.ending}" 반복` : "",
    ),
    metric(
      "unknownNoun",
      "설정집에 없는 고유명사 후보",
      "warn",
      unknownNouns.length === 0,
      unknownNouns.length === 0 ? "없음" : `${unknownNouns.length}종`,
      `${unknownNouns.join(", ")} (오탐 가능성 있는 추정치)`,
    ),
    metric(
      "lastLine",
      "마지막 문단",
      "info",
      true,
      `${countChars(lastParagraph)}자`,
      lastParagraph.slice(-80),
    ),
  ];

  return {
    charCount,
    charCountNoSpace,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    dialogueRatio: ratio,
    avgSentenceLength: avgSentence,
    metrics,
    errors: metrics.filter((m) => m.level === "error" && !m.ok),
    warnings: metrics.filter((m) => m.level === "warn" && !m.ok),
  };
}
