export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  format?: 'json' | Record<string, unknown>;
  think?: boolean | 'low' | 'medium' | 'high';
}

export interface ChatResult {
  content: string;
  toolCalls: OllamaToolCall[];
  promptTokens: number;
  outputTokens: number;
}

type OllamaChunk = {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

export class OllamaError extends Error {
  public constructor(
    message: string,
    public readonly code: 'offline' | 'authentication' | 'model_missing' | 'invalid_response',
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export class OllamaClient {
  public constructor(private readonly baseUrl: string) {}

  public async health(): Promise<{ models: string[] }> {
    let response: Response;
    try {
      response = await fetch(new URL('/api/tags', this.baseUrl));
    } catch {
      throw new OllamaError(
        `Ollamaへ接続できません。${this.baseUrl}でOllamaが起動しているか確認してください。`,
        'offline',
      );
    }
    if (!response.ok) throw await this.toError(response);
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    return { models: (body.models ?? []).flatMap((model) => (model.name ? [model.name] : [])) };
  }

  public async chat(
    request: ChatRequest,
    onContent?: (content: string) => void,
  ): Promise<ChatResult> {
    let response: Response;
    try {
      response = await fetch(new URL('/api/chat', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, stream: true }),
      });
    } catch {
      throw new OllamaError(
        `Ollamaへ接続できません。${this.baseUrl}でOllamaが起動しているか確認してください。`,
        'offline',
      );
    }
    if (!response.ok) throw await this.toError(response);
    if (!response.body)
      throw new OllamaError('Ollamaから応答本文がありません。', 'invalid_response');

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls: OllamaToolCall[] = [];
    let promptTokens = 0;
    let outputTokens = 0;

    for await (const bytes of response.body) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as OllamaChunk;
        if (chunk.error) throw new OllamaError(chunk.error, 'invalid_response');
        const delta = chunk.message?.content ?? '';
        content += delta;
        if (delta) onContent?.(delta);
        toolCalls.push(...(chunk.message?.tool_calls ?? []));
        promptTokens = chunk.prompt_eval_count ?? promptTokens;
        outputTokens = chunk.eval_count ?? outputTokens;
      }
    }
    if (buffer.trim()) {
      const chunk = JSON.parse(buffer) as OllamaChunk;
      const delta = chunk.message?.content ?? '';
      content += delta;
      if (delta) onContent?.(delta);
      toolCalls.push(...(chunk.message?.tool_calls ?? []));
      promptTokens = chunk.prompt_eval_count ?? promptTokens;
      outputTokens = chunk.eval_count ?? outputTokens;
    }
    return { content, toolCalls, promptTokens, outputTokens };
  }

  public async structured<T>(
    model: string,
    messages: OllamaMessage[],
    schema: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL('/api/chat', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, format: schema, stream: false }),
      });
    } catch {
      throw new OllamaError(
        `Ollamaへ接続できません。${this.baseUrl}でOllamaが起動しているか確認してください。`,
        'offline',
      );
    }
    if (!response.ok) throw await this.toError(response);
    const body = (await response.json()) as OllamaChunk;
    const content = body.message?.content;
    if (!content) throw new OllamaError('構造化応答が空です。', 'invalid_response');
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new OllamaError('構造化応答をJSONとして解析できません。', 'invalid_response');
    }
  }

  private async toError(response: Response): Promise<OllamaError> {
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      return new OllamaError(
        'Ollama Cloud認証が必要です。`ollama signin`を実行してください。',
        'authentication',
      );
    }
    if (response.status === 404 || /model.*not found/i.test(text)) {
      return new OllamaError(`モデルがありません: ${text}`, 'model_missing');
    }
    return new OllamaError(`Ollama API error ${response.status}: ${text}`, 'invalid_response');
  }
}
