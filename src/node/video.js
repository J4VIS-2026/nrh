// 영상 읽기·쓰기. ffmpeg 를 파이프로 부른다.
//
// Node 에는 영상 디코더가 없어서 ffmpeg 가 필요하다. `ffmpeg-static` 이 깔려 있으면
// 그 바이너리를 쓰고, 없으면 시스템 `ffmpeg` 를 찾는다.
import { spawn } from "node:child_process";

/** ffmpeg 실행 파일을 찾는다. `ffmpeg-static` → 시스템 PATH 순. */
export async function findFfmpeg() {
  try {
    const mod = await import("ffmpeg-static");
    if (mod.default) return mod.default;
  } catch {
    // ffmpeg-static 이 없으면 시스템 것을 쓴다
  }
  return "ffmpeg";
}

export class FfmpegMissingError extends Error {
  constructor(cause) {
    super(
      "ffmpeg 를 실행할 수 없습니다.\n" +
        "  npm install ffmpeg-static      (권장 — 바이너리를 같이 받는다)\n" +
        "  또는 시스템에 ffmpeg 를 설치하고 PATH 에 넣으세요.\n" +
        `  원인: ${cause}`
    );
    this.name = "FfmpegMissingError";
  }
}

/**
 * 영상의 **실제 출력 크기**·fps·프레임 수를 읽는다.
 *
 * ⚠️ **입력 스트림 줄을 읽으면 안 된다.** 세로로 찍은 폰 영상은 코드 크기가 가로
 * (1920×1080)이고 회전 메타데이터로 세로가 된다. ffmpeg 는 기본으로 회전을 적용해서
 * 내보내므로(`-autorotate`), 우리가 실제로 받게 되는 것은 **출력 스트림 크기**다.
 * 여기서 틀리면 픽셀이 통째로 엉킨다.
 */
export async function probeVideo(ffmpeg, path) {
  const err = await new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      "-hide_banner", "-i", path, "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-y",
      process.platform === "win32" ? "NUL" : "/dev/null",
    ]);
    let text = "";
    p.stderr.on("data", (d) => (text += d));
    p.on("error", (e) => reject(new FfmpegMissingError(e.message)));
    p.on("close", () => resolve(text));
  });

  const out = err.match(/Stream #\d+:\d+.*?: Video: rawvideo.*?,\s(\d+)x(\d+)/s);
  if (!out) {
    throw new Error(
      `영상 정보를 읽지 못했습니다: ${path}\n${err.split("\n").slice(-8).join("\n")}`
    );
  }
  const fps = err.match(/,\s*([\d.]+)\s+fps/);
  const rotation = err.match(/displaymatrix: rotation of ([-\d.]+)/);
  return {
    width: Number(out[1]),
    height: Number(out[2]),
    fps: fps ? Number(fps[1]) : 30,
    rotation: rotation ? Number(rotation[1]) : 0,
  };
}

/**
 * 프레임을 하나씩 흘려준다. `{ index, timestampMs, rgb }`.
 *
 * `stride` 가 **처리 주기**다 — N프레임마다 하나씩 넘긴다. 건너뛴 프레임의 번호와
 * 시각은 **원본 기준으로 유지**한다 (인식 모듈의 `stride` 와 같은 의미다).
 * 그래서 τ 계산에 들어가는 Δt 가 실제로 흐른 시간과 맞는다.
 */
export async function* decodeFrames(ffmpeg, path, info, { stride = 1, maxFrames = null } = {}) {
  const bytes = info.width * info.height * 3;
  const proc = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-i", path,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]);
  proc.on("error", (e) => {
    throw new FfmpegMissingError(e.message);
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));

  let buf = Buffer.alloc(0);
  let sourceIndex = 0;
  let emitted = 0;
  try {
    for await (const chunk of proc.stdout) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= bytes) {
        const rgb = buf.subarray(0, bytes);
        buf = buf.subarray(bytes);
        const index = sourceIndex++;
        if (index % stride !== 0) continue;
        yield { index, timestampMs: (index / info.fps) * 1000, rgb };
        if (maxFrames !== null && ++emitted >= maxFrames) return;
      }
    }
  } finally {
    proc.stdout.destroy();
    proc.kill();
  }
  if (stderr.trim()) console.error(`  ffmpeg: ${stderr.trim().split("\n")[0]}`);
}

/** RGB 프레임을 받아 mp4 로 인코딩한다. `write()` 로 넣고 `close()` 로 닫는다. */
export function createEncoder(ffmpeg, outPath, { width, height, fps }) {
  const proc = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgb24",
    "-s", `${width}x${height}`, "-r", String(fps),
    "-i", "pipe:0",
    // yuv420p + faststart — 어디서나 재생되는 조합이다.
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outPath,
  ]);
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  proc.on("error", (e) => {
    throw new FfmpegMissingError(e.message);
  });

  return {
    async write(rgb) {
      if (!proc.stdin.write(rgb)) {
        await new Promise((r) => proc.stdin.once("drain", r));
      }
    },
    close() {
      return new Promise((resolve, reject) => {
        proc.on("close", (code) => {
          if (code === 0) return resolve();
          reject(new Error(`인코딩 실패 (종료코드 ${code})\n${stderr.slice(-800)}`));
        });
        proc.stdin.end();
      });
    },
  };
}
