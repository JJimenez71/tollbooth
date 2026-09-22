import { AiProviderName } from './types';

export interface AiClient {
  getRewrittenFile(fileContent: string, instructions: string): Promise<string>;
}

const SYSTEM_PROMPT =
  'You rewrite source files based on instructions. Respond with the COMPLETE rewritten file content ' +
  'and nothing else: no markdown code fences, no explanation, no commentary before or after. ' +
  'Preserve everything the instructions do not ask you to change.';

/**
 * Models frequently wrap code in a markdown fence despite instructions not
 * to. Strip one if present so downstream diffing sees real file content
 * rather than the fence delimiters.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

class AnthropicClient implements AiClient {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async getRewrittenFile(fileContent: string, instructions: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Instructions: ${instructions}\n\nFile content:\n${fileContent}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { content: { type: string; text?: string }[] };
    const textBlock = data.content.find((block) => block.type === 'text');
    if (!textBlock?.text) {
      throw new Error('Anthropic API returned no text content.');
    }
    return stripCodeFence(textBlock.text);
  }
}

class OpenAiClient implements AiClient {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async getRewrittenFile(fileContent: string, instructions: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Instructions: ${instructions}\n\nFile content:\n${fileContent}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content;
    if (!text) {
      throw new Error('OpenAI API returned no content.');
    }
    return stripCodeFence(text);
  }
}

export function createAiClient(provider: AiProviderName, apiKey: string, model: string): AiClient {
  switch (provider) {
    case 'anthropic':
      return new AnthropicClient(apiKey, model);
    case 'openai':
      return new OpenAiClient(apiKey, model);
  }
}
