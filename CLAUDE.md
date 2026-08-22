# websocial 작업 규칙

한국어 웹소설 자동 집필 파이프라인. CLI 하나로 기획부터 원고 내보내기까지 처리한다.

## 실행

```bash
node src/cli.ts <명령>     # 빌드 없음 (Node 22 네이티브 타입 스트리핑)
npm run check              # tsc --noEmit + node --test
```

수정 후에는 반드시 `npm run check` 를 돌린다. 테스트는 네트워크 없이 통과해야 한다.

## 구조

- `src/core/` 도메인 타입(zod) · 파일 저장소 · 프롬프트 렌더러 · 컨텍스트 조립 · 연속성 원장
- `src/llm/` 제공자 어댑터(anthropic / openai-compat / gemini / mock) + 라우팅 엔진 + 단가표
- `src/qa/` 규칙 기반 지표와 AI 심사 종합
- `src/commands/` CLI 명령별 구현
- `prompts/*.md` 프롬프트 템플릿. **코드가 아니라 데이터다.** 문체 변경은 여기서.

## 지켜야 할 것

1. **zod 스키마가 단일 진실이다.** 새 산출물을 추가하면 `src/core/types.ts` 에 스키마를 먼저 정의하고,
   그 스키마를 구조화 출력·파일 검증·TS 타입에 함께 쓴다.
2. **Anthropic 호출은 공식 SDK로만 한다.** `fetch` 로 직접 치지 않는다.
   Opus 5 계열은 `temperature`/`top_p` 를 받지 않고(400), assistant prefill 도 불가능하다.
   사고 설정은 `thinking: {type:"adaptive"}`, 깊이는 `output_config.effort` 로 준다.
3. **system 블록 순서를 바꾸지 않는다.** 문체 지침 → 시리즈 요약 → 설정집 순서가 프롬프트 캐시 접두부다.
   순서나 내용이 흔들리면 캐시가 통째로 무효화돼 비용이 몇 배로 뛴다.
4. **제공자를 추가할 때는** `src/llm/provider.ts` 의 `Provider` 인터페이스만 구현하고
   `presets.ts` 에 프리셋을 등록한다. 파이프라인 코드는 손대지 않는다.
5. **실패를 조용히 넘기지 않는다.** 스키마 불일치, 프롬프트 변수 누락, 검수 미통과는 모두 명시적으로 멈춘다.
   사용자에게 보여줄 오류는 `UserError(message, hint)` 로 던진다.
6. **비용이 드는 코드를 테스트에 넣지 않는다.** 새 기능은 mock 제공자나 로컬 스텁 서버로 검증한다.

## 저장소 규칙

- `projects/` 하위 산출물은 git 에 올리지 않는다(.gitignore).
- 모델 식별자를 커밋 메시지나 코드 주석에 남기지 않는다.
