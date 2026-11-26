// Every tuning constant and the mission definitions, as plain data.
// World axes: +X east, -Z north, +Y up, metres. Heading 0 = north, 90 = east.

export const UNITS = {
  MS_TO_KT: 1.943844,
  M_TO_FT: 3.28084,
  MS_TO_FPM: 196.8504,
};

export const SIM = {
  fixedStep: 1 / 120, // seconds per physics step
  maxFrameTime: 0.25, // longest frame the loop will catch up on
  gravity: 9.81,
};

export const WORLD = {
  seabed: -38,
  terrainCell: 36, // metres per terrain grid cell
  terrainMaxCells: 400, // per axis; one grid spans the whole archipelago
  terrainMargin: 2.2, // grid reaches this many island radii past each centre
  oceanSize: 60000,
  skyRadius: 16000,
  fogNear: 1800,
  fogFar: 15000,
  sunDirection: [0.42, 0.78, 0.46], // towards the sun
  cloudCount: 26,
  cloudArea: 8000, // clouds wrap inside +/- this many metres
  cloudAltitude: [520, 900],
  treeCountPerKm2: 95,
  colors: {
    zenith: '#2f86d6',
    horizon: '#c4e5f1',
    fog: '#bcdcea',
    sun: '#fff4d6',
    ocean: '#1a9fbf',
    oceanSpecular: '#ffffff',
    seabed: '#0c4f7d',
    shallowSand: '#bfe3c6',
    deepFloor: '#1b5f88',
    beach: '#efdca6',
    grassLight: '#7cbf4f',
    grassDark: '#4f9a3e',
    forest: '#3f7f38',
    rock: '#a08f7c',
    rockDark: '#7a6e64',
    asphalt: '#3a3d42',
    houseWall: '#f6f1e7',
    roof: '#c8603a',
    trunk: '#8a6a48',
    palm: '#3f9b46',
    leafy: '#4c8f3a',
  },
};

// Island layout: positions are fixed so missions line up; the seed shapes coastlines,
// noise, villages and trees. radius = mean shoreline distance; peaks add hills.
export const ISLANDS = [
  {
    name: 'Solenne', x: 0, z: 0, radius: 1700, plateau: 6, shelf: 9,
    peaks: [
      { x: 250, z: -950, r: 820, h: 230 },
      { x: -750, z: -450, r: 480, h: 110 },
      { x: 820, z: 780, r: 430, h: 65 },
    ],
  },
  {
    name: 'Pella Cay', x: 5200, z: -3600, radius: 820, plateau: 3, shelf: 8,
    peaks: [{ x: 5600, z: -3400, r: 380, h: 105 }],
  },
  { name: 'Gull Rock', x: 1900, z: 2100, radius: 240, plateau: 2, shelf: 7, peaks: [{ x: 1900, z: 2100, r: 150, h: 45 }] },
  { name: 'Twin Keys North', x: 3300, z: 650, radius: 260, plateau: 2, shelf: 7, peaks: [{ x: 3300, z: 650, r: 160, h: 30 }] },
  { name: 'Twin Keys South', x: 3750, z: 150, radius: 200, plateau: 2, shelf: 7, peaks: [{ x: 3750, z: 150, r: 120, h: 22 }] },
  { name: 'Kestrel Islet', x: -1800, z: 2650, radius: 200, plateau: 2, shelf: 7, peaks: [{ x: -1800, z: 2650, r: 110, h: 18 }] },
  { name: 'Ember Islet', x: -2950, z: -1250, radius: 330, plateau: 2, shelf: 7, peaks: [{ x: -2950, z: -1250, r: 220, h: 75 }] },
];

// Paved strips. The start end lies length/2 behind the centre, against the heading.
export const RUNWAYS = [
  { id: 'main', name: 'Solenne Field', island: 'Solenne', x: -100, z: 350, heading: 75, length: 1100, width: 32 },
  { id: 'pella', name: 'Pella Cay Strip', island: 'Pella Cay', x: 5050, z: -3450, heading: 20, length: 520, width: 24 },
];

export const RUNWAY_SITE = {
  minElevation: 5,
  flattenAlong: 70, // fully flat this far past each end
  flattenAcross: 46, // fully flat this far beside each edge
  blendDistance: 130, // then blends back into the hills
  clearAlong: 260, // no trees or houses this close to the ends
  clearAcross: 70,
  edgeLightSpacing: 60,
};

