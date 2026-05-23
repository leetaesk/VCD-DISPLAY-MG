import { describe, expect, it } from 'vitest';

import { makeEmptyProfile, parseStoredProfile, VCDProfileSchema } from './profile';

describe('VCDProfileSchema', () => {
  it('빈 프로파일은 스키마 통과', () => {
    const empty = makeEmptyProfile();
    expect(VCDProfileSchema.safeParse(empty).success).toBe(true);
  });

  it('schema_version 없는 v1 구버전도 parseStoredProfile로 흡수', () => {
    const legacy = {
      user_id: 'legacy-uuid',
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
    const parsed = parseStoredProfile(legacy);
    expect(parsed.user_id).toBe('legacy-uuid');
    expect(parsed.schema_version).toBe(1);
  });

  it('손상된 데이터는 빈 프로파일로 폴백', () => {
    const broken = { garbage: true };
    const parsed = parseStoredProfile(broken);
    expect(parsed.calibration).toBeNull();
    expect(typeof parsed.user_id).toBe('string');
  });

  it('refraction.axis 범위 검증 (0~180)', () => {
    const profile = makeEmptyProfile();
    profile.refraction = {
      od: { sph: -2, cyl: -0.5, axis: 200 }, // 범위 초과
      os: { sph: -2, cyl: -0.5, axis: 90 },
      confidence: 0.8,
    };
    expect(VCDProfileSchema.safeParse(profile).success).toBe(false);
  });

  it('valid한 calibration 통과', () => {
    const profile = makeEmptyProfile();
    profile.calibration = {
      screen_ppi: 120.5,
      screen_width_mm: 305.2,
      viewing_distance_cm: 60,
      distance_source: 'mediapipe_ipd',
      calibration_timestamp: '2026-05-23T10:00:00.000Z',
    };
    expect(VCDProfileSchema.safeParse(profile).success).toBe(true);
  });
});
