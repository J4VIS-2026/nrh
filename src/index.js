// 나란히 — 보행 충돌 위험 평가 통합 라이브러리.
//
// **인식·분석·모델이 한 패키지에 들어 있다.** 예전에는 셋을 따로 챙겨야 했다:
// `nrh-detector` tgz, `naranhi-collision-assessor` tgz, `model.onnx`. 이제 하나다.
//
//   import { CollisionAssessor, Tracker, loadConfig, modelPath } from "naranhi";
//
// ## 이 파일은 런타임을 모른다
//
// 여기서 내보내는 것은 **계산뿐**이다 — 세션을 만들거나 영상을 읽는 것은 대상마다
// 다르므로 하위 경로에 있다.
//
// | 하위 경로 | 무엇 | 더 필요한 것 |
// |---|---|---|
// | `naranhi/node` | 영상 파일 → 판정 그린 mp4 | `onnxruntime-node`·`@napi-rs/canvas`·`ffmpeg-static` |
// | `naranhi/web` | 브라우저 (video·canvas) | `onnxruntime-web` |
// | `naranhi/native` | React Native | `onnxruntime-react-native` |
//
// ONNX 런타임을 이 패키지가 품지 않는 이유: **대상마다 다른 패키지이고 셋을 합치면
// 400MB가 넘는다.** 브라우저에서 쓰는 사람이 Node 바이너리를 받을 이유가 없다.
// 인식 모듈이 처음부터 그렇게 갈라 둔 설계를 그대로 따른다.
//
// ## 이름이 겹치면 어떻게 되나
//
// 두 모듈의 export 이름은 **지금 하나도 겹치지 않는다** (기계로 확인하고
// `test/exports.test.js` 가 못 박는다). 그래서 통째로 다시 내보낸다 — 손으로 목록을
// 유지하면 새 API 가 추가될 때마다 빠뜨린다.
//
// 만약 나중에 겹치면 ESM 은 **그 이름만 조용히 빼 버린다.** 그때 테스트가 먼저
// 깨지므로 알아차릴 수 있고, 아래 이름공간으로 우회할 수 있다.
//
//   import { detector, assessor } from "naranhi";
//   detector.letterbox(...)   assessor.loadConfig()

// ── 분석 (τ·위험도·경로 게이트·시나리오) ──────────────────────────────
export * from "naranhi-collision-assessor";

// ── 인식 (탐지·추적). 런타임을 모르는 부분만 ──────────────────────────
export * from "nrh-detector";

// ── 시나리오 7종 (영상·인식 없이 로직을 보여주는 교재) ───────────────
//
// 분석 모듈은 이것을 **하위 경로**에만 둔다 (상류 `src/index.js` 를 그대로 따르므로
// 뿌리에서 내보내지 않는다). 통합 진입점에서는 올려 준다 — 여기는 우리 패키지다.
export { SCENARIOS } from "naranhi-collision-assessor/samples/scenarios.js";

// ── 모델 저장소 ───────────────────────────────────────────────────────
export { MODEL_FILE, modelBytes, modelPath } from "./model.js";

// ── 이름공간으로 통째 접근 ────────────────────────────────────────────
export * as assessor from "naranhi-collision-assessor";
export * as detector from "nrh-detector";
