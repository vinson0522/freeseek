import { Transform } from "node:stream";
import crypto from "node:crypto";

/**
 * 通义千问 Web SSE → OpenAI 兼容格式转换器
 *
 * 千问 SSE 格式说明：
 * - 每条 SSE 是 "data: {...}" 格式
 * - choices[0].delta.phase: "thinking_summary" | "answer"
 * - choices[0].delta.content: 正文增量文本
 * - choices[0].delta.extra.summary_thought.content: 思考链内容数组
 * - choices[0].delta.extra.summary_title.content: 思考标题数组
 * - choices[0].delta.status: "typing" | "finished"
 * - response.created 事件包含 chat_id 等元数据
 */

export interface QwenStreamOptions {
  model?: string;
  stripReasoning?: boolean;
}

export function createQwenStreamConverter(options: QwenStreamOptions = {}) {
  const model = options.model || "qwen3.5-plus";
  const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let finished = false;

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.startsWith("data: ")
          ? trimmed.slice(6).trim()
          : trimmed.slice(5).trim();

        if (!dataStr) continue;

        if (dataStr === "[DONE]") {
          if (!finished) {
            finished = true;
            const endChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            };
            this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
            this.push("data: [DONE]\n\n");
          }
          continue;
        }

        try {
          const data = JSON.parse(dataStr);

          // 跳过 response.created 事件
          if (data["response.created"]) continue;

          const choice = data.choices?.[0];
          if (!choice?.delta) continue;

          const { phase, content, status, extra } = choice.delta;

          // 结束标记
          if (status === "finished") {
            if (phase === "answer" && !finished) {
              finished = true;
              const endChunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                }],
              };
              this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
              this.push("data: [DONE]\n\n");
            }
            continue;
          }

          // 思考链内容
          if (phase === "thinking_summary" && extra) {
            if (!options.stripReasoning) {
              const thoughts = extra.summary_thought?.content?.join("\n") || "";
              const title = extra.summary_title?.content?.join("") || "";
              const thinkText = title ? `[${title}]\n${thoughts}` : thoughts;
              if (thinkText) {
                const outChunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: { reasoning_content: thinkText },
                    finish_reason: null,
                  }],
                };
                this.push(`data: ${JSON.stringify(outChunk)}\n\n`);
              }
            }
            continue;
          }

          // 正文内容
          if (phase === "answer" && content) {
            const outChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: { content },
                finish_reason: null,
              }],
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
      if (!finished) {
        finished = true;
        const endChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
        };
        this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
        this.push("data: [DONE]\n\n");
      }
      callback();
    },
  });

  return { transform };
}

/**
 * 非流式：收集千问 SSE 完整响应
 */
export async function collectQwenFullResponse(
  stream: ReadableStream<Uint8Array>,
  model: string,
  options?: { stripReasoning?: boolean },
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
      if (!trimmed.startsWith("data:")) continue;

      const dataStr = trimmed.startsWith("data: ")
        ? trimmed.slice(6).trim()
        : trimmed.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);
        if (data["response.created"]) continue;

        const choice = data.choices?.[0];
        if (!choice?.delta) continue;

        const { phase, content: text, extra } = choice.delta;

        if (phase === "thinking_summary" && extra) {
          const thoughts = extra.summary_thought?.content?.join("\n") || "";
          const title = extra.summary_title?.content?.join("") || "";
          reasoning += title ? `[${title}]\n${thoughts}` : thoughts;
        }

        if (phase === "answer" && text) {
          content += text;
        }
      } catch { /* ignore */ }
    }
  }

  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        ...(reasoning && !options?.stripReasoning
          ? { reasoning_content: reasoning }
          : {}),
      },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
