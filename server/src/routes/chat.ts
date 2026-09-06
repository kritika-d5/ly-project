import { Router } from 'express';
import { z } from 'zod';
import { nodes } from '../config.js';
import { env } from '../config.js';
import { retrieveInCase } from '../lib/caseContext.js';
import { CASE_CHAT_SYSTEM, SUMMARY_SYSTEM, formatPassages, groq } from '../lib/llm.js';

export const chatRouter = Router();

const chatSchema = z.object({
  message: z.string().min(1),
  /** prior turns, so follow-ups work. Kept client-side; this server is stateless. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .optional(),
  k: z.number().int().min(1).max(20).optional(),
});

/**
 * POST /api/cases/:tid/chat  ask a question about ONE judgment.
 *
 * Streams the answer over Server-Sent Events. The retrieved passages are sent
 * first, as a single `sources` event, so the UI can render citations
 * immediately and the user can see what the model was given before it starts
 * talking. That ordering is deliberate: sources that arrive after an answer
 * read as justification, sources that arrive before it read as evidence.
 *
 * Retrieval, not whole-document stuffing. 129 of the 198 cases would fit
 * entirely in context, but the largest is ~120k tokens and Groq's free tier
 * meters tokens per minute, so a handful of big-case questions would exhaust
 * the budget. Top-k keeps every case on the same predictable footing.
 */
chatRouter.post('/cases/:tid/chat', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    if (!env.groqApiKey) {
      return res.status(503).json({ error: 'GROQ_API_KEY is not set in server/.env' });
    }

    const node = await nodes.findOne({ _id: tid }, { projection: { title: 1, docsource: 1 } });
    if (!node) return res.status(404).json({ error: 'case not found' });

    const { message, history = [], k } = parsed.data;
    const passages = await retrieveInCase(tid, message, k ?? 8);
    if (!passages.length) {
      return res.status(404).json({ error: 'no chunks for this case', tid });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('sources', { passages });

    const context = [
      `JUDGMENT: ${node.title}`,
      `COURT: ${node.docsource ?? 'unknown'}`,
      '',
      'EXTRACTS:',
      formatPassages(passages),
    ].join('\n');

    const stream = await groq().chat.completions.create({
      model: env.groqModel,
      stream: true,
      temperature: 0.2, // low: this is reading comprehension, not composition
      messages: [
        { role: 'system', content: CASE_CHAT_SYSTEM },
        ...history.map((h) => ({ role: h.role, content: h.content }) as const),
        { role: 'user', content: `${context}\n\nQUESTION: ${message}` },
      ],
    });

    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) send('token', { text: delta });
    }
    send('done', {});
    res.end();
  } catch (err) {
    // Once the SSE stream is open the status code is already sent, so an error
    // has to travel as an event rather than an HTTP status.
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
      return res.end();
    }
    next(err);
  }
});

/**
 * POST /api/cases/:tid/summary  a structured Issue / Held / Principle summary.
 *
 * Retrieves against a fixed "what did this case decide" probe rather than a
 * user query, and biases toward the court's own words and the SCR headnote.
 */
chatRouter.post('/cases/:tid/summary', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    if (!env.groqApiKey) {
      return res.status(503).json({ error: 'GROQ_API_KEY is not set in server/.env' });
    }
    const node = await nodes.findOne({ _id: tid }, { projection: { title: 1, docsource: 1 } });
    if (!node) return res.status(404).json({ error: 'case not found' });

    const passages = await retrieveInCase(
      tid,
      'what did the court decide and why, the issue, the holding, and the principle laid down',
      12,
    );
    if (!passages.length) return res.status(404).json({ error: 'no chunks for this case', tid });

    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        {
          role: 'user',
          content: `JUDGMENT: ${node.title}\nCOURT: ${node.docsource ?? 'unknown'}\n\nEXTRACTS:\n${formatPassages(passages)}`,
        },
      ],
    });

    res.json({
      tid,
      title: node.title,
      summary: completion.choices[0]?.message?.content ?? '',
      passages,
    });
  } catch (err) {
    next(err);
  }
});