export const VILLAGES = [
  { island: 'Solenne', x: 150, z: 900, radius: 270, houses: 24 },
  { island: 'Solenne', x: -450, z: -1350, radius: 170, houses: 9 },
  { island: 'Pella Cay', x: 4780, z: -3720, radius: 160, houses: 11 },
];

export const LIGHTHOUSE = { island: 'Solenne', bearing: 160, height: 26 };
export const HANGAR = { runway: 'main', along: -200, across: 95 };

export const AIRCRAFT = {
  stallSpeed: 25, // m/s (about 49 kt): full lift only just holds 1 g here
  rotateSpeed: 28, // the nose can be lifted on the runway from here
  stallAoa: 0.26, // rad: past this angle of attack the wing stalls
  wingIncidence: 0.04, // rad of built-in angle of attack at level attitude
  maxThrust: 5.2, // m/s^2 of push at full throttle, standing still
  thrustFade: 0.003, // thrust falls with speed: T * (1 - fade * v)
  dragCoef: 0.00105, // parasitic drag per v^2
  inducedDrag: 0.12, // drag from lift: k * Cl^2 * q * g (turns bleed speed)
  turnBleed: 0.22, // extra drag per g of load past 1 g (banked turns cost speed)
  sideForce: 1.2, // how quickly sideslip is cancelled
  pitchRate: 0.85, // rad/s at full stick
  bankFollow: 2.4, // how briskly the roll keys reach the target bank
  rollRate: 1.4, // fastest roll, rad/s
  maxBank: 1.05, // rad (60 degrees) at full roll input
  yawRate: 0.3,
  weathervane: 3.0, // nose swings into the relative wind
  pitchStability: 1.5, // nose returns to the trimmed angle of attack
  turnAssist: 0.6, // share of the extra lift a level turn needs that trim adds
  minAuthority: 0.4, // control authority at zero airspeed (never vanishes)
  fullAuthoritySpeed: 42,
  stallNoseDrop: 0.7, // rad/s of nose-down pitch while stalled
  throttleRate: 0.55, // throttle travel per second
  groundFriction: 0.35, // m/s^2 rolling resistance on pavement
  grassFriction: 1.4,
  brakeDecel: 6.5,
  airBrakeDrag: 0.0012,
  groundSteerRate: 0.5, // rad/s with full rudder at taxi speed
  groundPitchMax: 0.2, // rad of rotation the tail allows on the ground (stays under stallAoa)
  gearHeight: 1.55, // centre of mass above the wheels' contact
  groundEffectHeight: 14,
  groundEffectLift: 0.12,
  fuelBurnIdle: 0.018, // percent of tank per second
  fuelBurnFull: 0.21,
  crashSpeed: 46, // touching down faster than this wrecks the gear
  maxClimbPitch: 1.2, // rad: pitch input stops here (no looping)
};

export const LANDING = {
  goodSink: 2.0, // m/s descent at touchdown for a smooth landing (about 390 fpm)
  hardSink: 3.6, // beyond good and up to this: a hard landing
  crashSink: 5.5, // beyond this the gear folds
  maxSpeed: 44,
  maxBankDeg: 14,
  maxAlignDeg: 18,
  stoppedSpeed: 2.5,
  hardDamage: 30,
  terrainDamagePerSecond: 35, // rolling off the strip on rough ground
};

export const WIND = {
  turbulenceScale: 0.12,
  gustPeriod: [3.5, 8],
};

export const RINGS = {
  defaultRadius: 24,
  tube: 1.6,
  postWidth: 1.4,
  passDepth: 6,
};

export const CAMERA = {
  fov: 62,
  near: 0.3,
  far: 22000,
  chaseDistance: 17,
  chaseHeight: 4.2,
  chaseLag: 3.2, // follow stiffness: higher follows tighter
  chaseLookAhead: 22,
  cockpitEye: [0, 0.74, -0.35], // pilot's head in aircraft space (under the canopy top)
  cockpitFov: 68,
};

