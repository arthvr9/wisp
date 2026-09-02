import { describe, expect, it } from 'vitest';

import { frameAt, parseSheet } from './sprites';
import type { AsepriteJson, Frame } from './sprites';

function rect(index: number, duration: number) {
  return { frame: { x: index * 32, y: 0, w: 32, h: 32 }, duration };
}

const json: AsepriteJson = {
  frames: {
    'wisp 0.aseprite': rect(0, 500),
    'wisp 1.aseprite': rect(1, 500),
    'wisp 2.aseprite': rect(2, 140),
    'wisp 3.aseprite': rect(3, 600),
    'wisp 4.aseprite': rect(4, 900),
    'wisp 5.aseprite': rect(5, 120),
    'wisp 6.aseprite': rect(6, 300),
    'wisp 7.aseprite': rect(7, 160),
    'wisp 8.aseprite': rect(8, 100),
    'wisp 9.aseprite': rect(9, 100),
    'wisp 10.aseprite': rect(10, 100),
  },
  meta: {
    frameTags: [
      { name: 'idle', from: 0, to: 1, direction: 'forward' },
      { name: 'walk', from: 2, to: 2, direction: 'forward' },
      { name: 'sit', from: 3, to: 3, direction: 'forward' },
      { name: 'sleep', from: 4, to: 4, direction: 'forward' },
      { name: 'alert', from: 5, to: 5, direction: 'forward' },
      { name: 'drag', from: 6, to: 6, direction: 'forward' },
      { name: 'celebrate', from: 7, to: 7, direction: 'forward' },
      { name: 'expressions', from: 8, to: 10, direction: 'forward' },
    ],
    wisp: { bob: { offsetX: [0, 0, 1], offsetY: [0, 1, -1] } },
  },
};

function withTags(tags: AsepriteJson['meta']['frameTags']): AsepriteJson {
  return { ...json, meta: { ...json.meta, frameTags: tags } };
}

describe('parseSheet', () => {
  it('groups frames per pose tag', () => {
    const sheet = parseSheet(json);
    expect(sheet.animations.idle).toEqual([
      { x: 0, y: 0, w: 32, h: 32, durationMs: 500, bobX: 0, bobY: 0 },
      { x: 32, y: 0, w: 32, h: 32, durationMs: 500, bobX: 0, bobY: 1 },
    ]);
    expect(sheet.animations.drag).toHaveLength(1);
    expect(sheet.animations.drag[0]?.x).toBe(192);
    expect(sheet.animations.celebrate[0]?.durationMs).toBe(160);
  });

  it('maps the expressions tag to bright, plain and low in order', () => {
    const sheet = parseSheet(json);
    expect(sheet.expressions.bright.x).toBe(8 * 32);
    expect(sheet.expressions.plain.x).toBe(9 * 32);
    expect(sheet.expressions.low.x).toBe(10 * 32);
  });

  it('reads bob offsets by frame index and defaults the rest to zero', () => {
    const sheet = parseSheet(json);
    expect(sheet.animations.walk[0]).toMatchObject({ bobX: 1, bobY: -1 });
    expect(sheet.animations.sit[0]).toMatchObject({ bobX: 0, bobY: 0 });
  });

  it('accepts a sheet without the wisp extension', () => {
    const plain: AsepriteJson = { ...json, meta: { frameTags: json.meta.frameTags } };
    const sheet = parseSheet(plain);
    expect(sheet.animations.idle[1]).toMatchObject({ bobX: 0, bobY: 0 });
  });

  it('throws when a pose tag is missing', () => {
    const broken = withTags(json.meta.frameTags.filter((t) => t.name !== 'sleep'));
    expect(() => parseSheet(broken)).toThrow('no frame tag "sleep"');
  });

  it('throws when the expressions tag is missing', () => {
    const broken = withTags(json.meta.frameTags.filter((t) => t.name !== 'expressions'));
    expect(() => parseSheet(broken)).toThrow('no frame tag "expressions"');
  });

  it('throws when the expressions tag does not hold three frames', () => {
    const broken = withTags(
      json.meta.frameTags.map((t) => (t.name === 'expressions' ? { ...t, to: 9 } : t)),
    );
    expect(() => parseSheet(broken)).toThrow('has 2 frames, expected 3');
  });

  it('throws when a tag points past the last frame', () => {
    const broken = withTags(
      json.meta.frameTags.map((t) => (t.name === 'drag' ? { ...t, to: 12 } : t)),
    );
    expect(() => parseSheet(broken)).toThrow('sheet has 11 frames');
  });
});

describe('frameAt', () => {
  const frames: Frame[] = [
    { x: 0, y: 0, w: 32, h: 32, durationMs: 100, bobX: 0, bobY: 0 },
    { x: 32, y: 0, w: 32, h: 32, durationMs: 200, bobX: 0, bobY: 0 },
    { x: 64, y: 0, w: 32, h: 32, durationMs: 50, bobX: 0, bobY: 0 },
  ];

  it('picks frames by cumulative duration', () => {
    expect(frameAt(frames, 0).x).toBe(0);
    expect(frameAt(frames, 99).x).toBe(0);
    expect(frameAt(frames, 100).x).toBe(32);
    expect(frameAt(frames, 299).x).toBe(32);
    expect(frameAt(frames, 300).x).toBe(64);
    expect(frameAt(frames, 349).x).toBe(64);
  });

  it('wraps around after the total duration', () => {
    expect(frameAt(frames, 350).x).toBe(0);
    expect(frameAt(frames, 350 + 150).x).toBe(32);
    expect(frameAt(frames, 350 * 10 + 320).x).toBe(64);
  });

  it('treats negative time as the start', () => {
    expect(frameAt(frames, -40).x).toBe(0);
  });

  it('returns the only frame of a single-frame animation', () => {
    const single = [frames[1]] as Frame[];
    expect(frameAt(single, 0).x).toBe(32);
    expect(frameAt(single, 12345).x).toBe(32);
  });

  it('throws on an empty animation', () => {
    expect(() => frameAt([], 0)).toThrow('no frames');
  });
});
