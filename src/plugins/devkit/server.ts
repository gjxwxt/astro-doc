import { createHash } from 'node:crypto';

import { ActionError, type ActionHandler } from '../types';

const hash: ActionHandler = async (input) => {
  const text = String(input.text ?? '');
  if (!text) throw new ActionError('EMPTY_INPUT', 400, '请输入要计算哈希的文本。');
  if (text.length > 100_000) throw new ActionError('INPUT_TOO_LARGE', 413, '文本不能超过 100,000 个字符。');

  const algorithm = input.algorithm === 'sha512' ? 'sha512' : 'sha256';
  const digest = createHash(algorithm).update(text, 'utf8').digest();
  return {
    algorithm,
    length: text.length,
    hex: digest.toString('hex'),
    base64: digest.toString('base64'),
  };
};

export const actions: Record<string, ActionHandler> = { hash };
