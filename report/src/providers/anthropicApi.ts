import Anthropic from '@anthropic-ai/sdk';
import type { TokenUsage } from './agentSdk.js';

export async function callViaAnthropicApi(args: {
  system: string;
  user: string;
  model: string;
}): Promise<{ text: string; usage: TokenUsage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'CLAUDE_PROVIDER=api では ANTHROPIC_API_KEY 環境変数が必須です',
    );
  }

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: args.model,
    max_tokens: 8000,
    temperature: 0.3,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    text,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      totalCostUsd: 0,
    },
  };
}
