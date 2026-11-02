import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { CAPTIONS, LEAD } from "./captions.mjs";

const OUT = process.env.DEMO_OUT ?? "./out";
const WORK = join(OUT, "build");
const FPS = 30;
const W = 1920;
const H = 1080;
const ORDER = [
  "s2_class", "s3_join", "s4_convert", "s5_examples",
  "s6_problem", "s7_submit", "s8_results", "s9_persist",
  "s10_z80_project", "s11_z80_board", "s12_z80_review",
];
// Noto Sans Thai sits in the per-user font folder, which fontconfig can miss
const FONTS =
  process.env.DEMO_FONTS ??
  join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "Fonts");
/** ffmpeg filter args need forward slashes and escaped drive colons. */
const esc2 = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

const ff = (args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
const dur = (f) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "csv=p=0", f,
    ]).toString().trim(),
  );

mkdirSync(WORK, { recursive: true });

const readMarks = (name) => {
  const f = join(OUT, "marks", `${name}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
};

const pieces = [];
console.log("normalising…");
for (const name of ORDER) {
  const src = resolve(OUT, `${name}.webm`);
  if (!existsSync(src)) throw new Error("missing segment: " + src);
  const out = join(WORK, `${name}.mp4`);
  // the webm has no audio; give it a silent track so concat stays aligned
  const d = dur(src);
  ff([
    "-i", src,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map", "0:v:0", "-map", "1:a:0", "-t", String(d),
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0xfaf9f8,fps=${FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "96k", "-ar", "48000",
    "-video_track_timescale", "90000",
    out,
  ]);
  pieces.push({ file: out, name, len: dur(out) });
  console.log(`  ${name}  ${dur(out).toFixed(1)}s`);
}

// ---------- subtitles ----------
const t = (s) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
};
const esc = (s) => s.replace(/\n/g, "\\N");

const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hud,Noto Sans Thai,34,&H00FFFFFF,&H00FFFFFF,&H00241F1C,&HD2241F1C,1,0,0,0,100,100,0,0,3,12,0,9,40,40,16,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const lines = [];
let clock = 0;
for (const p of pieces) {
  if (!p.name) {
    clock += p.len;
    continue;
  }
  // labels are written relative to the moment the app is on screen
  const marks = readMarks(p.name);
  const ready = marks.find((m) => m.label === "ready")?.t ?? 0;
  const lead = LEAD[p.name];
  if (lead && ready > 2.2)
    lines.push(
      `Dialogue: 0,${t(clock + 0.5)},${t(clock + ready + 0.4)},Hud,,0,0,0,,${esc(lead)}`,
    );

  const cues = (CAPTIONS[p.name] ?? [])
    .map(([at, text]) => [at + ready, text])
    .filter((c) => c[0] < p.len - 0.8);
  cues.forEach(([at, text], i) => {
    const end = i + 1 < cues.length ? Math.min(cues[i + 1][0], p.len) : p.len;
    if (end - at < 0.8) return;
    lines.push(
      `Dialogue: 0,${t(clock + at)},${t(clock + end)},Hud,,0,0,0,,${esc(text)}`,
    );
  });
  clock += p.len;
}
const ass = join(WORK, "captions.ass");
writeFileSync(ass, head + lines.join("\n") + "\n", "utf8");
console.log(`captions: ${lines.length} lines · total ${clock.toFixed(1)}s`);

// ---------- concat, then burn in ----------
const listFile = join(WORK, "list.txt");
writeFileSync(
  listFile,
  pieces.map((p) => `file '${resolve(p.file).replace(/\\/g, "/")}'`).join("\n"),
  "utf8",
);
const joined = join(WORK, "joined.mp4");
console.log("concatenating…");
ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined]);

const final = resolve(OUT, "mips-lab-demo.mp4");
console.log("burning captions…");
ff([
  "-i", joined,
  "-vf",
  `ass='${esc2(ass)}':fontsdir='${esc2(FONTS)}'`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "copy", "-movflags", "+faststart",
  final,
]);
console.log(`\n✓ ${final}  ${dur(final).toFixed(1)}s`);
