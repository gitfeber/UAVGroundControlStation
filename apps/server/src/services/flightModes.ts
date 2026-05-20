const planeModes: Record<number, string> = {
  0: "MANUAL",
  2: "STABILIZE",
  5: "FBWA",
  6: "FBWB",
  7: "CRUISE",
  10: "AUTO",
  11: "RTL",
  12: "LOITER",
  15: "GUIDED"
};

const copterModes: Record<number, string> = {
  0: "STABILIZE",
  1: "ACRO",
  2: "ALT_HOLD",
  3: "AUTO",
  4: "GUIDED",
  5: "LOITER",
  6: "RTL",
  9: "LAND",
  16: "POSHOLD",
  17: "BRAKE"
};

export function mavTypeLabel(type: number): string {
  const labels: Record<number, string> = {
    0: "Generic",
    1: "Fixed Wing",
    2: "Quadrotor",
    3: "Coaxial",
    4: "Helicopter",
    5: "Antenna Tracker",
    6: "GCS",
    10: "Ground Rover",
    13: "Hexarotor",
    14: "Octorotor",
    15: "Tricopter",
    19: "VTOL QuadPlane"
  };

  return labels[type] ?? `MAV_TYPE_${type}`;
}

export function flightModeLabel(vehicleType: number, customMode: number): string {
  if (vehicleType === 1 || vehicleType === 19) {
    return planeModes[customMode] ?? `PLANE_${customMode}`;
  }

  if ([2, 3, 4, 13, 14, 15].includes(vehicleType)) {
    return copterModes[customMode] ?? `COPTER_${customMode}`;
  }

  return `MODE_${customMode}`;
}
