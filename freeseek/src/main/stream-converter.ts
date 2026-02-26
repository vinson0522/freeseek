import { Transform } from "node:stream";
import crypto from "node:crypto";

/**
 * 将 DeepSeek Web SSE 流转换为 OpenAI 兼容的 SSE 流
 */
export function createStreamConverter(model: string) {
  const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let parentMessageId: string | null = null;

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("event:")) continue;

        // 兼容 "data: {...}" 和 "data:{...}" 两种格式
        let dataStr = "";
        if (trimmed.startsWith("data: ")) {
          dataStr = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
          dataStr = trimmed.slice(5).trim();
        } else {
          continue;
        }

        if (dataStr === "[DONE]") {
          this.push("data: [DONE]\n\n");
          continue;
        }

        try {
          const data = JSON.parse(dataStr);

          if (data.response_message_id) {
            parentMessageId = data.response_message_id;
          }

          let content: string | null = null;
          let isReasoning = false;

          if (data.p?.includes("reasoning") || data.type === "thinking") {
            content = data.v ?? data.content ?? null;
            isReasoning = true;
          } else if (typeof data.v === "string") {
            content = data.v;
          } else if (data.type === "text" && typeof data.content === "string") {
            content = data.content;
          } else if (data.choices?.[0]?.delta?.content) {
            content = data.choices[0].delta.content;
          } else if (data.choices?.[0]?.delta?.reasoning_content) {
            content = data.choices[0].delta.reasoning_content;
            isReasoning = true;
          }

          // 过滤特殊 token
          if (
            content === "<｜end▁of▁thinking｜>" ||
            content === "<|endoftext|>"
          ) {
            content = null;
          }

          if (content !== null) {
            const outChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: isReasoning
                    ? { reasoning_content: content }
                    : { content },
                  finish_reason: null,
                },
              ],
            };
            this.push(`data: ${JSON.stringify(outChunk)}\n\n`);
          }
        } catch {
          // 忽略解析错误
        }
      }
      callback();
    },

    flush(callback) {
      const endChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      };
      this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
      this.push("data: [DONE]\n\n");
      callback();
    },
  });

  return { transform, getParentMessageId: () => parentMessageId };
}

/**
 * 非流式响应：收集完整内容后返回
 */
export async function collectFullResponse(
  stream: ReadableStream<Uint8Array>,
  model: string,
): Promise<object> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.slice(6).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);
        if (data.p?.includes("reasoning") || data.type === "thinking") {
          reasoning += data.v ?? data.content ?? "";
        } else if (typeof data.v === "string") {
          if (
            data.v !== "<｜end▁of▁thinking｜>" &&
            data.v !== "<|endoftext|>"
          ) {
            content += data.v;
          }
        } else if (data.choices?.[0]?.delta?.content) {
          content += data.choices[0].delta.content;
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
