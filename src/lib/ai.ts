import 'server-only';
import { isIP } from 'node:net';
import { GoogleGenAI } from '@google/genai';

export function isVertexConfigured() {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT?.trim());
}

export async function generateWithVertex(prompt: string, options: { file?: { mimeType: string; data: string }; urls?: string[]; files?: { mimeType: string; data: string }[] } = {}) {
  if (!isVertexConfigured()) throw new Error('Vertex AI is not configured.');
  const ai = new GoogleGenAI({ vertexai: true, enterprise: true, project: process.env.GOOGLE_CLOUD_PROJECT!, location: process.env.GOOGLE_CLOUD_LOCATION || 'global' });
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (options.file) parts.push({ inlineData: { mimeType: options.file.mimeType, data: options.file.data } });
  for (const file of options.files || []) parts.push({ inlineData: file });
  const tools = options.urls?.length ? [{ urlContext: {} }] : undefined;
  const response = await ai.models.generateContent({
    model: process.env.VERTEX_MODEL_ID || 'gemini-3.8-flash',
    contents: [{ role: 'user', parts }],
    config: { tools, responseMimeType: 'application/json', temperature: 0.2 },
  });
  const text = response.text?.trim();
  if (!text) throw new Error('Vertex AI returned an empty response.');
  return JSON.parse(text) as unknown;
}

export function safePublicUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const address = host.replace(/^\[|\]$/g, '');
    if (!['https:', 'http:'].includes(url.protocol) || !host.includes('.') || isIP(address) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') return false;
    if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return false;
    return true;
  } catch { return false; }
}
