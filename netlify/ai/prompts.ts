/**
 * Cloud requests always use these server-side copies of the instructions, so
 * nothing a user types (or a modified client sends) can replace the accuracy
 * rules. The text itself is shared with the app (Ollama runs locally).
 */
export { CHAT_MAX_TOKENS, EXTRACT_TASKS, buildChatSystemPrompt } from '../../src/app/core/ai/ai-prompts';
