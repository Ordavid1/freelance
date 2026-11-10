export const SUPPORT_MAX_TEXT = 4000;
export const SUPPORT_COOKIE = 'fz_support';
export type SupportMessage = {
  id: string;
  sender: 'visitor' | 'support';
  text: string;
  createdAt: number;
  delivery: 'pending' | 'sent' | 'failed';
  page?: string;
  retry?: { name: string; email: string; page: string };
};
export type SupportSession = {
  configured: boolean;
  contact: { name: string; email: string };
  hasConversation: boolean;
  messages: SupportMessage[];
};
