/** Visual tokens for the 3D scene (backdrop, fog, ground, hemisphere light). */
export interface Theme3D {
  canvasBg: string
  fog: string
  ground: string
  hemiSky: string
  hemiGround: string
}

const LIGHT: Theme3D = {
  canvasBg: '#eef1f4',
  fog: '#eef1f4',
  ground: '#dcdcd8',
  hemiSky: '#dfe8f0',
  hemiGround: '#b8b4ac',
}

const DARK: Theme3D = {
  canvasBg: '#131417',
  fog: '#131417',
  ground: '#26282c',
  hemiSky: '#3a4150',
  hemiGround: '#23211e',
}

export function getTheme3d(resolved: 'light' | 'dark'): Theme3D {
  return resolved === 'dark' ? DARK : LIGHT
}
