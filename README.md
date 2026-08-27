# naranhi

**보행 장애물을 찾고, 그것이 얼마나 위험한지 판단하는 라이브러리 하나.**
인식(YOLOv8 + BoT-SORT)·분석(TTC·위험도)·모델이 **한 패키지 안에** 있습니다.

```sh
git clone <이 저장소>
cd <저장소> && npm install
```

```js
import { CollisionAssessor, Tracker, detectFromTensor, modelPath } from "naranhi";
```

명령줄로 영상을 넣으면 판정을 그린 mp4 가 나옵니다.

```sh
npx naranhi 내영상.mp4          #  ->  내영상_risk.mp4
```

**모델 경로도 줄 필요가 없습니다** — 패키지 안에 들어 있습니다.

> **naranhi** — collision risk assessment for pedestrian navigation. Detection
> (YOLOv8 + BoT-SORT), risk assessment, and the ONNX model in a single package.
> Estimates time-to-collision from bounding-box growth alone — no depth sensor.
> Documentation is in Korean.

---

## 프로젝트 저장소 안내

이 저장소는 **나란히SDK의 대표 저장소**입니다. 통합 모듈의 소스코드와 모델,
실행 도구 및 문서를 제공하며, 분리 개발된 인식·분석·학습 저장소를 아래에 함께
정리합니다.

