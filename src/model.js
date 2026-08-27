// 번들된 모델 저장소.
//
// 통합 이전에는 `model.onnx`를 별도로 챙기고 경로를 지정해야 했다. 이 패키지는
// 모델을 함께 담고 설치된 위치를 기준으로 경로를 알려준다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 번들된 모델 파일 이름. 결과의 `settings.model_file` 에 이 값이 실린다. */
export const MODEL_FILE = "model.onnx";

/**
 * 번들된 `model.onnx` 의 절대 경로.
 *
 * Node 에서만 쓸 수 있다 (파일 경로 개념이 있는 곳). 브라우저는
 * :func:`modelUrl` 대신 번들러가 파일을 처리하게 하거나 정적 경로를 직접 쓴다.
 */
export function modelPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "model", MODEL_FILE);
}

/**
 * 번들된 모델을 바이트로 읽는다.
 *
 * React Native 진입점은 **경로와 바이트를 둘 다** 요구한다 — 그쪽 ONNX 런타임이
 * 경로로 세션을 만들고, 클래스 맵은 바이트에서 읽기 때문이다.
 */
export function modelBytes() {
  return readFileSync(modelPath());
}
