// 판정을 영상 위에 그린다. Canvas 2D 라서 **브라우저 뷰어와 같은 그림**이 나온다.
//
// 색은 `video_playback_viewer.html` 에서 그대로 가져왔다. 두 구현이 같은 답을 낸다고
// 말하면서 화면이 달라 보이면 그 말을 눈으로 확인할 수 없다.
//
// 그리는 것은 **영상 위에 얹는 것뿐**이다. 요인 분해 같은 디버깅 정보는 옆에 패널로
// 붙이지 않는다 — 시연에서 보는 것은 영상이고, 화면 절반을 숫자에 내주면 정작 영상이
// 작아진다. 숫자가 필요하면 `--jsonl` 로 남겨 따로 본다.
//
// **예측 발점을 선으로 잇지도 않는다.** τ가 프레임마다 흔들리면 그 선이 화면 밖까지
// 튀어 오히려 읽기 어려웠다. 예측 위치는 이미 `path_gate` 값에 반영돼 있다.
import { existsSync } from "node:fs";

import { getPixelTrapezoid } from "naranhi-collision-assessor";

//: 폰트 스택. **한글 폰트를 반드시 뒤에 붙인다** — 안 붙이면 한글이 네모(□)로 나온다.
//: 브라우저는 시스템 폴백이 알아서 하지만 canvas 구현에는 그런 게 없다.
const MONO = 'Consolas, "Malgun Gothic", "Noto Sans KR", monospace';

const KOREAN_FONTS = [
  ["C:/Windows/Fonts/malgun.ttf", "Malgun Gothic"],
  ["C:/Windows/Fonts/malgunbd.ttf", "Malgun Gothic"],
  ["/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "Noto Sans KR"],
  ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "Noto Sans KR"],
  ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "Malgun Gothic"],
];
const MONO_FONTS = [
  ["C:/Windows/Fonts/consola.ttf", "Consolas"],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "Consolas"],
  ["/System/Library/Fonts/Menlo.ttc", "Consolas"],
];

export const LEVEL_COLORS = {
  safe: "#4db8a8",
  caution: "#e0c04a",
  warning: "#e88a3a",
  danger: "#e8574a",
};

const BG = "#0f1419";
const DARK = "#0a0d12";

let fontsReady = false;

/**
 * 한글·monospace 폰트를 등록한다. **한 번만 부르면 된다.**
 *
 * 등록에 실패하면 경고만 하고 넘어간다 — 숫자는 여전히 읽히고, 한글만 네모가 된다.
 * 조용히 넘어가면 "왜 네모가 나오지?"로 헤매게 되므로 반드시 알린다.
 */
export function registerFonts(GlobalFonts) {
  if (fontsReady) return;
  fontsReady = true;

  // **캔버스 모듈을 인자로 받는다.** 여기서 직접 임포트하면, 라이브러리를 불러오는
  // 것만으로도 `@napi-rs/canvas` 가 없다며 원시 에러가 난다 (실제로 그렇게 터졌다).
  // 임포트는 `../node.js` 한 곳에서만 하고 거기서 친절한 메시지를 낸다.
  GlobalFonts.loadSystemFonts?.();
  let korean = 0;
  for (const [path, family] of KOREAN_FONTS) {
    if (existsSync(path) && GlobalFonts.registerFromPath(path, family)) korean++;
  }
  for (const [path, family] of MONO_FONTS) {
    if (existsSync(path)) GlobalFonts.registerFromPath(path, family);
  }
  if (korean === 0) {
    console.error("  ⚠️ 한글 폰트를 찾지 못했습니다 — 화면의 한글이 네모(□)로 나옵니다.");
    console.error("     맑은고딕(Windows)이나 나눔고딕/Noto Sans KR 을 설치하세요.");
  }
}

/**
 * 인코딩할 캔버스 크기. 영상 크기 그대로지만 **짝수로 맞춘다.**
 *
 * `libx264` + `yuv420p` 는 가로·세로가 홀수면 인코딩을 거부한다. 1픽셀 늘린 자리는
 * 배경색으로 채운다 (`fillBackground`).
 */
export function canvasSize(width, height) {
  return {
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1,
  };
}

/** 캔버스를 배경색으로 채운다 (짝수 보정으로 생긴 1픽셀 줄). */
export function fillBackground(ctx, width, height) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
}

/** 프레임 픽셀(RGB)을 캔버스에 올린다. */
export function putFrame(ctx, rgb, width, height) {
  const img = ctx.createImageData(width, height);
  const dst = img.data;
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    dst[j] = rgb[i];
    dst[j + 1] = rgb[i + 1];
    dst[j + 2] = rgb[i + 2];
    dst[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 사다리꼴·박스·라벨·발점을 그린다.
 *
 * 라벨에 **클래스·`track_id`·등급·τ** 를 모두 넣는다 — 옆 패널이 없으므로 판정을
 * 읽는 데 필요한 것이 전부 박스 위에 있어야 한다.
 *
 * @param step `{ frame, ranked }` — 통합 파이프라인이 낸 것.
 * @param config 평가에 쓴 설정. **사다리꼴을 다시 계산하지 않고 여기서 읽는다** —
 *   도구가 다른 계산을 돌리면 그림이 판정과 어긋난다.
 */
export function drawOverlay(ctx, step, config) {
  const size = step.frame.frame_size;
  const tz = getPixelTrapezoid(config.trapezoid, size);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tz.topLx, tz.topY);
  ctx.lineTo(tz.topRx, tz.topY);
  ctx.lineTo(tz.botR, tz.botY);
  ctx.lineTo(tz.botL, tz.botY);
  ctx.closePath();
  ctx.fillStyle = "rgba(77,184,168,0.10)";
  ctx.fill();
  ctx.strokeStyle = "rgba(77,184,168,0.6)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.stroke();
  ctx.restore();

  const labelPx = Math.max(16, Math.round((16 * size.width) / 1080));
  const font = `${labelPx}px ${MONO}`;

  // 위험한 것을 나중에 그려 위로 올린다 (겹칠 때 danger 가 가려지지 않게)
  for (const entry of [...step.ranked].reverse()) {
    const { obj, result } = entry;
    const color = LEVEL_COLORS[result.risk_level];
    const b = obj.bbox;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x, b.y, b.w, b.h);

    const tid = obj.tracker_id === null ? "(미추적)" : `#${obj.tracker_id}`;
    const tau = result.factors.tau;
    const tauText = tau === null ? "τ 없음" : `τ ${tau >= 0 ? "+" : ""}${tau.toFixed(1)}s`;
    const label = `${obj.class_name} ${tid} · ${result.risk_level} · ${tauText}`;

    ctx.font = font;
    const tw = ctx.measureText(label).width;
    const chipH = Math.round(labelPx * 1.6);
    // 박스가 화면 맨 위에 붙으면 라벨을 박스 **안쪽 위**로 넣는다 — 밖으로 나가면
    // 잘려서 안 보인다.
    const chipY = b.y - chipH >= 0 ? b.y - chipH : b.y;
    ctx.fillStyle = color;
    ctx.fillRect(b.x, chipY, tw + 12, chipH);
    ctx.fillStyle = DARK;
    ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + 6, chipY + chipH / 2);

    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = DARK;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