| 저장소 | 역할 |
|---|---|
| **[nrh](https://github.com/J4VIS-2026/nrh)** | 대표 저장소 · 인식과 위험 분석을 연결하는 통합 모듈, 모델 및 CLI |
| [nrh-detector](https://github.com/J4VIS-2026/nrh-detector) | 객체 탐지·추적 및 카메라 흔들림 보정 모듈 |
| [nrh-analysis](https://github.com/J4VIS-2026/nrh-analysis) | TTC·예상 경로·신뢰도 기반 위험도 및 우선순위 분석 모듈 |
| [nrh-train](https://github.com/J4VIS-2026/nrh-train) | 보행 장애물 인식 모델의 학습·평가·ONNX 변환 코드 |
| [yolov8n-sidewalk-obstacle](https://huggingface.co/J4VIS-2026/yolov8n-sidewalk-obstacle) | Hugging Face에 공개한 보행 장애물 인식 모델 가중치 |

## 무엇이 들어 있나

```
package.json          name: naranhi
src/                  진입점 — . /node /web /native /model
bin/naranhi.mjs       명령줄 도구
model/model.onnx      모델 — 24클래스 YOLOv8n int8 (3.3MB)
docs/설계.md           알고리즘 근거
```

인식과 분석 모듈은 저장소 안의 사본이 아니라 `package.json`에 고정된 GitHub Release
배포판을 설치합니다. **통합 모듈 자체의 빌드 단계는 없습니다.** 전부 평범한 `.js`이고
그대로 동작합니다. `npm install`은 두 모듈과 ONNX 런타임·ffmpeg·canvas를 받습니다.

| 하위 경로 | 무엇 |
|---|---|
| `naranhi` | 인식 + 분석 + 모델 API 전부 |
| `naranhi/node` | `analyzeVideo()` — 영상 파일 → 판정 그린 mp4 |
| `naranhi/web` | `createWebPipeline` (브라우저) |
| `naranhi/native` | `createNativePipeline` (React Native) |

## 위험도는 어떻게 나오나

```
risk_score = risk_from_ttc x class_weight x max(path_gate, 0.05) x max(reliability, 0.05)
```

네 값을 **그대로 곱하면 점수가 나옵니다.** 그래서 경보가 뜬(또는 안 뜬) 이유를 항상
숫자로 분해할 수 있습니다.

| 요인 | 무엇 |
|---|---|
| `risk_from_ttc` | 얼마나 임박했나. 시그모이드와 거리 기반 위험도 중 큰 값 |
| `class_weight` | 무엇인가. 24클래스 테이블 (최댓값 1.0) |
| `path_gate` | **τ초 후 예측 위치**가 보행 경로 안이면 1, 밖으로 갈수록 0.05까지 |
| `reliability` | `confidence x persistence` |

거리·속도를 직접 재지 않습니다. **박스가 커지는 속도**로 충돌까지 남은 시간 τ를
추정합니다 — 단안 카메라로는 거리를 못 재기 때문입니다.

## 인식 없이 로직만 보기

시나리오 7종이 들어 있습니다. **영상도 런타임도 필요 없습니다.**

```js
import { SCENARIOS, loadConfig, traceSequence } from "naranhi";

const s = SCENARIOS.find((x) => x.id === "crossing");
console.log(s.title, s.watch);
console.log(traceSequence(s.frames, loadConfig()));
```

## 반드시 지킬 것

**`class_id` 를 숫자로 박지 마세요.** 원본 29클래스에서 5쌍이 병합돼 24개가 되면서
번호가 밀렸습니다 (`person` 8→7, `bollard` 15→12). `class_name` 을 쓰거나
`readClassMap(modelBytes())` 로 모델에서 읽으세요.

**`tracker_id` 가 `null` 인 탐지가 정상적으로 있습니다** (실측 3.8%). 방금 나타나 아직
확정 전인 것들입니다. **한 프레임에 여럿일 수 있으니 React `key` 로 쓰면 안 됩니다.**

**`timestamp` 는 초 단위입니다.** 밀리초를 넣으면 τ가 1000배 어긋납니다.

**평가자를 리렌더마다 새로 만들지 마세요.** 상태를 잃어 τ가 영영 안 잡히는데
**예외가 안 납니다.** React 라면 `useRef` 에 담으세요.

**영상이 바뀌면 `Tracker` 와 `CollisionAssessor` 를 새로 만드세요** (또는 `reset()`).

## 테스트

```sh
npm install
npm test           # 통합 테스트 8개
```

분석 모듈의 세부 테스트 174개는
[nrh-analysis](https://github.com/J4VIS-2026/nrh-analysis)에서 별도로 실행합니다.

## 문서

| | |
|---|---|
| [분석 모듈 사용법](https://github.com/J4VIS-2026/nrh-analysis/blob/v0.3.0/%EC%82%AC%EC%9A%A9%EB%B2%95.md) | 임포트 네 가지 경우 · 예제 8개 |
| [분석 모듈 참조 문서](https://github.com/J4VIS-2026/nrh-analysis/blob/v0.3.0/README.md) | 알고리즘·설정·API |
| [`docs/설계.md`](docs/설계.md) | 설계 문서 (알고리즘 근거) |
| [`model/읽어주세요.md`](model/읽어주세요.md) | 모델 |
| [인식 모듈 참조 문서](https://github.com/J4VIS-2026/nrh-detector/blob/v0.10.1/README.md) | 웹·React Native API와 사용법 |

## ⚠️ 지금 상태

**코드는 완성이지만 판정 파라미터를 우리 자료로 검증하지 못했습니다.** 값은 상류가
실측 충돌 영상으로 조정한 것을 씁니다.

**경로 사다리꼴이 촬영 구도에 민감합니다.** 세로로 든 폰처럼 화각이 다르면 게이트가
과하게 좁아질 수 있습니다. 자체 영상에서 확인하세요.

```sh
npx naranhi 내영상.mp4 --set trapezoid.topH=78
```

## 플랫폼

영상 처리 경로(`naranhi/node`)는 `onnxruntime-node`·`ffmpeg-static`·`@napi-rs/canvas`
를 씁니다 — `npm install` 이 그 기계용 바이너리를 받습니다. React Native 는
`onnxruntime-react-native` 를 **앱 쪽에서** 설치해야 합니다 (네이티브 모듈이라 다른
패키지의 `node_modules` 안에 있으면 자동 링크가 안 됩니다).

## 라이선스

**AGPL-3.0-only.** 인식이 [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics)
기반이라 AGPL 이고, 파생물인 이 저장소도 같은 의무를 집니다.

**네트워크 서비스로 제공하면 소스를 받을 길을 열어줘야 합니다.**

## 학습 데이터 출처

> **이 결과물은 AI 허브의 「인도보행 영상」 데이터셋을 활용하였습니다.**

담긴 모델이 이 데이터로 학습했습니다. AI Hub 가 2차 저작물 활용의 조건으로 출처 표기를
요구합니다 — **이것을 쓴 서비스나 연구 결과물에 위 문구를 반드시 넣어야 합니다.**

**AI Hub 원본 이미지·라벨은 이 저장소에 없습니다.** 넣어서도 안 됩니다 — 자르거나
크기를 바꾸거나 박스를 그린 것도 원본으로 봅니다. 모델 가중치는 원본 데이터를 포함하지
않는 2차 저작물이라 배포해도 됩니다.
