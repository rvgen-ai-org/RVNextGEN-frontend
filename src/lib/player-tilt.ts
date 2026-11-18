export type TiltPoint = { x: number; y: number };

// Shared by the artwork and the video surface. Values are art-space pixels;
// playback normalizes them before fitting motion to the viewer's safe margins.
export const GYRO_LIMIT = { x: 24, y: 18 };
const quantize = (value: number) => Math.round(value * 10) / 10 || 0;
const bounded = (value: number, limit: number) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;

export function gyroTarget(horizontalDegrees: number, verticalDegrees: number): TiltPoint {
  return {
    x: quantize(bounded(horizontalDegrees * .8, GYRO_LIMIT.x)),
    y: quantize(bounded(verticalDegrees * .45, GYRO_LIMIT.y)),
  };
}

export function pointerGyroTarget(x: number, y: number): TiltPoint {
  return { x: quantize(bounded(x, 1) * 18), y: quantize(bounded(y, 1) * 14) };
}

const normalized = (point: TiltPoint): TiltPoint => ({ x: point.x / GYRO_LIMIT.x, y: point.y / GYRO_LIMIT.y });

export function pointerTilt(x: number, y: number, rotated: boolean): TiltPoint {
  return normalized(pointerGyroTarget(rotated ? y : x, rotated ? -x : y));
}

/** Shortest angular distance avoids a jump when a sensor crosses +/-180 degrees. */
export function angleDelta(value: number, origin: number): number {
  return ((value - origin + 540) % 360) - 180;
}

/** Convert device axes into viewer axes, including our iOS landscape fallback. */
export function orientTilt(x: number, y: number, screenAngle: number, rotated: boolean): TiltPoint {
  const radians = (screenAngle - (rotated ? 90 : 0)) * Math.PI / 180;
  return normalized(gyroTarget(x * Math.cos(radians) + y * Math.sin(radians), -x * Math.sin(radians) + y * Math.cos(radians)));
}

export function smoothingFactor(elapsedMs: number): number {
  return 1 - Math.exp(-Math.min(50, Math.max(0, elapsedMs)) / 85);
}

/** Mutate only local animation state; no React rendering or layout reads per sample. */
export function stepGyroPoint(current: TiltPoint, target: TiltPoint, elapsedMs: number, tolerance = .05): boolean {
  const blend = smoothingFactor(elapsedMs);
  current.x += (target.x - current.x) * blend;
  current.y += (target.y - current.y) * blend;
  const settled = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) <= tolerance;
  if (settled) { current.x = target.x; current.y = target.y; }
  return settled;
}

/** Fit the art's movement budget inside the full-picture player's reserved margin. */
export function videoMotionRange(width: number, height: number): TiltPoint {
  return { x: Math.min(GYRO_LIMIT.x, Math.max(0, width) * .018), y: Math.min(GYRO_LIMIT.y, Math.max(0, height) * .018) };
}

export type DevicePose = { alpha: number | null; beta: number; gamma: number };
export type VideoTilt = TiltPoint & { roll: number };
type Quaternion = { x: number; y: number; z: number; w: number };
const radians = (degrees: number) => degrees * Math.PI / 180;
const multiply = (a: Quaternion, b: Quaternion): Quaternion => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** DeviceOrientation uses intrinsic Z(alpha), X(beta), Y(gamma) rotations. */
function deviceQuaternion(pose: DevicePose): Quaternion {
  const a = radians(pose.alpha ?? 0) / 2, b = radians(pose.beta) / 2, g = radians(pose.gamma) / 2;
  return multiply(multiply({ x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) }, { x: Math.sin(b), y: 0, z: 0, w: Math.cos(b) }), { x: 0, y: Math.sin(g), z: 0, w: Math.cos(g) });
}

/** A relative rotation vector remains continuous across heading wrap and Euler aliases. */
export function relativeDeviceRotation(pose: DevicePose, origin: DevicePose): { pitch: number; yaw: number; roll: number } {
  const base = deviceQuaternion(origin);
  const delta = multiply({ x: -base.x, y: -base.y, z: -base.z, w: base.w }, deviceQuaternion(pose));
  const sign = delta.w < 0 ? -1 : 1;
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const degrees = length < 1e-8 ? 0 : 2 * Math.atan2(length, Math.abs(delta.w)) * 180 / Math.PI / length * sign;
  return { pitch: delta.x * degrees, yaw: delta.y * degrees, roll: delta.z * degrees };
}

export function landscapeSensorTilt(pose: DevicePose, origin: DevicePose, screenAngle: number, rotated: boolean): VideoTilt {
  const full = pose.alpha !== null && origin.alpha !== null;
  const delta = full ? relativeDeviceRotation(pose, origin) : { yaw: angleDelta(pose.gamma, origin.gamma), pitch: angleDelta(pose.beta, origin.beta), roll: 0 };
  const angle = radians(screenAngle - (rotated ? 90 : 0));
  return {
    x: bounded((delta.yaw * Math.cos(angle) + delta.pitch * Math.sin(angle)) / 45, 1),
    y: bounded((-delta.yaw * Math.sin(angle) + delta.pitch * Math.cos(angle)) / 45, 1),
    roll: bounded(delta.roll / 60, 1),
  };
}

export function videoMotionProfile(width: number, height: number, landscape: boolean) {
  return landscape
    ? { range: { x: Math.min(64, width * .04), y: Math.min(40, height * .04) }, pitch: 12, yaw: 14, roll: 8, perspective: Math.max(width, height, 1) * 1.2 }
    : { range: videoMotionRange(width, height), pitch: 1.5, yaw: 1.5, roll: 0, perspective: Math.max(width, height, 1) * 3 };
}

/** Exact corner constraints for CSS perspective * rotateX * rotateY * rotateZ * scale.
 * Translation is outside perspective, matching the individual CSS translate property.
 * Fit the source plane rather than zooming/cropping it; no layout reads are needed.
 */
export function fitVideoScale(width: number, height: number, pitch: number, yaw: number, roll: number, perspective: number, tx: number, ty: number, maximum: number): number {
  if (width <= 0 || height <= 0) return maximum;
  const cx = Math.cos(radians(pitch)), sx = Math.sin(radians(pitch));
  const cy = Math.cos(radians(yaw)), sy = Math.sin(radians(yaw));
  const cz = Math.cos(radians(roll)), sz = Math.sin(radians(roll));
  const halfW = width / 2 - 1, halfH = height / 2 - 1;
  let scale = maximum;
  for (const x of [-width / 2, width / 2]) for (const y of [-height / 2, height / 2]) {
    const zx = cz * x - sz * y, zy = sz * x + cz * y;
    const rx = cy * zx, ry = cx * zy + sx * sy * zx, rz = sx * zy - cx * sy * zx;
    for (const [coordinate, available] of [[rx, halfW - tx], [-rx, halfW + tx], [ry, halfH - ty], [-ry, halfH + ty]]) {
      const denominator = coordinate + available * rz / perspective;
      if (denominator > 0) scale = Math.min(scale, Math.max(0, available) / denominator);
    }
  }
  return Math.max(.01, Math.min(maximum, scale));
}
