import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVerdict } from '../src/verdict.js';

test('parses approved from the final line', () => {
  assert.equal(parseVerdict('Plan looks solid.\nEvidence checks out.\nverdict: approved'), 'approved');
});

test('parses revise', () => {
  assert.equal(parseVerdict('The plan contradicts itself.\nFinal verdict: revise.'), 'revise');
});

test('parses needs_attention', () => {
  assert.equal(parseVerdict('Missing evidence.\nVerdict: needs_attention'), 'needs_attention');
});

test('normalizes the spaced "needs attention" variant', () => {
  assert.equal(parseVerdict('Missing evidence.\nVerdict: needs attention.'), 'needs_attention');
});

test('takes the last verdict on the final line', () => {
  assert.equal(parseVerdict('Summary mentions revise but the final word is approved'), 'approved');
});

test('falls back to the last verdict in the whole text when the final line has none', () => {
  assert.equal(parseVerdict('Verdict: revise\n(end of report)'), 'revise');
});

test('maps empty and whitespace-only text to verdict_unparsed', () => {
  assert.equal(parseVerdict(''), 'verdict_unparsed');
  assert.equal(parseVerdict('   \n  \n '), 'verdict_unparsed');
});

test('maps text without any verdict word to verdict_unparsed', () => {
  assert.equal(parseVerdict('All good, ship it.'), 'verdict_unparsed');
});
