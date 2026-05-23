/* Ishihara plate definitions — figure/background colors per confusion line. */

export type PlateType = 'demo' | 'protan_deutan' | 'protan' | 'deutan' | 'tritan';

export interface Plate {
  digit: string;
  type: PlateType;
  fg: [number, number, number];
  bg: [number, number, number];
}

export const PLATES: Plate[] = [
  { digit: '7', type: 'demo', fg: [60, 60, 60], bg: [220, 220, 220] },
  { digit: '2', type: 'protan_deutan', fg: [200, 100, 60], bg: [160, 140, 60] },
  { digit: '6', type: 'protan_deutan', fg: [180, 110, 70], bg: [150, 145, 80] },
  { digit: '3', type: 'protan_deutan', fg: [210, 120, 60], bg: [165, 150, 70] },
  { digit: '5', type: 'protan', fg: [180, 90, 90], bg: [140, 130, 80] },
  { digit: '8', type: 'protan', fg: [195, 100, 85], bg: [150, 135, 75] },
  { digit: '4', type: 'deutan', fg: [110, 165, 90], bg: [165, 145, 75] },
  { digit: '9', type: 'deutan', fg: [120, 170, 95], bg: [170, 140, 80] },
  { digit: '1', type: 'tritan', fg: [120, 190, 200], bg: [180, 200, 130] },
  { digit: '5', type: 'tritan', fg: [140, 200, 210], bg: [190, 195, 140] },
];
