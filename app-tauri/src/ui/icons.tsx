/** Small line icons for the layer list (inline SVG: emoji fonts are not always available in the WebView). */
export type IconName = 'eye' | 'eyeOff' | 'lock' | 'mask' | 'design' | 'freeform' | 'graphic' | 'pattern' | 'text' | 'tile' | 'logo' | 'panel' | 'group'
  | 'fabric' | 'collar' | 'sleeves' | 'armband' | 'base' | 'gear' | 'shorts' | 'sock' | 'number' | 'camera' | 'back' | 'rotL' | 'rotR' | 'sideL' | 'sideR' | 'spin' | 'sun' | 'save' | 'image'

const P: Record<IconName, JSX.Element> = {
  eye: <><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  eyeOff: <><path d="M2 2l12 12M6.6 3.7A6.8 6.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-2 2.5M4 5.2A11 11 0 0 0 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7" /></>,
  mask: <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></>,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  design: <><path d="M3 3v10M6.5 3v10M10 3v10M13.5 3v10" /></>,
  freeform: <><path d="M3 13l2.5-.5 7-7-2-2-7 7z" /><path d="M9.5 4.5l2 2" /></>,
  graphic: <><path d="M2 12l4-7 3 4 2-2 3 5z" /></>,
  pattern: <><circle cx="4" cy="4" r="1.3" /><circle cx="12" cy="4" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="4" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /></>,
  text: <><path d="M3 4h7M6.5 4v9M10 8h4M12 8v5" /></>,
  tile: <><rect x="2.5" y="2.5" width="4.5" height="4.5" /><rect x="9" y="2.5" width="4.5" height="4.5" /><rect x="2.5" y="9" width="4.5" height="4.5" /><rect x="9" y="9" width="4.5" height="4.5" /></>,
  logo: <><path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /></>,
  panel: <><path d="M4 2.5h8l1.5 3-2 1V14h-7V6.5l-2-1z" /><path d="M5.5 7v7M10.5 7v7" /></>,
  group: <><path d="M2 4.5h4l1.5 1.5H14v7.5H2z" /></>,
  fabric: <><path d="M2 5c2-2 4 2 6 0s4 2 6 0M2 9c2-2 4 2 6 0s4 2 6 0M2 13c2-2 4 2 6 0s4 2 6 0" /></>,
  collar: <><path d="M3 4l5 4 5-4M3 4l1 5 4-1 4 1 1-5" /></>,
  sleeves: <><path d="M6 3L2 6l2 3 2-1v6h4V8l2 1 2-3-4-3" /></>,
  armband: <><rect x="3" y="5" width="10" height="6" rx="1" /><path d="M9.5 6.8a2 2 0 1 0 0 2.4" /></>,
  base: <><path d="M5 2.5L2 5l1.5 2.5L5 7v7h6V7l1.5.5L14 5l-3-2.5a3 3 0 0 1-6 0z" /></>,
  gear: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  shorts: <><path d="M3 3h10l1 10h-4.5L8 7.5 6.5 13H2z" /><path d="M3 5h10" /></>,
  sock: <><path d="M6 1.5h4v7l2.5 2.5a2 2 0 0 1-2.8 2.8L6 10.5z" /><path d="M6 4h4" /></>,
  number: <><path d="M4.5 4.5L6 3.5V12.5M9.5 5a2 2 0 0 1 3.8.8c0 1.6-3.8 3.6-3.8 6.7h4" /></>,
  camera: <><path d="M2 5h3l1.2-1.8h3.6L11 5h3v8H2z" /><circle cx="8" cy="9" r="2.4" /></>,
  back: <><path d="M5 2.5L2 5l1.5 2.5L5 7v7h6V7l1.5.5L14 5l-3-2.5H5z" /><path d="M7 6.5h2v5" /></>,
  rotL: <><path d="M5 2.5L2 5l1.5 2.5L5 7v7h6V7l1.5.5L14 5l-3-2.5a3 3 0 0 1-6 0z" opacity=".5" /><path d="M11 12.5c-2.5 1.5-6 1-7.5-1.5M3.5 11l0 1.8 1.8-.2" /></>,
  rotR: <><path d="M5 2.5L2 5l1.5 2.5L5 7v7h6V7l1.5.5L14 5l-3-2.5a3 3 0 0 1-6 0z" opacity=".5" /><path d="M5 12.5c2.5 1.5 6 1 7.5-1.5M12.5 11v1.8l-1.8-.2" /></>,
  sideL: <><path d="M6 2.5h3l2 3-1.5 1V14H6z" /><path d="M2 8h2.5M2 8l1.5-1.5M2 8l1.5 1.5" /></>,
  sideR: <><path d="M10 2.5H7L5 5.5l1.5 1V14H10z" /><path d="M14 8h-2.5M14 8l-1.5-1.5M14 8l-1.5 1.5" /></>,
  spin: <><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8" /></>,
  sun: <><circle cx="8" cy="8" r="2.6" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></>,
  save: <><path d="M8 2v8M5 7l3 3 3-3M3 12.5h10" /></>,
  image: <><rect x="2" y="3" width="12" height="10" rx="1.2" /><circle cx="5.8" cy="6.5" r="1.1" /><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" /></>
}

export function Icon({ name, size = 15 }: { name: IconName; size?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">{P[name]}</svg>
}
