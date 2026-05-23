import { z } from 'zod';

/* ─────────────────────────────────────────────────────────
   VCDProfile — localStorage v1 스키마.
   원본 키 이름(snake_case)은 vcd-display의 `vcd.profile.v1`과
   동일하게 유지 — 기존 사용자 데이터를 그대로 로드하기 위함.
   ───────────────────────────────────────────────────────── */

export const EyeSchema = z.enum(['od', 'os']);
export type Eye = z.infer<typeof EyeSchema>;

// ── Calibration ─────────────────────────────────────────
export const DistanceSourceSchema = z.enum(['mediapipe_ipd', 'manual']);

export const CalibrationSchema = z.object({
  screen_ppi: z.number().positive(),
  screen_width_mm: z.number().positive(),
  viewing_distance_cm: z.number().positive(),
  distance_source: DistanceSourceSchema,
  calibration_timestamp: z.iso.datetime(),
});

// ── Refraction (SPH / CYL / AXIS per eye) ──────────────
export const EyeRefractionSchema = z.object({
  sph: z.number(), // diopters; 음수=근시, 양수=원시
  cyl: z.number(), // 난시 강도(보통 음수)
  axis: z.number().min(0).max(180), // 도
});

export const RefractionSchema = z.object({
  od: EyeRefractionSchema,
  os: EyeRefractionSchema,
  confidence: z.number().min(0).max(1),
});

// ── LogMAR (visual acuity) ─────────────────────────────
export const LogMAREyeSchema = z.object({
  logmar: z.number(),
  confidence: z.number().min(0).max(1),
  screen_limited: z.boolean().optional(),
});

export const LogMARSchema = z.object({
  od: LogMAREyeSchema.nullable(),
  os: LogMAREyeSchema.nullable(),
});

// ── CSF (contrast sensitivity function) ────────────────
export const CSFClassificationSchema = z.enum([
  'normal',
  'high_freq',
  'mid_freq',
  'global',
  'mixed',
]);

export const CSFEyeSchema = z.object({
  freqs: z.array(z.number()), // 0.5/1/2/4/8/12/16 cpd
  thresholds: z.array(z.number().nullable()), // Michelson contrast
  sensitivities: z.array(z.number().nullable()), // 1 / threshold
  reversals_used: z.array(z.number()).optional(),
  screen_limited: z.array(z.boolean()).optional(),
  confidence: z.number().min(0).max(1),
  classification: CSFClassificationSchema.nullable(),
  partial: z.boolean().optional(),
});

export const CSFCurveSchema = z.object({
  od: CSFEyeSchema.optional(),
  os: CSFEyeSchema.optional(),
  tested_at: z.iso.datetime().optional(),
});

// ── Color vision ───────────────────────────────────────
export const ColorVisionTypeSchema = z.enum([
  'normal',
  'protanomaly',
  'deuteranomaly',
  'tritanomaly',
  'achromatopsia',
]);

export const ColorVisionSchema = z.object({
  type: ColorVisionTypeSchema,
  severity: z.number().min(0).max(1).optional(),
  lut_id: z.string().optional(),
  correction_lut: z
    .object({
      matrix: z.array(z.array(z.number())), // 3×3 Daltonization
    })
    .optional(),
});

// ── Zernike coefficients (M1 PSF input) ────────────────
export const ZernikeEyeSchema = z.object({
  c3: z.number(), // oblique astigmatism (Z_2^-2)
  c4: z.number(), // defocus (Z_2^0)
  c5: z.number(), // vertical astigmatism (Z_2^2)
});

export const ZernikeSchema = z.object({
  od: ZernikeEyeSchema.optional(),
  os: ZernikeEyeSchema.optional(),
});

// ── Amsler (grayscale base64 PNG, 256×256) ────────────
export const AmslerMapSchema = z.string().regex(/^data:image\/png;base64,/);

// ── Top-level profile ──────────────────────────────────
export const VCDProfileV1Schema = z.object({
  schema_version: z.literal(1).default(1),
  user_id: z.string(),
  calibration: CalibrationSchema.nullable(),
  refraction: RefractionSchema.nullable(),
  logmar: LogMARSchema.nullable(),
  csf_curve: CSFCurveSchema.nullable(),
  color_vision: ColorVisionSchema.nullable(),
  amsler_map_od: AmslerMapSchema.nullable(),
  amsler_map_os: AmslerMapSchema.nullable(),
  zernike: ZernikeSchema.nullable(),
  updated_at: z.iso.datetime().nullable(),
});

// 현재는 v1만 — v2가 나오면 union으로 확장:
//   export const VCDProfileSchema = z.discriminatedUnion('schema_version', [V1, V2]);
export const VCDProfileSchema = VCDProfileV1Schema;

/* ─────────────────────────────────────────────────────────
   loadProfile / makeEmpty / migrate

   - 기존 vcd-display는 schema_version 필드가 없음.
     없는 채로 들어온 데이터는 v1으로 간주.
   - parse 실패 시 (스토리지 손상 등) emptyProfile()로 폴백.
   ───────────────────────────────────────────────────────── */

export const STORAGE_KEY = 'vcd.profile.v1';

export function makeEmptyProfile(): VCDProfile {
  return {
    schema_version: 1,
    user_id: crypto.randomUUID(),
    calibration: null,
    refraction: null,
    logmar: null,
    csf_curve: null,
    color_vision: null,
    amsler_map_od: null,
    amsler_map_os: null,
    zernike: null,
    updated_at: null,
  };
}

export type VCDProfile = z.infer<typeof VCDProfileSchema>;

/**
 * 알 수 없는 입력(localStorage 파싱 결과)을 안전하게 VCDProfile로 변환.
 * 실패 시 빈 프로파일 반환 + 경고 로그.
 */
export function parseStoredProfile(raw: unknown): VCDProfile {
  // schema_version이 없는 구버전(=v1)은 1로 보정
  const withVersion =
    raw && typeof raw === 'object' && !('schema_version' in raw)
      ? { ...raw, schema_version: 1 }
      : raw;

  const result = VCDProfileSchema.safeParse(withVersion);
  if (result.success) return result.data;

  console.warn('[profile] schema validation failed, resetting', result.error.issues);
  return makeEmptyProfile();
}
