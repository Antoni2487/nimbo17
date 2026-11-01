import { IDLE_POSE, MouthPose, mouthGeometry, smoothPose, targetPose } from './mouth';

describe('mouth', () => {
  it('idle is a closed smile', () => {
    const pose = targetPose('idle', null, 0);
    expect(pose).toEqual(IDLE_POSE);
    const g = mouthGeometry(pose);
    expect(g.tongue.ry).toBe(0);
    expect(g.outline.startsWith('M ')).toBe(true);
    expect(g.outline.endsWith('Z')).toBe(true);
  });

  it('speaking opens the mouth with the voice volume', () => {
    const quiet = targetPose('speaking', { level: 0.1, brightness: 0.5 }, 0);
    const loud = targetPose('speaking', { level: 0.9, brightness: 0.5 }, 0);
    expect(loud.open).toBeGreaterThan(quiet.open);
    expect(mouthGeometry(loud).tongue.ry).toBeGreaterThan(mouthGeometry(quiet).tongue.ry);
  });

  it('bright sounds make it wide, dark sounds make it round', () => {
    const ee = targetPose('speaking', { level: 0.5, brightness: 1 }, 0);
    const oo = targetPose('speaking', { level: 0.5, brightness: 0 }, 0);
    expect(mouthGeometry(ee).halfWidth).toBeGreaterThan(mouthGeometry(oo).halfWidth);
  });

  it('speaking without a meter still moves the mouth', () => {
    const opens = [0.1, 0.2, 0.3, 0.4].map((t) => targetPose('speaking', null, t).open);
    expect(new Set(opens.map((o) => o.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('thinking tilts the mouth to one side', () => {
    const pose = targetPose('thinking', null, 0);
    expect(pose.shiftX).toBeGreaterThan(0);
    expect(pose.tilt).toBeLessThan(0);
  });

  it('opens fast and closes slowly', () => {
    const closed: MouthPose = { ...IDLE_POSE, open: 0 };
    const open: MouthPose = { ...IDLE_POSE, open: 1 };
    const opening = smoothPose(closed, open).open - closed.open;
    const closing = open.open - smoothPose(open, closed).open;
    expect(opening).toBeGreaterThan(closing);
  });
});
