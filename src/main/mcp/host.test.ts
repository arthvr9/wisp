import { describe, expect, it } from 'vitest';

import { ToolCallError, unwrapToolResult } from './host';

describe('unwrapToolResult', () => {
  it('prefers structured content', () => {
    const result = unwrapToolResult({
      content: [{ type: 'text', text: '{"a":1}' }],
      structuredContent: { b: 2 },
    });
    expect(result).toEqual({ b: 2 });
  });

  it('parses joined text content as JSON when it parses', () => {
    expect(
      unwrapToolResult({
        content: [
          { type: 'text', text: '{"tasks":' },
          { type: 'text', text: '[]}' },
        ],
      }),
    ).toEqual({ tasks: [] });
    expect(unwrapToolResult({ content: [{ type: 'text', text: '[1, 2]' }] })).toEqual([1, 2]);
  });

  it('returns raw text otherwise and skips non-text blocks', () => {
    const result = unwrapToolResult({
      content: [
        { type: 'image' },
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(result).toBe('hello\nworld');
    expect(unwrapToolResult({ content: [] })).toBe('');
  });

  it('returns the legacy toolResult field', () => {
    expect(unwrapToolResult({ toolResult: { legacy: true } })).toEqual({ legacy: true });
  });

  it('throws ToolCallError when the server flags an error', () => {
    expect(() =>
      unwrapToolResult(
        { isError: true, content: [{ type: 'text', text: 'no such list' }] },
        'get_list',
      ),
    ).toThrow(ToolCallError);
    expect(() => unwrapToolResult({ isError: true }, 'get_list')).toThrow(
      /get_list reported an error/,
    );
  });
});