export const SCORING = {
  ringPoints: 400,
  ringOrderBonus: 100, // per ring flown in sequence without a miss
  timeBonusPerSecond: 12, // for every second under par
  maxTimeBonus: 1500,
  landingSmooth: 2500,
  landingFirm: 1500,
  landingHard: 600,
  deadStickFactor: 0.7,
  fuelBonusPerPercent: 15,
  damagePenaltyPerPercent: 18,
  ranks: [
    { rank: 'S', fraction: 0.86 },
    { rank: 'A', fraction: 0.7 },
    { rank: 'B', fraction: 0.5 },
    { rank: 'C', fraction: 0 },
  ],
};

export const AUDIO = {
  masterVolume: 0.55,
  engineIdleHz: 48,
  engineFullHz: 128,
  windMaxSpeed: 80,
};

// The three sorties, flown in order. Ring alt is metres above sea level;
// heading is the direction the ring faces (the way to fly through it).
export const MISSIONS = [
  {
    id: 'first-circuit',
    name: 'First Circuit',
    kicker: 'SORTIE 1 · TRAINING',
    briefing:
      'Morning, courier. Before the islands trust you with their post, fly one clean circuit of Solenne. ' +
      'Take off from Solenne Field, thread six rings around the island and come home on the long runway.',
    goals: ['Take off from runway 07', 'Fly through 6 rings, in order', 'Land back on Solenne Field'],
    startRunway: 'main',
    landRunway: 'main',
    fuel: 80,
    wind: { from: 90, speed: 2, gust: 1 },
    parTime: 260,
    rings: [
      { x: 1350, z: 0, alt: 110, heading: 75 },
      { x: 2150, z: -900, alt: 170, heading: 20 },
      { x: 1100, z: -2350, alt: 230, heading: 300 },
      { x: -900, z: -2300, alt: 220, heading: 250 },
      { x: -3200, z: 150, alt: 170, heading: 150 },
      { x: -1700, z: 1500, alt: 120, heading: 45 }, // base-leg gate: the runway lies ahead at an angle
    ],
  },
  {
    id: 'island-hop',
    name: 'Island Hop',
    kicker: 'SORTIE 2 · DELIVERY',
    briefing:
      'Pella Cay has been waiting a week for its medicine parcel. Follow five rings east, ' +
      'skim low between the Twin Keys and set down on the short strip. Short means short: arrive slow.',
    goals: ['Fly through 5 rings to Pella Cay', 'Thread the Twin Keys low', 'Land on the 520 m Pella Cay strip'],
    startRunway: 'main',
    landRunway: 'pella',
    fuel: 70,
    wind: { from: 60, speed: 4, gust: 2 },
    parTime: 200,
    rings: [
      { x: 1350, z: 0, alt: 120, heading: 75 },
      { x: 2600, z: 600, alt: 150, heading: 100 },
      { x: 3540, z: 380, alt: 60, heading: 50, radius: 22 },
      { x: 4200, z: -700, alt: 120, heading: 25 },
      { x: 4448, z: -1796, alt: 100, heading: 20 },
    ],
  },
  {
    id: 'storm-post',
    name: 'Storm Post',
    kicker: 'SORTIE 3 · WEATHER',
    briefing:
      'A squall line is crossing the isles and the evening post still has to go round. Seven rings, ' +
      'gusts from the south-west and only a part-filled tank. Fly smooth, mind your fuel and bring her home to Solenne.',
    goals: ['Fly through 7 rings in gusty wind', 'Manage a tight fuel load', 'Land on Solenne Field (either direction)'],
    startRunway: 'main',
    landRunway: 'main',
    fuel: 62,
    wind: { from: 230, speed: 7, gust: 6 },
    parTime: 420,
    rings: [
      { x: 1350, z: 0, alt: 120, heading: 75, radius: 21 },
      { x: 2100, z: 1650, alt: 90, heading: 150, radius: 21 },
      { x: 700, z: 2900, alt: 150, heading: 255, radius: 21 },
      { x: -1700, z: 2300, alt: 70, heading: 280, radius: 21 },
      { x: -3000, z: -1000, alt: 150, heading: 345, radius: 21 },
      { x: -1200, z: -2700, alt: 220, heading: 70, radius: 21 },
      { x: 3000, z: -1500, alt: 170, heading: 140, radius: 21 },
    ],
  },
];
