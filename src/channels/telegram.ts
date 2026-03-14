import { Bot } from 'grammy';

import type { ChannelAdapter, MessageHandler } from '../gateway/types.js';

export function createTelegramAdapter(token: string): ChannelAdapter {
  const bot = new Bot(token);
  let started = false;

  return {
    name: 'telegram',

    async start(handler: MessageHandler): Promise<void> {
      bot.command(['start', 'help'], async (ctx) => {
        await ctx.reply(
          "Hey! I'm your personal AI assistant. Just send me a message and I'll reply.",
        );
      });

      bot.on('message:text', async (ctx) => {
        const msg = ctx.message;
        if (!msg.text || msg.from?.is_bot) return;

        // Send typing indicator immediately, refresh every 4s while waiting
        await ctx.replyWithChatAction('typing');
        const typingInterval = setInterval(() => {
          void ctx.replyWithChatAction('typing');
        }, 4000);

        try {
          await handler({
            id: String(msg.message_id),
            channel: 'telegram',
            userId: `telegram:${String(msg.from?.id ?? 'unknown')}`,
            chatId: String(msg.chat.id),
            text: msg.text,
            timestamp: new Date(msg.date * 1000),
          });
        } catch {
          await ctx.reply("Sorry, something went wrong. Please try again.");
        } finally {
          clearInterval(typingInterval);
        }
      });

      // grammy uses long-polling by default; no webhook config needed for development
      void bot.start({ drop_pending_updates: true });
      started = true;
    },

    async send(chatId: string, text: string): Promise<void> {
      // Telegram has a 4096-char limit per message
      const chunks = splitText(text, 4096);
      for (const chunk of chunks) {
        await bot.api.sendMessage(chatId, chunk);
      }
    },

    async stop(): Promise<void> {
      if (started) await bot.stop();
    },
  };
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}
